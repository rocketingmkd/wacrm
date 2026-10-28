'use client';

// /platform — the Master "Painel": account health at a glance
// (counts by billing status, new accounts, volume, estimated MRR), a
// 12-month growth chart, recent signups and recent webhook activity.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  Banknote,
  Building2,
  Clock,
  KanbanSquare,
  Loader2,
  MessageSquareText,
  Sparkles,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { type BillingStatus } from '@/lib/billing/state';
import type { GrowthPoint } from '@/lib/platform/overview';
import { MasterKpi } from './_components/master-kpi';
import { STATUS_LABEL, STATUS_TONE, formatBRL } from './_components/billing-ui';

interface DashboardData {
  total_accounts: number;
  by_status: Record<BillingStatus, number>;
  new_this_month: number;
  messages_total: number;
  deals_total: number;
  mrr_estimate: number;
  growth: GrowthPoint[];
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

const OUTCOME_TONE: Record<'success' | 'ignored' | 'error', string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dm:text-emerald-300',
  ignored: 'border-neutral-500/30 bg-neutral-500/10 text-neutral-600 dm:text-neutral-400',
  error: 'border-red-500/30 bg-red-500/10 text-red-700 dm:text-red-300',
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const fmtInt = (n: number) => n.toLocaleString('pt-BR');

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
        <Loader2 className="size-6 animate-spin text-red-500" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-red-500">
        {error ?? 'Falha ao carregar o painel.'}
      </div>
    );
  }

  const activePct = Math.round((data.by_status.active / Math.max(1, data.total_accounts)) * 100);

  return (
    <div className="space-y-5">
      <header className="min-w-0">
        <h1 className="font-display text-xl font-bold sm:text-2xl">Painel Master</h1>
        <p className="text-xs text-muted-foreground">Visão geral de toda a plataforma.</p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-6">
        <MasterKpi
          accent
          icon={<Building2 className="size-4" />}
          label="Contas"
          value={fmtInt(data.total_accounts)}
          hint={`+${data.new_this_month} este mês`}
        />
        <MasterKpi
          icon={<Activity className="size-4" />}
          label={STATUS_LABEL.active}
          value={fmtInt(data.by_status.active)}
          hint={`${activePct}% do total`}
        />
        <MasterKpi
          icon={<Sparkles className="size-4" />}
          label={STATUS_LABEL.trialing}
          value={fmtInt(data.by_status.trialing)}
        />
        <MasterKpi
          icon={<Clock className="size-4" />}
          label={STATUS_LABEL.past_due}
          value={fmtInt(data.by_status.past_due)}
        />
        <MasterKpi
          icon={<XCircle className="size-4" />}
          label={STATUS_LABEL.expired}
          value={fmtInt(data.by_status.expired)}
        />
        <MasterKpi
          icon={<XCircle className="size-4" />}
          label={STATUS_LABEL.canceled}
          value={fmtInt(data.by_status.canceled)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MasterKpi
          icon={<TrendingUp className="size-4" />}
          label="Novas no mês"
          value={fmtInt(data.new_this_month)}
        />
        <MasterKpi
          icon={<Banknote className="size-4" />}
          label="MRR estimado"
          value={formatBRL(data.mrr_estimate)}
          hint="apenas contas ativas"
        />
        <MasterKpi
          icon={<MessageSquareText className="size-4" />}
          label="Mensagens (total)"
          value={fmtInt(data.messages_total)}
        />
        <MasterKpi
          icon={<KanbanSquare className="size-4" />}
          label="Negócios no funil (total)"
          value={fmtInt(data.deals_total)}
        />
      </div>

      {data.no_account_7d > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dm:text-amber-300">
          {data.no_account_7d} webhook{data.no_account_7d === 1 ? '' : 's'} nos últimos 7 dias
          não encontrou{data.no_account_7d === 1 ? '' : 'ram'} uma conta correspondente.{' '}
          <Link href="/platform/webhooks" className="underline">
            Ver logs
          </Link>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display text-[15px] font-semibold">Crescimento de contas</h2>
        <p className="mb-3 text-xs text-muted-foreground">Total acumulado nos últimos 12 meses</p>
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.growth} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" fontSize={11} stroke="var(--muted-foreground)" tickLine={false} />
              <YAxis fontSize={11} allowDecimals={false} stroke="var(--muted-foreground)" tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: 'var(--popover)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  color: 'var(--popover-foreground)',
                }}
                formatter={(value) => [fmtInt(Number(value)), 'Contas']}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.key ?? ''}
              />
              <Line
                type="monotone"
                dataKey="total"
                stroke="#ef4444"
                strokeWidth={2.5}
                dot={{ r: 3, fill: '#ef4444' }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

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
