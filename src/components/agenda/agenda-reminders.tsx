"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Loader2, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { extractVariableIndices } from "@/lib/whatsapp/template-validators";
import type { PipelineStage } from "@/types";

interface TemplateOption {
  id: string;
  name: string;
  status: string | null;
  body_text: string;
  buttons: { type: string }[] | null;
}

interface SettingsState {
  enabled: boolean;
  firstTemplateId: string | null;
  secondTemplateId: string | null;
  firstEnabled: boolean;
  firstHours: number;
  secondEnabled: boolean;
  secondHours: number;
  confirmButtonIndex: number;
  rescheduleButtonIndex: number;
  stageAfterSendId: string | null;
  stageAfterConfirmId: string | null;
  stopStageIds: string[];
}

interface LedgerRow {
  id: string;
  kind: string;
  status: string;
  error: string | null;
  scheduled_at: string;
  created_at: string;
  deal: { title: string | null; contact: { name: string | null; phone: string | null } | null } | null;
}

const KIND_LABEL: Record<string, string> = { first: "1º lembrete", second: "2º lembrete" };
const STATUS_LABEL: Record<string, string> = { pending: "Pendente", sent: "Enviado", failed: "Falhou" };
const STATUS_TONE: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-400",
  sent: "bg-emerald-500/10 text-emerald-400",
  failed: "bg-red-500/10 text-red-400",
};

/** Same shape check the send engine uses (src/lib/agenda/reminders.ts) —
 *  duplicated rather than imported, since that module pulls in
 *  server-only senders/crypto that must never reach the client bundle. */
function isReminderShapedTemplate(t: Pick<TemplateOption, "body_text" | "buttons">): boolean {
  const bodyVars = extractVariableIndices(t.body_text ?? "").length;
  const quickReplyButtons = (t.buttons ?? []).filter((b) => b.type === "QUICK_REPLY").length;
  return bodyVars === 3 && quickReplyButtons >= 2;
}

function defaultSettings(stages: PipelineStage[]): SettingsState {
  const byName = (name: string) => stages.find((s) => s.name === name)?.id ?? null;
  const stopDefaults = stages
    .filter((s) => s.name === "Realizado" || s.name === "Não compareceu")
    .map((s) => s.id);
  return {
    enabled: true,
    firstTemplateId: null,
    secondTemplateId: null,
    firstEnabled: true,
    firstHours: 24,
    secondEnabled: true,
    secondHours: 2,
    confirmButtonIndex: 0,
    rescheduleButtonIndex: 1,
    stageAfterSendId: byName("Lembrete enviado"),
    stageAfterConfirmId: byName("Confirmado"),
    stopStageIds: stopDefaults,
  };
}

/**
 * Configuration + send log for the appointment-reminder engine
 * (migrations 061/062, src/lib/agenda/reminders.ts). Settings write here;
 * the actual sends happen server-side on a cron tick — this tab never
 * sends anything itself.
 */
