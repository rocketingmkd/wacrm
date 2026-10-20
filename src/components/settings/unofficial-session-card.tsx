'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ChevronRight, Loader2, MessageSquareWarning } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Status = 'disconnected' | 'connecting' | 'connected';

interface UnofficialState {
  available: boolean;
  session: {
    status: Status;
    phone: string | null;
    enabled: boolean;
    allow_cold_open: boolean;
    risk_accepted_at: string | null;
    max_per_lead: number;
    daily_limit: number;
  } | null;
  qr: { base64: string | null; pairingCode: string | null } | null;
}

const STATUS_LABEL: Record<Status, string> = {
  disconnected: 'Desconectado',
  connecting: 'Aguardando leitura do QR',
  connected: 'Conectado',
};

/**
 * Opt-in Evolution (unofficial) session. Used only to reopen a
 * conversation when the 24h window is closed and for groups, never for
 * broadcasts. Off by default; turning it on needs the risk notice.
 */
export function UnofficialSessionCard({
  officialConnected = true,
}: {
  /** The official API is connected (the unofficial session pairs with the same number). */
  officialConnected?: boolean;
} = {}) {
  const [state, setState] = useState<UnofficialState | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [riskChecked, setRiskChecked] = useState(false);

  const applyResponse = useCallback(async (res: Response) => {
    if (res.status === 401 || res.status === 403) {
      setForbidden(true);
      return;
    }
    if (!res.ok) return;
    const data: UnofficialState = await res.json();
    // Polling must not wipe the QR the POST returned: GET carries none.
    setState((prev) => ({ ...data, qr: data.qr ?? prev?.qr ?? null }));
  }, []);

  const load = useCallback(
    () =>
      fetch('/api/whatsapp/unofficial')
        .then(applyResponse)
        .catch(() => {
          /* leave the card in its current state */
        }),
    [applyResponse],
  );

  useEffect(() => {
    let alive = true;
    fetch('/api/whatsapp/unofficial')
      .then((res) => (alive ? applyResponse(res) : undefined))
      .catch(() => {
        /* card stays hidden until the next successful load */
      });
    return () => {
      alive = false;
    };
  }, [applyResponse]);

  // While the QR is on screen, poll until the phone pairs.
  const pairing = open && state?.session?.status === 'connecting';
  useEffect(() => {
    if (!pairing) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [pairing, load]);

  const call = async (method: string, body?: unknown, okMsg?: string) => {
    setBusy(true);
    try {
      const res = await fetch('/api/whatsapp/unofficial', {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Não foi possível concluir a ação.');
        return;
      }
      setState(data);
      if (okMsg) toast.success(okMsg);
    } catch {
      toast.error('Falha de rede.');
    } finally {
      setBusy(false);
    }
  };

  if (forbidden) return null;
  if (!state) {
    return <div className="h-[74px] animate-pulse rounded-xl border border-border bg-card" />;
  }

  const session = state.session;
  const status: Status = session?.status ?? 'disconnected';
  const summary = !state.available
    ? 'Indisponível neste servidor'
    : session?.enabled
      ? `Ativa${session.phone ? ` · ${session.phone}` : ''}`
      : session
        ? `${STATUS_LABEL[status]} · desligada`
        : 'Desligada';

  const content = (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Serve só para reabrir uma conversa quando a janela de 24h está fechada e para grupos.
              Disparos em massa continuam 100% pela API oficial.
            </p>

            <Alert className="border-amber-500/40 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <AlertTitle className="text-amber-300">Risco de bloqueio do número</AlertTitle>
              <AlertDescription className="text-xs text-muted-foreground">
                Esta conexão não é oficial do WhatsApp. O número pode ser restringido ou banido, e
                como é o mesmo número da API oficial, o bloqueio afeta os dois lados. Use o mesmo
                número já conectado em Coexistência.
              </AlertDescription>
            </Alert>

            {!state.available ? (
              <p className="text-xs text-muted-foreground">
                O servidor ainda não tem a Evolution API configurada. Peça ao administrador da
                plataforma para definir EVOLUTION_API_URL e EVOLUTION_API_KEY.
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <p className="font-medium text-foreground">Conexão</p>
                    <p className="text-xs text-muted-foreground">
                      {STATUS_LABEL[status]}
                      {session?.phone ? ` · ${session.phone}` : ''}
                    </p>
                  </div>
                  {status !== 'connected' && (
                    <Button size="sm" onClick={() => call('POST')} disabled={busy}>
                      {busy && <Loader2 className="size-4 animate-spin" />}
                      {status === 'connecting' ? 'Gerar novo QR' : 'Conectar'}
                    </Button>
                  )}
                </div>

                {status === 'connecting' && state.qr?.base64 && (
                  <div className="flex flex-col items-center gap-2 rounded-lg border border-border p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={state.qr.base64}
                      alt="QR code para conectar o WhatsApp"
                      className="h-56 w-56 rounded bg-white p-2"
                    />
                    <p className="text-center text-xs text-muted-foreground">
                      No celular: WhatsApp, Aparelhos conectados, Conectar um aparelho.
                    </p>
                  </div>
                )}

                {status === 'connected' && (
                  <div className="space-y-3 rounded-lg border border-border p-3">
                    {!session?.risk_accepted_at && (
                      <label className="flex items-start gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={riskChecked}
                          onChange={(e) => setRiskChecked(e.target.checked)}
                        />
                        Entendo o risco de bloqueio e autorizo o uso da sessão não oficial neste
                        número.
                      </label>
                    )}
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-foreground">Ativar sessão não oficial</p>
                        <p className="text-xs text-muted-foreground">
                          Limites previstos: {session?.max_per_lead} mensagens por lead até
                          responder e {session?.daily_limit} por dia.
                        </p>
                      </div>
                      <Switch
                        checked={Boolean(session?.enabled)}
                        disabled={busy || (!session?.enabled && !session?.risk_accepted_at && !riskChecked)}
                        onCheckedChange={(enabled) =>
                          call(
                            'PATCH',
                            { enabled, accept_risk: riskChecked || undefined },
                            enabled ? 'Sessão não oficial ativada.' : 'Sessão não oficial desligada.',
                          )
                        }
                      />
                    </div>
                  </div>
                )}

                {session?.enabled && (
                  <div className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div className="pr-3">
                      <p className="font-medium text-foreground">Abrir conversa com número novo</p>
                      <p className="text-xs text-muted-foreground">
                        Permite mandar texto livre, pelo botão Nova conversa, para quem nunca falou
                        com você. É o uso de maior risco de bloqueio. Os limites por lead e por
                        dia continuam valendo.
                      </p>
                    </div>
                    <Switch
                      checked={Boolean(session.allow_cold_open)}
                      disabled={busy}
                      onCheckedChange={(allow_cold_open) =>
                        call(
                          'PATCH',
                          { allow_cold_open },
                          allow_cold_open
                            ? 'Abertura com número novo liberada.'
                            : 'Abertura com número novo desligada.',
                        )
                      }
                    />
                  </div>
                )}

                {session && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => call('DELETE', undefined, 'Sessão removida.')}
                    className="border-red-900 text-red-400 hover:bg-red-950/40 hover:text-red-300"
                  >
                    Remover sessão
                  </Button>
                )}
              </>
            )}
          </div>
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/50"
      >
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
            session?.enabled ? 'bg-amber-500/15' : 'bg-muted',
          )}
        >
          <MessageSquareWarning
            className={cn('h-5 w-5', session?.enabled ? 'text-amber-400' : 'text-muted-foreground')}
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">API Não oficial</p>
          <p className="truncate text-xs text-muted-foreground">{summary}</p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
            session?.enabled
              ? 'bg-emerald-500/15 text-emerald-500'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {!state.available ? 'Indisponível' : session?.enabled ? 'Ativa' : 'Desligada'}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto border-border bg-popover sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">API Não oficial</DialogTitle>
          </DialogHeader>
          {!officialConnected && (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              Conecte primeiro a API Oficial. A sessão não oficial usa o mesmo número, em Coexistência.
            </p>
          )}
          {content}
        </DialogContent>
      </Dialog>
    </div>
  );
}
