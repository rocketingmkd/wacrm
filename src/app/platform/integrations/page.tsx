'use client';

// /platform/integrations — health of the Rocketing Pay billing
// webhook: the URL to configure over there, a UI-driven "generate
// key" flow (plaintext shown exactly once, same reveal-once
// convention as Settings → API keys), and a self-test button that
// fires a harmless synthetic event through the real auth+processing
// pipeline so staff can watch it land in Logs without needing a real
// Rocketing Pay transaction.

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Copy, KeyRound, Loader2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface IntegrationsData {
  rocketing_pay: {
    webhook_path: string;
    token_configured: boolean;
    token_prefix: string | null;
    token_generated_at: string | null;
    last_delivery_at: string | null;
    last_7d: { success: number; ignored: number; error: number; no_account: number };
  };
  product_plan_map: {
    configured_products: number;
    entries: Record<string, string>;
  };
}

interface TestResult {
  action: string;
  outcome: string;
  resolved_status: string;
  received_at: string;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return 'Nunca';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function PlatformIntegrationsPage() {
  const [data, setData] = useState<IntegrationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Generate-key flow state. `newToken` only ever lives in memory —
  // never sent anywhere but the confirmation dialog and (if the
  // staff member clicks it) the self-test call below. Closing the
  // dialog wipes it; there is no "show it again" path by design.
  const [genOpen, setGenOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const webhookUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/api/billing/webhook` : '';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/platform/integrations');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Falha ao carregar (${res.status})`);
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copiado.`);
    } catch {
      toast.error('Não foi possível copiar.');
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/platform/integrations/webhook-token', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Falha ao gerar a chave');
      setNewToken(body.token);
      setGenOpen(true);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao gerar a chave');
    } finally {
      setGenerating(false);
    }
  }

  async function handleSendTest() {
    if (!newToken) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/platform/integrations/test-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: newToken }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Falha ao enviar o evento de teste');
      setTestResult(body.result);
      toast.success('Evento de teste processado — confira em Logs.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao enviar o evento de teste');
    } finally {
      setTesting(false);
    }
  }

  function closeGenDialog(open: boolean) {
    setGenOpen(open);
    if (!open) {
      // The whole point: once this dialog closes, the plaintext is
      // gone from memory for good. Regenerate to get another look.
      setNewToken(null);
      setTestResult(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-red-500">
        {error ?? 'Falha ao carregar integrações.'}
      </div>
    );
  }

  const { rocketing_pay, product_plan_map } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Integrações</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Conexões externas que alimentam o painel de cobrança.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rocketing Pay — webhook de cobrança</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <Label className="text-xs text-muted-foreground">
              URL do webhook (cole no cadastro de webhook da Rocketing Pay)
            </Label>
            <div className="mt-1.5 flex gap-2">
              <Input readOnly value={webhookUrl} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" variant="outline" onClick={() => copy(webhookUrl, 'URL')}>
                <Copy className="size-4" />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
            {rocketing_pay.token_configured ? (
              <Badge
                variant="outline"
                className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              >
                <CheckCircle2 className="size-3.5" /> Chave gerada
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="gap-1 border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
              >
                <XCircle className="size-3.5" /> Nenhuma chave gerada
              </Badge>
            )}
            {rocketing_pay.token_configured && (
              <span className="text-xs text-muted-foreground">
                <code>{rocketing_pay.token_prefix}</code> · gerada em{' '}
                {fmtDateTime(rocketing_pay.token_generated_at)}
              </span>
            )}
            <Button size="sm" variant="outline" className="ml-auto" disabled={generating} onClick={handleGenerate}>
              {generating ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <KeyRound className="size-3.5" />
              )}
              {rocketing_pay.token_configured ? 'Gerar nova chave' : 'Gerar chave'}
            </Button>
          </div>
          {rocketing_pay.token_configured && (
            <p className="text-xs text-muted-foreground">
              Gerar uma chave nova invalida a anterior na hora — a Rocketing Pay precisa ser
              reconfigurada com o valor novo antes de continuar enviando eventos.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Última entrega recebida</p>
              <p className="text-sm font-medium text-foreground">
                {fmtDateTime(rocketing_pay.last_delivery_at)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Últimos 7 dias</p>
              <p className="text-sm text-foreground">
                {rocketing_pay.last_7d.success} sucesso · {rocketing_pay.last_7d.ignored} ignorado
                {rocketing_pay.last_7d.error > 0 && (
                  <span className="text-red-500"> · {rocketing_pay.last_7d.error} erro</span>
                )}
                {rocketing_pay.last_7d.no_account > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">
                    {' '}
                    · {rocketing_pay.last_7d.no_account} sem conta
                  </span>
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mapa de produtos → planos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {product_plan_map.configured_products === 0 ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
              Nenhum produto mapeado ainda — todo evento de pagamento aprovado vai cair como
              plano indefinido. Preencha <code>PRODUCT_PLAN_MAP</code> em{' '}
              <code>src/lib/billing/rocketing-pay.ts</code> com os <code>produto_id</code> reais
              da Rocketing Pay.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {Object.entries(product_plan_map.entries).map(([productId, plan]) => (
                <li key={productId} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-muted-foreground">Produto {productId}</span>
                  <span className="font-medium text-foreground">{plan}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={genOpen} onOpenChange={closeGenDialog}>
        <DialogContent className="border-border bg-popover sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">Chave gerada</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Copie agora e cole no cadastro de webhook da Rocketing Pay — esse valor não vai
              aparecer de novo depois que você fechar esta janela.
            </DialogDescription>
          </DialogHeader>

          {newToken && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">Token</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={newToken}
                    className="font-mono text-xs"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button type="button" variant="outline" onClick={() => copy(newToken, 'Token')}>
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Envia um evento sintético (e-mail falso, não afeta nenhuma conta real) pra
                    provar que auth + processamento estão funcionando.
                  </p>
                  <Button size="sm" variant="outline" disabled={testing} onClick={handleSendTest}>
                    {testing ? <Loader2 className="size-3.5 animate-spin" /> : 'Enviar evento de teste'}
                  </Button>
                </div>
                {testResult && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline">{testResult.outcome}</Badge>
                    <span className="text-muted-foreground">ação: {testResult.action}</span>
                    <span className="text-muted-foreground">evento: {testResult.resolved_status}</span>
                    <span className="ml-auto text-muted-foreground">
                      Recebido {fmtDateTime(testResult.received_at)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => closeGenDialog(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
