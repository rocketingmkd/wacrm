'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, KeyRound, CheckCircle2, Trash2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsPanelHead } from './settings-panel-head';
import type { AiProvider } from '@/lib/ai/types';

const MASKED_KEY = '••••••••••••••••';

const PROVIDER_LABEL: Record<AiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
};

const KEY_PLACEHOLDER: Record<AiProvider, string> = {
  openai: 'sk-...',
  anthropic: 'sk-ant-...',
};

/**
 * The account's ONE shared BYO provider credential — every AI agent
 * uses this same provider/key; only each agent's model differs (see
 * ai-agents-manager.tsx). Kept as its own settings section so setting
 * up billing-relevant credentials is a single, unambiguous place
 * instead of being repeated per agent.
 */
export function AiProviderConfig({ onSaved }: { onSaved?: () => void }) {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);

  const [configured, setConfigured] = useState(false);
  const [provider, setProvider] = useState<AiProvider>('openai');
  const [apiKey, setApiKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [embeddingsKey, setEmbeddingsKey] = useState('');
  const [embeddingsKeyEdited, setEmbeddingsKeyEdited] = useState(false);
  const [hasStoredEmbeddingsKey, setHasStoredEmbeddingsKey] = useState(false);

  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/provider');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Não foi possível carregar a configuração.');
        return;
      }
      if (data.configured) {
        setConfigured(true);
        setProvider(data.provider);
        setHasStoredKey(Boolean(data.has_key));
        setApiKey(data.has_key ? MASKED_KEY : '');
        setKeyEdited(false);
        setHasStoredEmbeddingsKey(Boolean(data.has_embeddings_key));
        setEmbeddingsKey(data.has_embeddings_key ? MASKED_KEY : '');
        setEmbeddingsKeyEdited(false);
      }
    } catch {
      toast.error('Não foi possível carregar a configuração.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchConfig();
  }, [accountId, fetchConfig]);

  const keyPayload = () => (keyEdited ? apiKey.trim() : undefined);
  const embeddingsKeyPayload = () =>
    embeddingsKeyEdited ? embeddingsKey.trim() || null : undefined;

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/ai/provider/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, api_key: keyPayload() }),
      });
      const data = await res.json();
      if (res.ok) toast.success('Chave validada com sucesso.');
      else toast.error(data.error ?? 'A chave foi rejeitada pelo provedor.');
    } catch {
      toast.error('Não foi possível testar a chave agora.');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!configured && !keyEdited) {
      toast.error('Informe a chave de API.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ai/provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          api_key: keyPayload(),
          embeddings_api_key: embeddingsKeyPayload(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('Chave de API salva.');
        await fetchConfig();
        onSaved?.();
      } else {
        toast.error(data.error ?? 'Não foi possível salvar a chave.');
      }
    } catch {
      toast.error('Não foi possível salvar a chave.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (
      !window.confirm(
        'Remover a chave de API? Todos os agentes de IA param de funcionar até uma nova chave ser configurada.',
      )
    )
      return;
    setRemoving(true);
    try {
      const res = await fetch('/api/ai/provider', { method: 'DELETE' });
      if (res.ok) {
        toast.success('Chave removida.');
        setConfigured(false);
        setHasStoredKey(false);
        setApiKey('');
        setKeyEdited(false);
        setHasStoredEmbeddingsKey(false);
        setEmbeddingsKey('');
        setEmbeddingsKeyEdited(false);
      } else {
        const data = await res.json();
        toast.error(data.error ?? 'Não foi possível remover a chave.');
      }
    } catch {
      toast.error('Não foi possível remover a chave.');
    } finally {
      setRemoving(false);
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
        title="Chave de API"
        description="Uma única chave para toda a conta — todos os agentes de IA a usam. Cada agente ainda escolhe seu próprio modelo."
      />

      {!canEdit && (
        <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Apenas administradores podem configurar a chave de API.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-primary" /> Provedor e chave
          </CardTitle>
          <CardDescription>
            Sua chave é armazenada criptografada e nunca é reexibida — só indicamos que uma chave
            já está salva.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Provedor</Label>
            <Select
              value={provider}
              onValueChange={(v) => setProvider(v as AiProvider)}
              disabled={disabled}
            >
              <SelectTrigger>
                {/* Explicit lookup — a bare `<SelectValue />` shows the
                    raw stored value ("openai") until the popup opens once. */}
                <SelectValue>{(v: AiProvider) => PROVIDER_LABEL[v] ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">{PROVIDER_LABEL.openai}</SelectItem>
                <SelectItem value="anthropic">{PROVIDER_LABEL.anthropic}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="provider-key">Chave de API</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="provider-key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setKeyEdited(true);
                  }}
                  onFocus={() => {
                    if (!keyEdited && hasStoredKey) {
                      setApiKey('');
                      setKeyEdited(true);
                    }
                  }}
                  placeholder={KEY_PLACEHOLDER[provider]}
                  disabled={disabled}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
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

          <div className="space-y-2">
            <Label htmlFor="provider-embeddings-key">
              Chave de embeddings{' '}
              <span className="font-normal text-muted-foreground">
                (opcional, busca semântica na base de conhecimento)
              </span>
            </Label>
            <Input
              id="provider-embeddings-key"
              type="password"
              value={embeddingsKey}
              onChange={(e) => {
                setEmbeddingsKey(e.target.value);
                setEmbeddingsKeyEdited(true);
              }}
              onFocus={() => {
                if (!embeddingsKeyEdited && hasStoredEmbeddingsKey) {
                  setEmbeddingsKey('');
                  setEmbeddingsKeyEdited(true);
                }
              }}
              placeholder="sk-... (OpenAI)"
              disabled={disabled}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              {provider === 'openai'
                ? 'Pode ser a mesma chave acima, se ela também tiver acesso a embeddings.'
                : 'A Anthropic não tem API de embeddings — use uma chave OpenAI aqui para busca semântica.'}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 flex items-center justify-between">
        {configured ? (
          <Button
            variant="ghost"
            onClick={handleRemove}
            disabled={!canEdit || removing}
            className="text-destructive hover:text-destructive"
          >
            {removing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            Remover
          </Button>
        ) : (
          <span />
        )}

        <Button onClick={handleSave} disabled={disabled}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Salvar
        </Button>
      </div>
    </div>
  );
}
