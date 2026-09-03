'use client';

// /platform/webhooks — every Rocketing Pay webhook delivery attempt
// across all accounts, most recent first, in a real table with a
// "ver JSON" action per row (WebhookPayloadDialog) — the same role
// finance_webhook_logs played diagnosing a "Pix payment vanished"
// case in the DSC app, now with the actual payload one click away
// instead of just the derived columns.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Code2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import {
  WebhookPayloadDialog,
  type WebhookLogDetail,
} from '../_components/webhook-payload-dialog';

const PAGE_SIZE = 25;

interface WebhookLogRow extends WebhookLogDetail {
  account_id: string | null;
  external_product_id: string | null;
}

const OUTCOME_TONE: Record<WebhookLogRow['outcome'], string> = {
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

export default function PlatformWebhooksPage() {
  const [logs, setLogs] = useState<WebhookLogRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<'all' | WebhookLogRow['outcome']>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<WebhookLogRow | null>(null);
  const fetchSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (outcome !== 'all') params.set('outcome', outcome);
      if (search.trim()) params.set('q', search.trim());
      const res = await fetch(`/api/platform/webhook-logs?${params.toString()}`);
      if (seq !== fetchSeq.current) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Falha ao carregar webhooks (${res.status})`);
      }
      const body = await res.json();
      if (seq !== fetchSeq.current) return;
      setLogs(body.logs ?? []);
      setTotalCount(body.total_count ?? 0);
    } catch (err) {
      if (seq !== fetchSeq.current) return;
      setError(err instanceof Error ? err.message : 'Falha ao carregar webhooks');
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  }, [page, outcome, search]);

  useEffect(() => {
    load();
  }, [load]);

  // Debounce search — reset to page 0 on any filter change.
  useEffect(() => {
    const t = setTimeout(() => setPage(0), 300);
    return () => clearTimeout(t);
  }, [search, outcome]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Logs — Rocketing Pay</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {totalCount} entrega{totalCount === 1 ? '' : 's'} registrada{totalCount === 1 ? '' : 's'}.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por e-mail do comprador..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={outcome} onValueChange={(v) => setOutcome(v as typeof outcome)}>
          <SelectTrigger className="w-48 flex-shrink-0">
            <SelectValue>
              {(v: typeof outcome) =>
                ({ all: 'Todos os resultados', success: 'Sucesso', ignored: 'Ignorado', error: 'Erro' })[v]
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os resultados</SelectItem>
            <SelectItem value="success">Sucesso</SelectItem>
            <SelectItem value="ignored">Ignorado</SelectItem>
            <SelectItem value="error">Erro</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card">
          <p className="text-sm text-red-500">{error}</p>
          <Button variant="outline" size="sm" onClick={load}>
            Tentar de novo
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="text-muted-foreground">Ação</TableHead>
                <TableHead className="hidden text-muted-foreground md:table-cell">Evento</TableHead>
                <TableHead className="text-muted-foreground">E-mail</TableHead>
                <TableHead className="hidden text-muted-foreground lg:table-cell">Conta</TableHead>
                <TableHead className="hidden text-right text-muted-foreground sm:table-cell">
                  Valor
                </TableHead>
                <TableHead className="text-muted-foreground">Recebido</TableHead>
                <TableHead className="text-muted-foreground" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-sm text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-sm text-muted-foreground">
                    Nenhum webhook recebido ainda.
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow
                    key={log.id}
                    className="cursor-pointer border-border hover:bg-muted/50"
                    onClick={() => setSelected(log)}
                  >
                    <TableCell>
                      <Badge variant="outline" className={OUTCOME_TONE[log.outcome]}>
                        {log.outcome}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium text-foreground">{log.action}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {log.event ?? '—'}
                    </TableCell>
                    <TableCell className="max-w-40 truncate text-muted-foreground">
                      {log.email ?? '—'}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {log.account_id ? (
                        <Link
                          href={`/platform/accounts/${log.account_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-primary hover:underline"
                        >
                          ver conta
                        </Link>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                        >
                          sem conta
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
                      {log.amount != null ? `R$ ${log.amount}` : '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {fmtDateTime(log.received_at)}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected(log);
                        }}
                      >
                        <Code2 className="size-3.5" /> JSON
                      </Button>
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
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}

      <WebhookPayloadDialog log={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
