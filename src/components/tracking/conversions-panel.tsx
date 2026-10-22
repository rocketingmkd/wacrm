"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { EVENT_LABELS } from "@/lib/tracking/conversions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { GoogleAdsCard } from "@/components/tracking/google-ads-card";

interface Rule {
  id?: string;
  /** Stage id, or "won" for the deal status. */
  trigger: string;
  event_name: string;
  send_value: boolean;
  enabled: boolean;
  google_action_id: string;
}

interface Stage {
  id: string;
  name: string;
  pipeline: string;
}

interface RecentEvent {
  id: string;
  event_name: string;
  value: number | null;
  currency: string | null;
  status: "pending" | "sent" | "skipped" | "failed";
  detail: string | null;
  occurred_at: string;
  deal: { title: string } | { title: string }[] | null;
}

interface Payload {
  settings: {
    meta_dataset_id: string | null;
    meta_enabled: boolean;
    meta_test_code: string | null;
    google_enabled: boolean;
    google_validate_only: boolean;
  };
  rules: {
    id: string;
    stage_id: string | null;
    on_status: "won" | null;
    event_name: string;
    send_value: boolean;
    enabled: boolean;
    google_action_id: string | null;
  }[];
  stages: Stage[];
  recent: RecentEvent[];
}

const STATUS_LABEL: Record<RecentEvent["status"], { text: string; tone: string }> = {
  pending: { text: "Na fila", tone: "text-muted-foreground" },
  sent: { text: "Enviado", tone: "text-primary" },
  skipped: { text: "Não enviado", tone: "text-amber-500" },
  failed: { text: "Falhou", tone: "text-destructive" },
};

const selectClass =
  "h-9 min-w-0 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary";

function dealTitle(deal: RecentEvent["deal"]): string {
  if (!deal) return "Negócio removido";
  return Array.isArray(deal) ? (deal[0]?.title ?? "") : deal.title;
}

