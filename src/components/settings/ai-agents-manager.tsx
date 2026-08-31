'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Star,
  CheckCircle2,
  Bot,
  KeyRound,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsPanelHead } from './settings-panel-head';
import { AiKnowledgeCard } from './ai-knowledge';
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults';
import { slugifyAgentName } from '@/lib/ai/slug';
import type { AiProvider } from '@/lib/ai/types';
import type { AccountMember } from '@/types';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';

const HANDOFF_QUEUE = '__queue__';

interface AgentSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_receptionist: boolean;
  is_active: boolean;
  auto_reply_enabled: boolean;
}

interface ProviderStatus {
  configured: boolean;
  provider: AiProvider | null;
  hasEmbeddingsKey: boolean;
}

interface DraftState {
  id: string | null; // null = creating
  name: string;
  slug: string;
  slugEdited: boolean;
  description: string;
  isReceptionist: boolean;
  model: string;
  systemPrompt: string;
  isActive: boolean;
  autoReplyEnabled: boolean;
  maxPerConversation: number;
  handoffAgentId: string;
}

function emptyDraft(defaultModel: string): DraftState {
  return {
    id: null,
    name: '',
    slug: '',
    slugEdited: false,
    description: '',
    isReceptionist: false,
    model: defaultModel,
    systemPrompt: '',
    isActive: false,
    autoReplyEnabled: false,
    maxPerConversation: 3,
    handoffAgentId: '',
  };
}

/**
 * Agent roster — cards that open a popup with each agent's own
 * settings (name/slug/description/model/prompt/behaviour/knowledge
 * base). The provider/API key is deliberately NOT here — it's a
 * single account-wide credential configured once in
 * `AiProviderConfig` and shared by every agent (see /api/ai/provider).
 */
