'use client';

// WebhookPayloadDialog — shows the raw JSON Rocketing Pay actually
// sent for one webhook_logs row (plus the request headers, auth
// already masked server-side in billing_webhook_logs.headers). Shared
// between /platform/webhooks and the per-account log list on
// /platform/accounts/[accountId] so "ver o JSON" looks the same
// everywhere.

import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export interface WebhookLogDetail {
  id: string;
  received_at: string;
  event: string | null;
  resolved_status: string | null;
  action: string;
  outcome: 'success' | 'ignored' | 'error';
  error_message: string | null;
  email?: string | null;
  amount: number | null;
  external_transaction_id: string | null;
  payload: unknown;
  headers: unknown;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

async function copyJson(value: unknown, label: string) {
  try {
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
    toast.success(`${label} copiado.`);
  } catch {
    toast.error('Não foi possível copiar.');
  }
}

export function WebhookPayloadDialog({
  log,
  onClose,
}: {
  log: WebhookLogDetail | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={log !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-border bg-popover sm:max-w-2xl">
        {log && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 text-popover-foreground">
                Evento recebido
                <Badge variant="outline">{log.outcome}</Badge>
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {fmtDateTime(log.received_at)} · ação: {log.action}
                {log.resolved_status ? ` · status: ${log.resolved_status}` : ''}
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Evento (raw)</p>
                <p className="text-foreground">{log.event ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">E-mail</p>
                <p className="truncate text-foreground">{log.email ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Transação</p>
                <p className="truncate text-foreground">{log.external_transaction_id ?? '—'}</p>
              </div>
              {log.amount != null && (
                <div>
                  <p className="text-xs text-muted-foreground">Valor</p>
                  <p className="text-foreground">R$ {log.amount}</p>
                </div>
              )}
              {log.error_message && (
                <div className="col-span-full">
                  <p className="text-xs text-muted-foreground">Erro</p>
                  <p className="text-red-500">{log.error_message}</p>
                </div>
              )}
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">Payload (JSON)</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => copyJson(log.payload, 'Payload')}
                >
                  <Copy className="size-3.5" /> Copiar
                </Button>
              </div>
              <pre className="max-h-72 overflow-auto rounded-md border border-border bg-background p-3 text-[11px] text-foreground">
                {JSON.stringify(log.payload, null, 2)}
              </pre>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">
                  Headers da requisição
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => copyJson(log.headers, 'Headers')}
                >
                  <Copy className="size-3.5" /> Copiar
                </Button>
              </div>
              <pre className="max-h-40 overflow-auto rounded-md border border-border bg-background p-3 text-[11px] text-muted-foreground">
                {JSON.stringify(log.headers, null, 2)}
              </pre>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
