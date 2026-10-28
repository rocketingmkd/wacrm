'use client';

// /platform/subscriptions — "Assinaturas": every account's billing line
// (plan, status, next charge, last payment) with the headline numbers.
// Read-only; changes to an account's billing are made on its detail page.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Activity, AlertTriangle, Banknote, Loader2, Search, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { BILLING_STATUSES, type BillingStatus } from '@/lib/billing/state';
import { cn } from '@/lib/utils';
import { MasterKpi } from '../_components/master-kpi';
import {
  STATUS_LABEL,
  STATUS_TONE,
  formatBRL,
  formatDate,
  formatPaymentMethod,
} from '../_components/billing-ui';

interface Row {
  id: string;
  name: string;
  owner_email: string | null;
  status: BillingStatus | null;
  plan: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  past_due_since: string | null;
  created_at: string;
  list_price: number;
  last_payment_at: string | null;
  last_payment_amount: number | null;
  last_payment_method: string | null;
}

interface Summary {
  mrr: number;
  active: number;
  trialing: number;
  pastDue: number;
}

const PLAN_LABEL: Record<string, string> = { starter: 'Starter', pro: 'Pro' };

function nextCharge(r: Row): string {
  if (r.status === 'trialing') return r.trial_ends_at ? `Teste até ${formatDate(r.trial_ends_at)}` : '—';
  if (r.status === 'active' || r.status === 'past_due') return formatDate(r.current_period_end, true);
  return '—';
}

export default function PlatformSubscriptionsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<BillingStatus | 'all'>('all');

  useEffect(() => {
    fetch('/api/platform/subscriptions')
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Falha ao carregar (${res.status})`);
        return body as { rows: Row[]; summary: Summary };
      })
      .then((b) => {
        setRows(b.rows);
        setSummary(b.summary);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Falha ao carregar'));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (status !== 'all' && r.status !== status) return false;
      if (!q) return true;
      return [r.name, r.owner_email, r.plan, r.id].some((v) => (v ?? '').toLowerCase().includes(q));
    });
  }, [rows, search, status]);

  if (error) {
    return <div className="flex h-64 items-center justify-center text-sm text-red-500">{error}</div>;
  }
  if (!rows || !summary) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-red-500" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-xl font-bold sm:text-2xl">Assinaturas</h1>
        <p className="text-xs text-muted-foreground">Plano, cobrança e último pagamento de cada conta.</p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MasterKpi
          accent
          icon={<Banknote className="size-4" />}
          label="MRR estimado"
          value={formatBRL(summary.mrr)}
          hint="apenas contas ativas"
        />
        <MasterKpi icon={<Activity className="size-4" />} label="Ativas" value={summary.active} />
        <MasterKpi icon={<Sparkles className="size-4" />} label="Em teste" value={summary.trialing} />
        <MasterKpi icon={<AlertTriangle className="size-4" />} label="Inadimplentes" value={summary.pastDue} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar por conta, e-mail, plano ou ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['all', ...BILLING_STATUSES] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              aria-pressed={status === s}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                status === s
                  ? 'bg-red-500/10 text-red-600 shadow-[inset_0_0_0_1px_rgba(239,68,68,0.3)] dm:text-red-300'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {s === 'all' ? 'Todos' : STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Conta</th>
                <th className="px-4 py-3 text-left font-medium">Plano</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Próxima cobrança</th>
                <th className="px-4 py-3 text-left font-medium">Último pagamento</th>
                <th className="px-4 py-3 text-left font-medium">Criada</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    Nenhuma assinatura encontrada.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link href={`/platform/accounts/${r.id}`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{r.owner_email ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      {r.plan ? (
                        <>
                          {PLAN_LABEL[r.plan] ?? r.plan}
                          {r.list_price > 0 && (
                            <p className="text-xs text-muted-foreground">{formatBRL(r.list_price)}/mês</p>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.status ? (
                        <Badge variant="outline" className={STATUS_TONE[r.status]}>
                          {STATUS_LABEL[r.status]}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{nextCharge(r)}</td>
                    <td className="px-4 py-3">
                      {r.last_payment_at ? (
                        <>
                          {r.last_payment_amount != null ? formatBRL(Number(r.last_payment_amount)) : '—'}
                          <p className="text-xs text-muted-foreground">
                            {formatPaymentMethod(r.last_payment_method)} · {formatDate(r.last_payment_at)}
                          </p>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(r.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        O MRR é estimado pelo preço de tabela do plano (Starter R$ 97, Pro R$ 197). Valores com
        desconto aparecem em &quot;Último pagamento&quot;.
      </p>
    </div>
  );
}
