'use client';

// /platform — the dashboard landing page: account health at a
// glance (trial/active/past_due/expired/canceled counts), recent
// signups, and recent webhook activity. Same role the overview
// screen plays in the DSC admin panel.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { BILLING_STATUSES, type BillingStatus } from '@/lib/billing/state';

interface DashboardData {
  total_accounts: number;
  by_status: Record<BillingStatus, number>;
  recent_accounts: {
    id: string;
    name: string;
    owner_email: string | null;
    status: BillingStatus | null;
    created_at: string;
  }[];
  recent_webhooks: {
    id: string;
    received_at: string;
    event: string | null;
    action: string;
    outcome: 'success' | 'ignored' | 'error';
    email: string | null;
  }[];
  webhooks_7d: number;
  webhook_errors_7d: number;
  no_account_7d: number;
}

const STATUS_LABEL: Record<BillingStatus, string> = {
  trialing: 'Em teste',
  active: 'Ativo',
  past_due: 'Pagamento pendente',
  expired: 'Trial expirado',
  canceled: 'Cancelado',
};

const STATUS_TONE: Record<BillingStatus, string> = {
  trialing: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  active: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  past_due: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  expired: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  canceled: 'border-neutral-500/30 bg-neutral-500/10 text-neutral-600 dark:text-neutral-400',
};

const OUTCOME_TONE: Record<'success' | 'ignored' | 'error', string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  ignored: 'border-neutral-500/30 bg-neutral-500/10 text-neutral-600 dark:text-neutral-400',
  error: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function PlatformDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/platform/dashboard')
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
        {error ?? 'Falha ao carregar o dashboard.'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Visão geral das contas e da cobrança do Rocketing CRM.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Total de contas
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{data.total_accounts}</CardContent>
        </Card>
        {BILLING_STATUSES.map((s) => (
          <Card size="sm" key={s}>
            <CardHeader>
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {STATUS_LABEL[s]}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{data.by_status[s]}</CardContent>
          </Card>
        ))}
      </div>

      {data.no_account_7d > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
          {data.no_account_7d} webhook{data.no_account_7d === 1 ? '' : 's'} nos últimos 7 dias
          não encontrou{data.no_account_7d === 1 ? '' : 'ram'} uma conta correspondente.{' '}
          <Link href="/platform/webhooks" className="underline">
            Ver logs
          </Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Contas recentes</CardTitle>
            <Link
              href="/platform/accounts"
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              Ver todas
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {data.recent_accounts.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                Nenhuma conta ainda.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {data.recent_accounts.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/platform/accounts/${a.id}`}
                        className="truncate font-medium text-foreground hover:underline"
                      >
                        {a.name}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">{a.owner_email}</p>
                    </div>
                    {a.status && (
                      <Badge variant="outline" className={STATUS_TONE[a.status]}>
                        {STATUS_LABEL[a.status]}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Webhooks recentes</CardTitle>
            <Link
              href="/platform/webhooks"
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              Ver todos
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {data.recent_webhooks.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                Nenhum webhook recebido ainda.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {data.recent_webhooks.map((w) => (
                  <li key={w.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                    <Badge variant="outline" className={OUTCOME_TONE[w.outcome]}>
                      {w.outcome}
                    </Badge>
                    <span className="truncate text-muted-foreground">{w.action}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {fmtDateTime(w.received_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
