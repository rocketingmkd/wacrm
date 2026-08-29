'use client';

// /platform/accounts/[accountId] — the account detail + staff actions.
// Every mutation goes through PATCH /api/platform/accounts/[id]/billing
// (the only write path into account_billing outside the Rocketing Pay
// webhook — see that route's header comment) and is logged to
// platform_audit_log with a before/after snapshot.

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BILLING_STATUSES, type BillingStatus } from '@/lib/billing/state';

interface AccountDetail {
  id: string;
  name: string;
  created_at: string;
  owner_email: string | null;
  owner_name: string | null;
  status: BillingStatus | null;
  plan: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  external_subscription_id: string | null;
  past_due_since: string | null;
  notes: string | null;
  member_count: number;
  contact_count: number;
}

interface WebhookLogRow {
  id: string;
  received_at: string;
  event: string | null;
  resolved_status: string | null;
  action: string;
  outcome: 'success' | 'ignored' | 'error';
  error_message: string | null;
  amount: number | null;
  external_transaction_id: string | null;
}

interface AuditLogRow {
  id: string;
  actor_user_id: string | null;
  action: string;
  before: unknown;
  after: unknown;
  created_at: string;
}

const STATUS_LABEL: Record<BillingStatus, string> = {
  trialing: 'Em teste',
  active: 'Ativo',
  past_due: 'Pagamento pendente',
  expired: 'Trial expirado',
  canceled: 'Cancelado',
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const OUTCOME_TONE: Record<WebhookLogRow['outcome'], string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  ignored: 'border-neutral-500/30 bg-neutral-500/10 text-neutral-600 dark:text-neutral-400',
  error: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
};

export default function PlatformAccountDetailPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = use(params);

  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [webhookLogs, setWebhookLogs] = useState<WebhookLogRow[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Form state
  const [trialDays, setTrialDays] = useState('7');
  const [planInput, setPlanInput] = useState('');
  const [forceStatus, setForceStatus] = useState<BillingStatus>('active');
  const [statusNote, setStatusNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform/accounts/${accountId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Falha ao carregar conta (${res.status})`);
      }
      const body = await res.json();
      setAccount(body.account);
      setWebhookLogs(body.webhook_logs ?? []);
      setAuditLog(body.audit_log ?? []);
      setPlanInput(body.account?.plan ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar conta');
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  async function runAction(action: string, payload: Record<string, unknown>) {
    setBusy(action);
    try {
      const res = await fetch(`/api/platform/accounts/${accountId}/billing`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Falha ao aplicar a ação');
      toast.success('Atualizado com sucesso.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao aplicar a ação');
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !account) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-500">{error ?? 'Conta não encontrada.'}</p>
        <Button variant="outline" size="sm" onClick={load}>
          Tentar de novo
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/platform/accounts"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Contas
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">{account.name}</h1>
          {account.status && (
            <Badge variant="outline">{STATUS_LABEL[account.status]}</Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {account.owner_name ?? '—'} · {account.owner_email ?? '—'} · criada em{' '}
          {fmtDateTime(account.created_at)}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-xs font-medium text-muted-foreground">Plano</CardTitle>
          </CardHeader>
          <CardContent className="text-lg font-semibold">{account.plan ?? '—'}</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-xs font-medium text-muted-foreground">Trial termina</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">{fmtDateTime(account.trial_ends_at)}</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-xs font-medium text-muted-foreground">Período atual até</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">{fmtDateTime(account.current_period_end)}</CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-xs font-medium text-muted-foreground">Membros / Contatos</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {account.member_count} / {account.contact_count}
          </CardContent>
        </Card>
      </div>

      {account.notes && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Notas: </span>
          {account.notes}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Trial</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label className="text-xs text-muted-foreground">Dias</Label>
            <Input
              type="number"
              min={1}
              max={365}
              value={trialDays}
              onChange={(e) => setTrialDays(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => runAction('extend_trial', { action: 'extend_trial', days: Number(trialDays) })}
              >
                {busy === 'extend_trial' ? <Loader2 className="size-3.5 animate-spin" /> : 'Estender'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => runAction('set_trial', { action: 'set_trial', days: Number(trialDays) })}
              >
                {busy === 'set_trial' ? <Loader2 className="size-3.5 animate-spin" /> : 'Definir a partir de hoje'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Plano</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label className="text-xs text-muted-foreground">Slug do plano</Label>
            <Input
              placeholder="ex: pro"
              value={planInput}
              onChange={(e) => setPlanInput(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => runAction('set_plan', { action: 'set_plan', plan: planInput.trim() || null })}
            >
              {busy === 'set_plan' ? <Loader2 className="size-3.5 animate-spin" /> : 'Salvar plano'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Forçar status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={forceStatus} onValueChange={(v) => setForceStatus(v as BillingStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BILLING_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              placeholder="Motivo (obrigatório)"
              value={statusNote}
              onChange={(e) => setStatusNote(e.target.value)}
              rows={2}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null || !statusNote.trim()}
              onClick={() =>
                runAction('set_status', { action: 'set_status', status: forceStatus, notes: statusNote })
              }
            >
              {busy === 'set_status' ? <Loader2 className="size-3.5 animate-spin" /> : 'Aplicar'}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Webhooks recebidos (últimos 50)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {webhookLogs.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Nenhum webhook recebido para esta conta ainda.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {webhookLogs.map((log) => (
                <li key={log.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <Badge variant="outline" className={OUTCOME_TONE[log.outcome]}>
                    {log.outcome}
                  </Badge>
                  <span className="font-medium text-foreground">{log.action}</span>
                  <span className="text-muted-foreground">{log.event ?? '—'}</span>
                  {log.amount != null && (
                    <span className="text-muted-foreground">R$ {log.amount}</span>
                  )}
                  {log.error_message && (
                    <span className="text-red-500">{log.error_message}</span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {fmtDateTime(log.received_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico de ações da equipe</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {auditLog.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Nenhuma ação manual registrada ainda.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {auditLog.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="font-medium text-foreground">{row.action}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {fmtDateTime(row.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