export function ConversionsPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [datasetId, setDatasetId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [testCode, setTestCode] = useState("");
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [googleValidateOnly, setGoogleValidateOnly] = useState(true);
  const [rules, setRules] = useState<Rule[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function apply(payload: Payload) {
    setData(payload);
    setDatasetId(payload.settings.meta_dataset_id ?? "");
    setEnabled(payload.settings.meta_enabled);
    setTestCode(payload.settings.meta_test_code ?? "");
    setGoogleEnabled(payload.settings.google_enabled);
    setGoogleValidateOnly(payload.settings.google_validate_only);
    setRules(
      payload.rules.map((r) => ({
        id: r.id,
        trigger: r.stage_id ?? "won",
        event_name: r.event_name,
        send_value: r.send_value,
        enabled: r.enabled,
        google_action_id: r.google_action_id ?? "",
      })),
    );
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/conversions/settings", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setLoadError(body?.error ?? "Não foi possível carregar as conversões.");
        else apply(body as Payload);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Falha de conexão.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function updateRule(index: number, patch: Partial<Rule>) {
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function suggest() {
    const next: Rule[] = [...rules];
    const has = (trigger: string, event: string) =>
      next.some((r) => r.trigger === trigger && r.event_name === event);
    if (!has("won", "Purchase")) {
      next.push({ trigger: "won", event_name: "Purchase", send_value: true, enabled: true, google_action_id: "" });
    }
    const qualified = data?.stages.find((s) => /qualific/i.test(s.name));
    if (qualified && !has(qualified.id, "Lead")) {
      next.push({ trigger: qualified.id, event_name: "Lead", send_value: false, enabled: true, google_action_id: "" });
    }
    setRules(next);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/conversions/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meta_dataset_id: datasetId,
          meta_enabled: enabled,
          meta_test_code: testCode,
          google_enabled: googleEnabled,
          google_validate_only: googleValidateOnly,
          rules: rules.map((r) => ({
            id: r.id,
            stage_id: r.trigger === "won" ? null : r.trigger,
            on_status: r.trigger === "won" ? "won" : null,
            event_name: r.event_name,
            send_value: r.send_value,
            enabled: r.enabled,
            google_action_id: r.google_action_id,
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ ok: false, text: body?.error ?? "Não foi possível salvar." });
        return;
      }
      const fresh = await fetch("/api/conversions/settings", { cache: "no-store" });
      if (fresh.ok) apply((await fresh.json()) as Payload);
      setMessage({ ok: true, text: "Configuração salva." });
    } catch {
      setMessage({ ok: false, text: "Falha de conexão ao salvar." });
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <p className="text-sm text-destructive">{loadError}</p>;
  if (!data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Carregando...
      </div>
    );
  }

  return (
    <div className="space-y-6 text-sm">
      <p className="text-muted-foreground">
        Quando um negócio chega a uma etapa que você escolher, o CRM avisa a Meta qual anúncio
        gerou aquela venda. Assim os anúncios aprendem a trazer quem compra, não só quem clica.
        Vale para leads que vieram de anúncios da Meta (clique no WhatsApp ou site). Para o Google Ads,
        o CRM usa o gclid do clique e envia a venda para a ação de conversão que você escolher.
      </p>

      <div className="space-y-3 rounded-xl border border-border p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold">Enviar conversões para a Meta</p>
            <p className="text-xs text-muted-foreground">
              Desligado, nada é enviado e as regras ficam guardadas.
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enviar conversões para a Meta" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">ID do dataset (Pixel)</span>
            <Input
              value={datasetId}
              onChange={(e) => setDatasetId(e.target.value)}
              placeholder="Ex.: 1789466045772445"
              inputMode="numeric"
            />
            <span className="block text-xs text-muted-foreground">
              Gerenciador de Eventos, Fontes de dados. Precisa estar no mesmo Business Manager do WhatsApp.
            </span>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Código de teste (opcional)</span>
            <Input
              value={testCode}
              onChange={(e) => setTestCode(e.target.value)}
              placeholder="Ex.: TEST12345"
            />
            <span className="block text-xs text-muted-foreground">
              Enquanto preenchido, os eventos aparecem só em &ldquo;Testar eventos&rdquo; e não contam nos anúncios. Apague para valer.
            </span>
          </label>
        </div>
      </div>

      <GoogleAdsCard
        enabled={googleEnabled}
        onEnabledChange={setGoogleEnabled}
        validateOnly={googleValidateOnly}
        onValidateOnlyChange={setGoogleValidateOnly}
      />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold">Quando enviar</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={suggest}>
              <Sparkles className="size-4" />
              Usar sugestão
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setRules((prev) => [
                  ...prev,
                  {
                    trigger: data.stages[0]?.id ?? "won",
                    event_name: "Lead",
                    send_value: false,
                    enabled: true,
                    google_action_id: "",
                  },
                ])
              }
            >
              <Plus className="size-4" />
              Nova regra
            </Button>
          </div>
        </div>

        {rules.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-muted-foreground">
            Nenhuma regra ainda. A sugestão envia &ldquo;Compra&rdquo; com o valor quando o negócio é
            ganho e &ldquo;Lead&rdquo; quando chega em uma etapa Qualificado.
          </p>
        ) : (
          <ul className="space-y-2">
            {rules.map((r, i) => (
              <li
                key={r.id ?? `new-${i}`}
                className={cn(
                  "flex flex-wrap items-center gap-2 rounded-xl border border-border p-3",
                  !r.enabled && "opacity-60",
                )}
              >
                <span className="text-muted-foreground">Quando</span>
                <select
                  className={cn(selectClass, "max-w-full")}
                  value={r.trigger}
                  onChange={(e) => updateRule(i, { trigger: e.target.value })}
                  aria-label="Etapa"
                >
                  <option value="won">Negócio ganho</option>
                  {data.stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      Entrar em {s.pipeline}: {s.name}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground">enviar</span>
                <select
                  className={selectClass}
                  value={r.event_name}
                  onChange={(e) =>
                    updateRule(i, {
                      event_name: e.target.value,
                      send_value: e.target.value === "Purchase" ? true : r.send_value,
                    })
                  }
                  aria-label="Evento"
                >
                  {Object.entries(EVENT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={r.send_value}
                    onChange={(e) => updateRule(i, { send_value: e.target.checked })}
                  />
                  com o valor
                </label>
                <Input
                  className="h-9 w-44"
                  value={r.google_action_id}
                  onChange={(e) => updateRule(i, { google_action_id: e.target.value })}
                  placeholder="ID da ação no Google"
                  inputMode="numeric"
                  aria-label="ID da ação de conversão do Google"
                />
                <div className="ml-auto flex items-center gap-3">
                  <Switch
                    checked={r.enabled}
                    onCheckedChange={(v) => updateRule(i, { enabled: v })}
                    aria-label="Regra ativa"
                  />
                  <button
                    type="button"
                    onClick={() => setRules((prev) => prev.filter((_, idx) => idx !== i))}
                    className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"
                    aria-label="Remover regra"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          Salvar
        </Button>
        {message && (
          <span className={message.ok ? "text-primary" : "text-destructive"}>{message.text}</span>
        )}
      </div>

      <div>
        <p className="mb-2 font-semibold">Últimos envios</p>
        {data.recent.length === 0 ? (
          <p className="text-muted-foreground">Nenhum evento ainda.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {data.recent.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {EVENT_LABELS[e.event_name] ?? e.event_name} · {dealTitle(e.deal)}
                  </p>
                  {e.detail && <p className="truncate text-xs text-muted-foreground">{e.detail}</p>}
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className={STATUS_LABEL[e.status].tone}>{STATUS_LABEL[e.status].text}</span>
                  <span className="text-muted-foreground">
                    {new Date(e.occurred_at).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
