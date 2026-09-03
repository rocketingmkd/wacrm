'use client';

// /platform/accounts — the account list. Follows the same
// pagination/search pattern as src/app/(dashboard)/contacts/page.tsx
// (PAGE_SIZE=25, a fetchSeq ref to drop out-of-order responses, range
// pagination), but fetches through /api/platform/accounts (a
// service-role read of platform_account_overview) instead of a
// direct Supabase browser query, since that view isn't grant-readable
// by authenticated at all — cross-tenant reads only ever go through
// the service role, filtered explicitly, per requirePlatformAdmin()'s
// design (see src/lib/auth/platform.ts).

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BILLING_STATUSES, type BillingStatus } from '@/lib/billing/state';
import { isPlan } from '@/lib/billing/plan';

const PAGE_SIZE = 25;

interface AccountRow {
  id: string;
  name: string;
  created_at: string;
  owner_email: string | null;
  owner_name: string | null;
  status: BillingStatus | null;
  plan: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  member_count: number;
  contact_count: number;
}

const STATUS_LABEL: Record<BillingStatus, string> = {
  trialing: 'Em teste',
  active: 'Ativo',
  past_due: 'Pagamento pendente',
  expired: 'Trial expirado',
  canceled: 'Cancelado',
};

const PLAN_LABEL: Record<'starter' | 'pro', string> = {
  starter: 'Starter',
  pro: 'Pro',
};

const STATUS_TONE: Record<BillingStatus, string> = {
  trialing: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  active: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  past_due: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  expired: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  canceled: 'border-neutral-500/30 bg-neutral-500/10 text-neutral-600 dark:text-neutral-400',
};

function StatusBadge({ status }: { status: BillingStatus | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <Badge variant="outline" className={STATUS_TONE[status]}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function PlatformAccountsPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<BillingStatus | 'all'>('all');
  const [page, setPage] = useState(0);
  const fetchSeq = useRef(0);

  const fetchAccounts = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (search.trim()) params.set('q', search.trim());
      if (status !== 'all') params.set('status', status);

      const res = await fetch(`/api/platform/accounts?${params.toString()}`);
      if (seq !== fetchSeq.current) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Falha ao carregar contas (${res.status})`);
      }
      const body = await res.json();
      if (seq !== fetchSeq.current) return;
      setAccounts(body.accounts ?? []);
      setTotalCount(body.total_count ?? 0);
    } catch (err) {
      if (seq !== fetchSeq.current) return;
      setError(err instanceof Error ? err.message : 'Falha ao carregar contas');
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  }, [page, search, status]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // Debounce search input — reset to page 0 on any filter change.
  useEffect(() => {
    const t = setTimeout(() => setPage(0), 300);
    return () => clearTimeout(t);
  }, [search, status]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasPrev = page > 0;
  const hasNext = page < totalPages - 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Contas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {totalCount} conta{totalCount === 1 ? '' : 's'} no total.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome da conta ou e-mail do dono..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as BillingStatus | 'all')}>
          <SelectTrigger className="w-48 flex-shrink-0">
            <SelectValue>
              {(v: BillingStatus | 'all') => (v === 'all' ? 'Todos os status' : STATUS_LABEL[v])}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {BILLING_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card">
          <p className="text-sm text-red-500">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchAccounts}>
            Tentar de novo
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Conta</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="hidden text-muted-foreground md:table-cell">Plano</TableHead>
                <TableHead className="hidden text-muted-foreground lg:table-cell">
                  Trial/período termina
                </TableHead>
                <TableHead className="hidden text-right text-muted-foreground sm:table-cell">
                  Membros
                </TableHead>
                <TableHead className="hidden text-muted-foreground sm:table-cell">Criada em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : accounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                    Nenhuma conta encontrada.
                  </TableCell>
                </TableRow>
              ) : (
                accounts.map((a) => (
                  <TableRow key={a.id} className="border-border">
                    <TableCell>
                      <Link
                        href={`/platform/accounts/${a.id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {a.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{a.owner_email ?? '—'}</p>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={a.status} />
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {isPlan(a.plan) ? PLAN_LABEL[a.plan] : (a.plan ?? '—')}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">
                      {fmtDate(a.status === 'trialing' ? a.trial_ends_at : a.current_period_end)}
                    </TableCell>
                    <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
                      {a.member_count}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {fmtDate(a.created_at)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} de{' '}
            {totalCount}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!hasPrev}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
