'use client';

// /platform/webhooks — every Rocketing Pay webhook delivery attempt
// across all accounts, most recent first. Same role finance_webhook_logs
// played diagnosing a "Pix payment vanished" case in the DSC app —
// no_account rows are the most common real-world cause (checkout used
// a different e-mail than the account), so those get a visible flag.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const PAGE_SIZE = 25;

interface WebhookLogRow {
  id: string;
  received_at: string;
  account_id: string | null;
  email: string | null;
  event: string | null;
  resolved_status: string | null;
  action: string;
  outcome: 'success' | 'ignored' | 'error';
  error_message: string | null;
  external_transaction_id: string | null;
  external_product_id: string | null;
  amount: number | null;
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
  const [page, setPage] = useState(0);
  const fetchSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (outcome !== 'all') params.set('outcome', outcome);
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
  }, [page, outcome]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Webhooks — Rocketing Pay</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {totalCount} entrega{totalCount === 1 ? '' : 's'} registrada{totalCount === 1 ? '' : 's'}.
        </p>
      </div>

      <Select value={outcome} onValueChange={(v) => { setOutcome(v as typeof outcome); setPage(0); }}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos os resultados</SelectItem>
          <SelectItem value="success">Sucesso</SelectItem>
          <SelectItem value="ignored">Ignorado</SelectItem>
          <SelectItem value="error">Erro</SelectItem>
        </SelectContent>
      </Select>

      {error ? (
        <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card">
          <p className="text-sm text-red-500">{error}</p>
          <Button variant="outline" size="sm" onClick={load}>Tentar de novo</Button>
        </div>
      ) : loading ? (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
          Carregando...
        </div>
      ) : logs.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
          Nenhum webhook recebido ainda.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <ul className="divide-y divide-border">
            {logs.map((log) => (
              <li key={log.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <Badge variant="outline" className={OUTCOME_TONE[log.outcome]}>
                  {log.outcome}
                </Badge>
                <span className="font-medium text-foreground">{log.action}</span>
                <span className="text-muted-foreground">{log.event ?? '—'}</span>
                <span className="text-muted-foreground">{log.email ?? '—'}</span>
                {log.action === 'no_account' && (
                  <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                    sem conta correspondente
                  </Badge>
                )}
                {log.account_id && (
                  <Link
                    href={`/platform/accounts/${log.account_id}`}
                    className="text-primary hover:underline"
                  >
                    ver conta
                  </Link>
                )}
                {log.error_message && <span className="text-red-500">{log.error_message}</span>}
                <span className="ml-auto text-xs text-muted-foreground">
                  {fmtDateTime(log.received_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} de {totalCount}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              Anterior
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
              Próxima
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
