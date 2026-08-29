'use client';

// /platform/integrations — health of the Rocketing Pay billing
// webhook: is the shared secret configured, when did the last
// delivery land, and how the last 7 days broke down.

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface IntegrationsData {
  rocketing_pay: {
    webhook_path: string;
    token_configured: boolean;
    last_delivery_at: string | null;
    last_7d: { success: number; ignored: number; error: number; no_account: number };
  };
  product_plan_map: {
    configured_products: number;
    entries: Record<string, string>;
  };
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

  useEffect(() => {
    fetch('/api/platform/integrations')
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Falha ao carregar (${res.status})`);
        }
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Falha ao carregar'))
      .finally(() => setLoading(false));
  }, []);

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
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Rocketing Pay — webhook de cobrança</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Endpoint: <code className="text-xs">{rocketing_pay.webhook_path}</code>
            </p>
          </div>
          {rocketing_pay.token_configured ? (
            <Badge
              variant="outline"
              className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            >
              <CheckCircle2 className="size-3.5" /> Token configurado
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="gap-1 border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
            >
              <XCircle className="size-3.5" /> Token ausente
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!rocketing_pay.token_configured && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
              <code>ROCKETING_PAY_WEBHOOK_TOKEN</code> não está setado no ambiente — todo
              webhook recebido está sendo rejeitado com 401.
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
    </div>
  );
}
