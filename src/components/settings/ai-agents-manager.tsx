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
  Eye,
  EyeOff,
  Bot,
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

const MASKED_KEY = '••••••••••••••••';
const HANDOFF_QUEUE = '__queue__';

const PROVIDER_LABEL: Record<AiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
};

const KEY_PLACEHOLDER: Record<AiProvider, string> = {
  openai: 'sk-...',
  anthropic: 'sk-ant-...',
};

interface AgentSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_receptionist: boolean;
  is_active: boolean;
  auto_reply_enabled: boolean;
}

interface DraftState {
  id: string | null; // null = creating
  name: string;
  slug: string;
  slugEdited: boolean;
  description: string;
  isReceptionist: boolean;
  provider: AiProvider;
  model: string;
  apiKey: string;
  keyEdited: boolean;
  showKey: boolean;
  hasStoredKey: boolean;
  embeddingsKey: string;
  embeddingsKeyEdited: boolean;
  hasStoredEmbeddingsKey: boolean;
  systemPrompt: string;
  isActive: boolean;
  autoReplyEnabled: boolean;
  maxPerConversation: number;
  handoffAgentId: string;
}

function emptyDraft(): DraftState {
  return {
    id: null,
    name: '',
    slug: '',
    slugEdited: false,
    description: '',
    isReceptionist: false,
    provider: 'openai',
    model: AI_PROVIDER_DEFAULT_MODEL.openai,
    apiKey: '',
    keyEdited: false,
    showKey: false,
    hasStoredKey: false,
    embeddingsKey: '',
    embeddingsKeyEdited: false,
    hasStoredEmbeddingsKey: false,
    systemPrompt: '',
    isActive: false,
    autoReplyEnabled: false,
    maxPerConversation: 3,
    handoffAgentId: '',
  };
}

export function AiAgentsManager() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/agents');
      const data = await res.json().catch(() => ({}));
      if (res.ok) setAgents((data.agents as AgentSummary[]) ?? []);
      else toast.error(data.error ?? 'Não foi possível carregar os agentes.');
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

  const openCreate = () => setDraft(emptyDraft());

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
        provider: data.provider,
        model: data.model,
        apiKey: data.has_key ? MASKED_KEY : '',
        keyEdited: false,
        showKey: false,
        hasStoredKey: Boolean(data.has_key),
        embeddingsKey: data.has_embeddings_key ? MASKED_KEY : '',
        embeddingsKeyEdited: false,
        hasStoredEmbeddingsKey: Boolean(data.has_embeddings_key),
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

  const handleProviderChange = (next: AiProvider) => {
    setDraft((d) => {
      if (!d) return d;
      const isDefaultModel =
        d.model === AI_PROVIDER_DEFAULT_MODEL.openai ||
        d.model === AI_PROVIDER_DEFAULT_MODEL.anthropic ||
        d.model.trim() === '';
      return {
        ...d,
        provider: next,
        model: isDefaultModel ? AI_PROVIDER_DEFAULT_MODEL[next] : d.model,
      };
    });
  };

  const keyPayload = (d: DraftState) => (d.keyEdited ? d.apiKey.trim() : undefined);
  const embeddingsKeyPayload = (d: DraftState) =>
    d.embeddingsKeyEdited ? d.embeddingsKey.trim() || null : undefined;

  const handleTest = async () => {
    if (!draft) return;
    setTesting(true);
    try {
      const res = await fetch(`/api/ai/agents/${draft.id ?? 'new'}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: draft.provider,
          model: draft.model.trim(),
          api_key: keyPayload(draft),
        }),
      });
      const data = await res.json();
      if (res.ok) toast.success('Conexão validada com sucesso.');
      else toast.error(data.error ?? 'A chave foi rejeitada pelo provedor.');
    } catch {
      toast.error('Não foi possível testar a chave agora.');
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
    if (!draft.id && !draft.keyEdited) {
      toast.error('Informe a chave de API.');
      return;
    }
    setSaving(true);
    try {
      const isNew = draft.id === null;
      const body = isNew
        ? {
            name: draft.name.trim(),
            slug: draft.slug.trim(),
            description: draft.description.trim() || null,
            provider: draft.provider,
            model: draft.model.trim(),
            api_key: draft.apiKey.trim(),
            embeddings_api_key: draft.embeddingsKey.trim() || undefined,
            system_prompt: draft.systemPrompt.trim() || null,
            is_active: draft.isActive,
            auto_reply_enabled: draft.autoReplyEnabled,
            auto_reply_max_per_conversation: draft.maxPerConversation,
            handoff_agent_id: draft.handoffAgentId || null,
          }
        : {
            name: draft.name.trim(),
            slug: draft.slug.trim(),
            description: draft.description.trim() || null,
            provider: draft.provider,
            model: draft.model.trim(),
            api_key: keyPayload(draft),
            embeddings_api_key: embeddingsKeyPayload(draft),
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

  return (
    <div>
      <SettingsPanelHead
        title="Agentes de IA"
        description="Cada agente tem seu próprio provedor, prompt e base de conhecimento. O recepcionista atende toda conversa nova e pode transferir para os demais, ou para um humano."
        action={
          canEdit && (
            <Button onClick={openCreate}>
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

      {agents.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          Nenhum agente ainda. Crie o primeiro — ele vira o recepcionista automaticamente.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {agents.map((a) => (
            <li
              key={a.id}
              className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
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
              <div className="flex shrink-0 gap-1">
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
              Sua chave é armazenada criptografada. Ela nunca é reexibida — só indicamos que uma
              chave já está salva.
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

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Provedor</Label>
                  <Select
                    value={draft.provider}
                    onValueChange={(v) => handleProviderChange(v as AiProvider)}
                    disabled={disabled}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">{PROVIDER_LABEL.openai}</SelectItem>
                      <SelectItem value="anthropic">{PROVIDER_LABEL.anthropic}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Modelo</Label>
                  <Input
                    value={draft.model}
                    onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                    placeholder={AI_PROVIDER_DEFAULT_MODEL[draft.provider]}
                    disabled={disabled}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Chave de API</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={draft.showKey ? 'text' : 'password'}
                      value={draft.apiKey}
                      onChange={(e) =>
                        setDraft({ ...draft, apiKey: e.target.value, keyEdited: true })
                      }
                      onFocus={() => {
                        if (!draft.keyEdited && draft.hasStoredKey) {
                          setDraft({ ...draft, apiKey: '', keyEdited: true });
                        }
                      }}
                      placeholder={KEY_PLACEHOLDER[draft.provider]}
                      disabled={disabled}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, showKey: !draft.showKey })}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {draft.showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <Button variant="outline" onClick={handleTest} disabled={disabled || testing}>
                    {testing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    Testar
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>
                  Chave de embeddings{' '}
                  <span className="font-normal text-muted-foreground">(opcional, busca semântica)</span>
                </Label>
                <Input
                  type="password"
                  value={draft.embeddingsKey}
                  onChange={(e) =>
                    setDraft({ ...draft, embeddingsKey: e.target.value, embeddingsKeyEdited: true })
                  }
                  onFocus={() => {
                    if (!draft.embeddingsKeyEdited && draft.hasStoredEmbeddingsKey) {
                      setDraft({ ...draft, embeddingsKey: '', embeddingsKeyEdited: true });
                    }
                  }}
                  placeholder="sk-... (OpenAI)"
                  disabled={disabled}
                  autoComplete="off"
                />
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
                  hasEmbeddingsKey={
                    draft.embeddingsKeyEdited
                      ? draft.embeddingsKey.trim().length > 0
                      : draft.hasStoredEmbeddingsKey
                  }
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
