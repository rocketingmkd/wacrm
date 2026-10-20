"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, Check, Copy, Loader2, Pencil, Plus, Trash2, Webhook } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/webhooks/events";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface WebhookRow {
  id: string;
  url: string;
  events: string[];
  is_active: boolean;
  last_delivery_at: string | null;
  failure_count: number;
  created_at: string;
}

const EVENT_LABELS: Record<WebhookEvent, { label: string; description: string }> = {
  "message.received": {
    label: "Mensagem recebida",
    description: "Um cliente enviou uma mensagem.",
  },
  "message.status_updated": {
    label: "Status da mensagem",
    description: "Uma mensagem enviada foi entregue, lida ou falhou.",
  },
  "conversation.created": {
    label: "Conversa criada",
    description: "Uma nova conversa foi aberta com um contato.",
  },
};

function eventLabel(id: string): string {
  return EVENT_LABELS[id as WebhookEvent]?.label ?? id;
}

/**
 * Outbound webhooks: the CRM POSTs signed JSON to the URLs registered
 * here when something happens. Same engine as the public API
 * (/api/v1/webhooks); this is the dashboard for it.
 */
export function WebhooksPanel() {
  const { planFeatures } = useAuth();
  const [rows, setRows] = useState<WebhookRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WebhookRow | null>(null);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [toDelete, setToDelete] = useState<WebhookRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/webhooks", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Não foi possível carregar os webhooks.");
        return;
      }
      setError(null);
      setRows(body.webhooks as WebhookRow[]);
    } catch {
      setError("Falha de conexão ao carregar os webhooks.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/webhooks", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) return setError(body?.error ?? "Não foi possível carregar os webhooks.");
        setRows(body.webhooks as WebhookRow[]);
      })
      .catch(() => !cancelled && setError("Falha de conexão ao carregar os webhooks."));
    return () => {
      cancelled = true;
    };
  }, []);

  function openCreate() {
    setEditing(null);
    setUrl("");
    setEvents(["message.received"]);
    setFormOpen(true);
  }

  function openEdit(row: WebhookRow) {
    setEditing(row);
    setUrl(row.url);
    setEvents(row.events);
    setFormOpen(true);
  }

  function toggleEvent(id: string) {
    setEvents((prev) => (prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/webhooks/${editing.id}` : "/api/webhooks", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), events }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.error ?? "Não foi possível salvar o webhook.");
        return;
      }
      setFormOpen(false);
      if (!editing && body.secret) setSecret(body.secret as string);
      toast.success(editing ? "Webhook atualizado." : "Webhook criado.");
      await load();
    } catch {
      toast.error("Falha de conexão ao salvar o webhook.");
    } finally {
      setSaving(false);
    }
  }

  async function setActive(row: WebhookRow, active: boolean) {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/webhooks/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: active }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.error ?? "Não foi possível atualizar o webhook.");
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function remove() {
    if (!toDelete) return;
    setBusyId(toDelete.id);
    try {
      const res = await fetch(`/api/webhooks/${toDelete.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.error ?? "Não foi possível excluir o webhook.");
        return;
      }
      toast.success("Webhook excluído.");
      setToDelete(null);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.");
    }
  }

  const canCreate = planFeatures.apiAccess;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold tracking-tight">Webhooks</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Envie eventos do CRM para o Zapier, Make, n8n ou para o seu próprio servidor. Cada envio
            é um POST com JSON e o cabeçalho <code className="text-xs">X-Wacrm-Signature</code>{" "}
            (<code className="text-xs">t=&lt;segundos&gt;,v1=&lt;HMAC-SHA256&gt;</code>) para você
            confirmar que veio do CRM.
          </p>
        </div>
        {canCreate && (
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            Novo webhook
          </Button>
        )}
      </div>

      {!canCreate && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
          Webhooks de saída são um recurso do plano Pro. Você ainda pode ver e excluir os existentes,
          mas não criar novos enquanto a conta estiver no Starter.
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Tentar de novo
          </Button>
        </div>
      )}

      {rows === null && !error ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : rows && rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Webhook className="size-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">Nenhum webhook configurado.</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows?.map((row) => {
            const failing = row.failure_count > 0;
            return (
              <li key={row.id}>
                <Card>
                  <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-mono text-sm" title={row.url}>
                          {row.url}
                        </span>
                        {!row.is_active && (
                          <Badge variant="secondary" className="text-[10px] uppercase">
                            Desativado
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {row.events.map((e) => (
                          <Badge key={e} variant="outline" className="text-[11px]">
                            {eventLabel(e)}
                          </Badge>
                        ))}
                      </div>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          {row.last_delivery_at
                            ? `Última entrega com sucesso ${formatDistanceToNow(new Date(row.last_delivery_at), { addSuffix: true, locale: ptBR })}`
                            : "Nenhuma entrega com sucesso ainda"}
                        </span>
                        {failing && (
                          <span className="inline-flex items-center gap-1 text-destructive">
                            <AlertTriangle className="size-3" />
                            {row.failure_count} {row.failure_count === 1 ? "falha seguida" : "falhas seguidas"}
                            {!row.is_active && ", desativado automaticamente"}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        Ativo
                        <Switch
                          checked={row.is_active}
                          disabled={busyId === row.id || !canCreate}
                          onCheckedChange={(v) => void setActive(row, v)}
                          aria-label="Webhook ativo"
                        />
                      </label>
                      {canCreate && (
                        <Button size="icon-sm" variant="ghost" onClick={() => openEdit(row)} aria-label="Editar webhook">
                          <Pencil className="size-4" />
                        </Button>
                      )}
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => setToDelete(row)}
                        aria-label="Excluir webhook"
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {/* Create / edit */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar webhook" : "Novo webhook"}</DialogTitle>
            <DialogDescription>
              A URL precisa ser https. Escolha os eventos que você quer receber.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="wh-url" className="text-sm font-medium">
                URL de destino
              </label>
              <Input
                id="wh-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://exemplo.com/webhook"
                inputMode="url"
                autoFocus
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Eventos</legend>
              {WEBHOOK_EVENTS.map((id) => (
                <label
                  key={id}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    checked={events.includes(id)}
                    onChange={() => toggleEvent(id)}
                    className="mt-0.5 size-4 accent-[var(--primary)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{EVENT_LABELS[id].label}</span>
                    <span className="block text-xs text-muted-foreground">{EVENT_LABELS[id].description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={() => void save()} disabled={saving || !url.trim() || events.length === 0}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {editing ? "Salvar" : "Criar webhook"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Secret, shown once */}
      <Dialog open={secret !== null} onOpenChange={(open) => !open && setSecret(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Guarde o segredo de assinatura</DialogTitle>
            <DialogDescription>
              Ele é mostrado <strong>só agora</strong>. Use para validar o cabeçalho{" "}
              <code className="text-xs">X-Wacrm-Signature</code> de cada envio. Se perder, exclua o
              webhook e crie outro.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-3">
            <code className="min-w-0 flex-1 break-all text-xs">{secret}</code>
            <Button size="sm" variant="outline" onClick={() => void copySecret()}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setSecret(null)}>Já guardei</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir webhook?</DialogTitle>
            <DialogDescription>
              O CRM deixa de enviar eventos para <span className="break-all font-mono text-xs">{toDelete?.url}</span>.
              Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setToDelete(null)} disabled={busyId !== null}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => void remove()} disabled={busyId !== null}>
              {busyId !== null && <Loader2 className="size-4 animate-spin" />}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