export function AiAgentsManager({ onNeedProviderConfig }: { onNeedProviderConfig?: () => void }) {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    try {
      const [agentsRes, providerRes] = await Promise.all([
        fetch('/api/ai/agents'),
        fetch('/api/ai/provider'),
      ]);
      const agentsData = await agentsRes.json().catch(() => ({}));
      if (agentsRes.ok) setAgents((agentsData.agents as AgentSummary[]) ?? []);
      else toast.error(agentsData.error ?? 'Não foi possível carregar os agentes.');

      const providerData = await providerRes.json().catch(() => ({}));
      if (providerRes.ok) {
        setProviderStatus({
          configured: Boolean(providerData.configured),
          provider: providerData.provider ?? null,
          hasEmbeddingsKey: Boolean(providerData.has_embeddings_key),
        });
      }
    } catch {
      toast.error('Não foi possível carregar os agentes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchAgents();
    void fetchAccountMembers().then(setMembers);
  }, [accountId, fetchAgents]);

  const openCreate = () => {
    const defaultModel = providerStatus?.provider
      ? AI_PROVIDER_DEFAULT_MODEL[providerStatus.provider]
      : '';
    setDraft(emptyDraft(defaultModel));
  };

  const openEdit = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/agents/${id}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Não foi possível abrir o agente.');
        return;
      }
      setDraft({
        id,
        name: data.name ?? '',
        slug: data.slug ?? '',
        slugEdited: true, // editing an existing agent never auto-derives the slug
        description: data.description ?? '',
        isReceptionist: Boolean(data.is_receptionist),
        model: data.model ?? '',
        systemPrompt: data.system_prompt ?? '',
        isActive: Boolean(data.is_active),
        autoReplyEnabled: Boolean(data.auto_reply_enabled),
        maxPerConversation: data.auto_reply_max_per_conversation ?? 3,
        handoffAgentId: data.handoff_agent_id ?? '',
      });
    } catch {
      toast.error('Não foi possível abrir o agente.');
    }
  };

  const handleNameChange = (name: string) => {
    setDraft((d) =>
      d
        ? { ...d, name, slug: d.slugEdited ? d.slug : slugifyAgentName(name) }
        : d,
    );
  };

  const handleTest = async () => {
    if (!draft) return;
    setTesting(true);
    try {
      const res = await fetch(`/api/ai/agents/${draft.id ?? 'new'}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: draft.model.trim() }),
      });
      const data = await res.json();
      if (res.ok) toast.success('Modelo validado com sucesso.');
      else if (data.code === 'provider_not_configured') {
        toast.error('Configure sua chave de API primeiro.');
      } else {
        toast.error(data.error ?? 'O modelo foi rejeitado pelo provedor.');
      }
    } catch {
      toast.error('Não foi possível testar o modelo agora.');
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error('Dê um nome para o agente.');
      return;
    }
    if (!draft.model.trim()) {
      toast.error('Informe o modelo.');
      return;
    }
    setSaving(true);
    try {
      const isNew = draft.id === null;
      const body = {
        name: draft.name.trim(),
        slug: draft.slug.trim(),
        description: draft.description.trim() || null,
        model: draft.model.trim(),
        system_prompt: draft.systemPrompt.trim() || null,
        is_active: draft.isActive,
        auto_reply_enabled: draft.autoReplyEnabled,
        auto_reply_max_per_conversation: draft.maxPerConversation,
        handoff_agent_id: draft.handoffAgentId || null,
      };

      const res = await fetch(
        isNew ? '/api/ai/agents' : `/api/ai/agents/${draft.id}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'plan_upgrade_required') {
          toast.error(
            'Adicionar mais de um agente exige o plano Pro. Fale com o suporte para fazer upgrade.',
          );
        } else if (data.code === 'slug_taken') {
          toast.error('Já existe um agente com esse identificador nesta conta.');
        } else if (data.code === 'provider_not_configured') {
          toast.error('Configure sua chave de API primeiro.');
        } else {
          toast.error(data.error ?? 'Não foi possível salvar o agente.');
        }
        return;
      }
      toast.success(isNew ? 'Agente criado.' : 'Agente atualizado.');
      setDraft(null);
      await fetchAgents();
    } catch {
      toast.error('Não foi possível salvar o agente.');
    } finally {
      setSaving(false);
    }
  };

  const promote = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/agents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_receptionist: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? 'Não foi possível promover o agente.');
        return;
      }
      toast.success('Agente promovido a recepcionista.');
      await fetchAgents();
    } catch {
      toast.error('Não foi possível promover o agente.');
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Excluir este agente? Essa ação não pode ser desfeita.')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/ai/agents/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Agente excluído.');
        setAgents((a) => a.filter((x) => x.id !== id));
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Não foi possível excluir o agente.');
      }
    } catch {
      toast.error('Não foi possível excluir o agente.');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading || profileLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  const disabled = !canEdit || saving;
  const providerConfigured = Boolean(providerStatus?.configured);

  return (
    <div>
      <SettingsPanelHead
        title="Agentes de IA"
        description="Cada agente tem seu próprio prompt, modelo e base de conhecimento — todos usam a mesma chave de API. O recepcionista atende toda conversa nova e pode transferir para os demais, ou para um humano."
        action={
          canEdit && (
            <Button onClick={openCreate} disabled={!providerConfigured}>
              <Plus className="mr-1 h-4 w-4" /> Novo agente
            </Button>
          )
        }
      />

      {!canEdit && (
        <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Apenas administradores podem configurar agentes de IA.
        </p>
      )}

      {canEdit && !providerConfigured && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          <span className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 shrink-0" /> Configure sua chave de API antes de criar um
            agente.
          </span>
          {onNeedProviderConfig && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 border-amber-500/40 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
              onClick={onNeedProviderConfig}
            >
              Configurar
            </Button>
          )}
        </div>
      )}

      {agents.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          Nenhum agente ainda. Crie o primeiro — ele vira o recepcionista automaticamente.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {agents.map((a) => (
            <li
              key={a.id}
              onClick={() => canEdit && void openEdit(a.id)}
              className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-muted/40 cursor-pointer"
            >
              <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-foreground">
                    {a.name}
                  </span>
                  {a.is_receptionist && (
                    <Badge variant="secondary" className="gap-1">
                      <Star className="h-3 w-3" /> Recepcionista
                    </Badge>
                  )}
                  {a.is_active ? (
                    <Badge variant="outline" className="text-emerald-500">
                      Ativo
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      Inativo
                    </Badge>
                  )}
                  {a.auto_reply_enabled && (
                    <Badge variant="outline">Resposta automática</Badge>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {a.description || `slug: ${a.slug}`}
                </p>
              </div>
              <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
                {canEdit && !a.is_receptionist && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs text-muted-foreground"
                    onClick={() => void promote(a.id)}
                    title="Tornar recepcionista"
                  >
                    <Star className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void openEdit(a.id)}
                  disabled={!canEdit}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void remove(a.id)}
                  disabled={!canEdit || a.is_receptionist || deletingId === a.id}
                  className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  title={a.is_receptionist ? 'Promova outro agente antes de excluir este' : 'Excluir'}
                >
                  {deletingId === a.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Editar agente' : 'Novo agente'}</DialogTitle>
            <DialogDescription>
              Usa a chave de API configurada na conta — escolha aqui só o modelo, o comportamento
              e a base de conhecimento deste agente.
            </DialogDescription>
          </DialogHeader>

          {draft && (
            <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Nome</Label>
                  <Input
                    value={draft.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="ex.: Suporte"
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Identificador (slug)</Label>
                  <Input
                    value={draft.slug}
                    onChange={(e) =>
                      setDraft({ ...draft, slug: e.target.value.toLowerCase(), slugEdited: true })
                    }
                    placeholder="suporte"
                    disabled={disabled}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Descrição</Label>
                <Input
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder="Usada pelos outros agentes para decidir se transferem para este"
                  disabled={disabled}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Modelo</Label>
                <div className="flex gap-2">
                  <Input
                    value={draft.model}
                    onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                    placeholder={
                      providerStatus?.provider
                        ? AI_PROVIDER_DEFAULT_MODEL[providerStatus.provider]
                        : 'gpt-4o-mini'
                    }
                    disabled={disabled}
                    className="flex-1"
                  />
                  <Button variant="outline" onClick={handleTest} disabled={disabled || testing}>
                    {testing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    Testar
                  </Button>
                </div>
                {providerStatus?.provider && (
                  <p className="text-xs text-muted-foreground">
                    Usando a chave de {providerStatus.provider === 'openai' ? 'OpenAI' : 'Anthropic'}{' '}
                    configurada na conta.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Contexto de negócio / prompt</Label>
                <Textarea
                  value={draft.systemPrompt}
                  onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
                  placeholder="Ex.: Você atende clientes da loja X. Horário: seg-sex, 9h-18h..."
                  rows={5}
                  disabled={disabled}
                />
              </div>

              <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Ativar este agente</p>
                  <p className="text-xs text-muted-foreground">
                    Enquanto desativado, ele não é usado nem para teste no playground em produção.
                  </p>
                </div>
                <Switch
                  checked={draft.isActive}
                  onCheckedChange={(v) => setDraft({ ...draft, isActive: v })}
                  disabled={disabled}
                />
              </div>

              <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Resposta automática</p>
                  <p className="text-xs text-muted-foreground">
                    Responde sozinho no WhatsApp quando é o agente da vez na conversa.
                  </p>
                </div>
                <Switch
                  checked={draft.autoReplyEnabled}
                  onCheckedChange={(v) => setDraft({ ...draft, autoReplyEnabled: v })}
                  disabled={disabled || !draft.isActive}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label>Respostas automáticas por conversa</Label>
                  <p className="text-xs text-muted-foreground">Teto compartilhado da conversa.</p>
                </div>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={draft.maxPerConversation}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      maxPerConversation: Math.min(20, Math.max(1, Number(e.target.value) || 1)),
                    })
                  }
                  disabled={disabled || !draft.autoReplyEnabled}
                  className="w-20"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Transferir para humano em</Label>
                <p className="text-xs text-muted-foreground">
                  Quando este agente não consegue ajudar (ou não encontra outro agente melhor).
                </p>
                <Select
                  value={draft.handoffAgentId || HANDOFF_QUEUE}
                  onValueChange={(v) =>
                    setDraft({ ...draft, handoffAgentId: !v || v === HANDOFF_QUEUE ? '' : v })
                  }
                  disabled={disabled || !draft.autoReplyEnabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={HANDOFF_QUEUE}>Fila compartilhada</SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {memberLabel(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {draft.id ? (
                <AiKnowledgeCard
                  accountId={accountId}
                  agentId={draft.id}
                  canEdit={canEdit}
                  hasEmbeddingsKey={Boolean(providerStatus?.hasEmbeddingsKey)}
                />
              ) : (
                <p className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                  Salve o agente para adicionar uma base de conhecimento própria.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={disabled}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