export function AgendaReminders({ stages }: { stages: PipelineStage[] }) {
  const t = useTranslations("Agenda.reminders");
  const supabase = createClient();
  const { accountId } = useAuth();
  const canEdit = useCan("edit-settings");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<SettingsState>(() => defaultSettings(stages));
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const [settingsRes, templatesRes, ledgerRes] = await Promise.all([
      supabase.from("agenda_reminder_settings").select("*").eq("account_id", accountId).maybeSingle(),
      supabase
        .from("message_templates")
        .select("id, name, status, body_text, buttons")
        .eq("account_id", accountId)
        .eq("category", "Utility")
        .order("name"),
      supabase
        .from("agenda_reminders")
        .select("id, kind, status, error, scheduled_at, created_at, deal:deals(title, contact:contacts(name, phone))")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const row = settingsRes.data;
    setSettings(
      row
        ? {
            enabled: row.enabled as boolean,
            firstTemplateId: (row.first_template_id as string | null) ?? null,
            secondTemplateId: (row.second_template_id as string | null) ?? null,
            firstEnabled: row.first_offset_minutes != null,
            firstHours: row.first_offset_minutes != null ? (row.first_offset_minutes as number) / 60 : 24,
            secondEnabled: row.second_offset_minutes != null,
            secondHours: row.second_offset_minutes != null ? (row.second_offset_minutes as number) / 60 : 2,
            confirmButtonIndex: row.confirm_button_index as number,
            rescheduleButtonIndex: row.reschedule_button_index as number,
            stageAfterSendId: (row.stage_after_send_id as string | null) ?? null,
            stageAfterConfirmId: (row.stage_after_confirm_id as string | null) ?? null,
            stopStageIds: (row.stop_stage_ids as string[] | null) ?? [],
          }
        : defaultSettings(stages),
    );
    setTemplates((templatesRes.data ?? []) as TemplateOption[]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setLedger((ledgerRes.data ?? []) as any);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const eligibleTemplates = useMemo(
    () => templates.filter((tp) => tp.status === "APPROVED" && isReminderShapedTemplate(tp)),
    [templates],
  );

  const resolveKind = useCallback(
    (explicitId: string | null) => {
      if (explicitId && eligibleTemplates.some((tp) => tp.id === explicitId)) return explicitId;
      return eligibleTemplates.length === 1 ? eligibleTemplates[0].id : null;
    },
    [eligibleTemplates],
  );
  const resolvedFirstTemplateId = useMemo(
    () => resolveKind(settings.firstTemplateId),
    [resolveKind, settings.firstTemplateId],
  );
  const resolvedSecondTemplateId = useMemo(
    () => resolveKind(settings.secondTemplateId),
    [resolveKind, settings.secondTemplateId],
  );

  const handleSave = async () => {
    if (!accountId) return;
    if (settings.confirmButtonIndex === settings.rescheduleButtonIndex) {
      toast.error(t("toastSameButton"));
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("agenda_reminder_settings").upsert(
      {
        account_id: accountId,
        enabled: settings.enabled,
        first_template_id: settings.firstTemplateId,
        second_template_id: settings.secondTemplateId,
        first_offset_minutes: settings.firstEnabled ? Math.max(1, Math.round(settings.firstHours * 60)) : null,
        second_offset_minutes: settings.secondEnabled ? Math.max(1, Math.round(settings.secondHours * 60)) : null,
        confirm_button_index: settings.confirmButtonIndex,
        reschedule_button_index: settings.rescheduleButtonIndex,
        stage_after_send_id: settings.stageAfterSendId,
        stage_after_confirm_id: settings.stageAfterConfirmId,
        stop_stage_ids: settings.stopStageIds,
      },
      { onConflict: "account_id" },
    );
    setSaving(false);
    if (error) {
      toast.error(t("toastFailedSave"));
      return;
    }
    toast.success(t("toastSaved"));
    void load();
  };

  const toggleStopStage = (stageId: string) => {
    setSettings((prev) => ({
      ...prev,
      stopStageIds: prev.stopStageIds.includes(stageId)
        ? prev.stopStageIds.filter((id) => id !== stageId)
        : [...prev.stopStageIds, stageId],
    }));
  };

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t("enabledTitle")}</h3>
          <p className="text-xs text-muted-foreground">{t("enabledDesc")}</p>
        </div>
        <Switch
          checked={settings.enabled}
          onCheckedChange={(v) => setSettings((prev) => ({ ...prev, enabled: v }))}
          disabled={!canEdit}
        />
      </div>

      {((settings.firstEnabled && resolvedFirstTemplateId === null) ||
        (settings.secondEnabled && resolvedSecondTemplateId === null)) && (
        <div className="flex gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <p>{t("noTemplateWarning")}</p>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{t("offsetsTitle")}</h3>

        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center gap-3">
            <Switch
              checked={settings.firstEnabled}
              onCheckedChange={(v) => setSettings((prev) => ({ ...prev, firstEnabled: v }))}
              disabled={!canEdit}
            />
            <span className="w-28 text-sm text-foreground">{t("firstOffsetLabel")}</span>
            <input
              type="number"
              min={1}
              step={1}
              value={settings.firstHours}
              onChange={(e) => setSettings((prev) => ({ ...prev, firstHours: Number(e.target.value) }))}
              disabled={!canEdit || !settings.firstEnabled}
              className="h-8 w-20 rounded-md border border-border bg-muted px-2 text-sm text-foreground outline-none focus:border-primary"
            />
            <span className="text-xs text-muted-foreground">{t("hoursBeforeSuffix")}</span>
          </div>
          <div className="pl-[172px]">
            <select
              value={settings.firstTemplateId ?? ""}
              onChange={(e) => setSettings((prev) => ({ ...prev, firstTemplateId: e.target.value || null }))}
              disabled={!canEdit || !settings.firstEnabled}
              className="h-8 w-full rounded-md border border-border bg-muted px-2 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="">{t("templateAuto")}</option>
              {templates.map((tp) => (
                <option key={tp.id} value={tp.id} disabled={tp.status !== "APPROVED" || !isReminderShapedTemplate(tp)}>
                  {tp.name}
                  {tp.status !== "APPROVED" ? ` (${tp.status})` : !isReminderShapedTemplate(tp) ? ` (${t("templateWrongShape")})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center gap-3">
            <Switch
              checked={settings.secondEnabled}
              onCheckedChange={(v) => setSettings((prev) => ({ ...prev, secondEnabled: v }))}
              disabled={!canEdit}
            />
            <span className="w-28 text-sm text-foreground">{t("secondOffsetLabel")}</span>
            <input
              type="number"
              min={1}
              step={1}
              value={settings.secondHours}
              onChange={(e) => setSettings((prev) => ({ ...prev, secondHours: Number(e.target.value) }))}
              disabled={!canEdit || !settings.secondEnabled}
              className="h-8 w-20 rounded-md border border-border bg-muted px-2 text-sm text-foreground outline-none focus:border-primary"
            />
            <span className="text-xs text-muted-foreground">{t("hoursBeforeSuffix")}</span>
          </div>
          <div className="pl-[172px]">
            <select
              value={settings.secondTemplateId ?? ""}
              onChange={(e) => setSettings((prev) => ({ ...prev, secondTemplateId: e.target.value || null }))}
              disabled={!canEdit || !settings.secondEnabled}
              className="h-8 w-full rounded-md border border-border bg-muted px-2 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="">{t("templateAuto")}</option>
              {templates.map((tp) => (
                <option key={tp.id} value={tp.id} disabled={tp.status !== "APPROVED" || !isReminderShapedTemplate(tp)}>
                  {tp.name}
                  {tp.status !== "APPROVED" ? ` (${tp.status})` : !isReminderShapedTemplate(tp) ? ` (${t("templateWrongShape")})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{t("buttonsTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("buttonsDesc")}</p>
        <div className="flex flex-wrap gap-4">
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">{t("confirmButtonLabel")}</Label>
            <select
              value={settings.confirmButtonIndex}
              onChange={(e) => setSettings((prev) => ({ ...prev, confirmButtonIndex: Number(e.target.value) }))}
              disabled={!canEdit}
              className="h-8 w-32 rounded-md border border-border bg-muted px-2 text-sm text-foreground outline-none focus:border-primary"
            >
              {[0, 1, 2].map((i) => (
                <option key={i} value={i}>
                  {t("buttonPosition", { n: i + 1 })}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">{t("rescheduleButtonLabel")}</Label>
            <select
              value={settings.rescheduleButtonIndex}
              onChange={(e) => setSettings((prev) => ({ ...prev, rescheduleButtonIndex: Number(e.target.value) }))}
              disabled={!canEdit}
              className="h-8 w-32 rounded-md border border-border bg-muted px-2 text-sm text-foreground outline-none focus:border-primary"
            >
              {[0, 1, 2].map((i) => (
                <option key={i} value={i}>
                  {t("buttonPosition", { n: i + 1 })}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{t("stagesTitle")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">{t("stageAfterSendLabel")}</Label>
            <select
              value={settings.stageAfterSendId ?? ""}
              onChange={(e) => setSettings((prev) => ({ ...prev, stageAfterSendId: e.target.value || null }))}
              disabled={!canEdit}
              className="h-8 rounded-md border border-border bg-muted px-2 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="">{t("stageNone")}</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">{t("stageAfterConfirmLabel")}</Label>
            <select
              value={settings.stageAfterConfirmId ?? ""}
              onChange={(e) => setSettings((prev) => ({ ...prev, stageAfterConfirmId: e.target.value || null }))}
              disabled={!canEdit}
              className="h-8 rounded-md border border-border bg-muted px-2 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="">{t("stageNone")}</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t("stopStagesLabel")}</Label>
          <div className="flex flex-wrap gap-2">
            {stages.map((s) => (
              <label
                key={s.id}
                className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-foreground"
              >
                <input
                  type="checkbox"
                  checked={settings.stopStageIds.includes(s.id)}
                  onChange={() => toggleStopStage(s.id)}
                  disabled={!canEdit}
                />
                {s.name}
              </label>
            ))}
          </div>
        </div>
      </div>

      {canEdit && (
        <Button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
          {saving ? t("saving") : t("save")}
        </Button>
      )}

      <div className="space-y-3 border-t border-border pt-6">
        <h3 className="text-sm font-semibold text-foreground">{t("logTitle")}</h3>
        {ledger.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("logEmpty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {ledger.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {row.deal?.contact?.name || row.deal?.contact?.phone || row.deal?.title || "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {KIND_LABEL[row.kind] ?? row.kind} · {formatDistanceToNow(new Date(row.created_at), { addSuffix: true, locale: ptBR })}
                    {row.status === "failed" && row.error ? ` · ${row.error}` : ""}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[row.status] ?? ""}`}>
                  {STATUS_LABEL[row.status] ?? row.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
