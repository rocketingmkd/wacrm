"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

interface RuleRow {
  id?: string;
  start_time: string;
  end_time: string;
}

interface ExceptionRow {
  id: string;
  date: string;
  label: string | null;
}

// Monday-first display order — matches the Calendar tab's week grid
// (weekStartsOn: 1) — even though storage stays JS-convention
// (0=Sunday..6=Saturday), the same convention the Calendar view uses
// client-side.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_LABEL: Record<number, string> = {
  0: "Domingo",
  1: "Segunda",
  2: "Terça",
  3: "Quarta",
  4: "Quinta",
  5: "Sexta",
  6: "Sábado",
};
const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120];

function newRange(): RuleRow {
  return { start_time: "09:00", end_time: "18:00" };
}

/**
 * Availability tab — Cal.com-style: a weekly recurring schedule
 * (multiple ranges per day supports a lunch-break gap), a default
 * slot duration, and specific dates fully closed regardless of the
 * weekly schedule (holidays, days off). Configuration surface only —
 * the (future) scheduling agent reads this before offering a slot,
 * nothing here books anything itself.
 */
export function AgendaAvailability() {
  const t = useTranslations("Agenda.availability");
  const supabase = createClient();
  const { accountId } = useAuth();
  const canEdit = useCan("edit-settings");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rulesByDay, setRulesByDay] = useState<Record<number, RuleRow[]>>({});
  const [duration, setDuration] = useState(60);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);

  const [newExceptionStart, setNewExceptionStart] = useState("");
  const [newExceptionEnd, setNewExceptionEnd] = useState("");
  const [newExceptionLabel, setNewExceptionLabel] = useState("");
  const [addingException, setAddingException] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const [rulesRes, settingsRes, exceptionsRes] = await Promise.all([
      supabase
        .from("availability_rules")
        .select("*")
        .eq("account_id", accountId)
        .order("start_time"),
      supabase
        .from("agenda_availability_settings")
        .select("*")
        .eq("account_id", accountId)
        .maybeSingle(),
      supabase
        .from("availability_exceptions")
        .select("*")
        .eq("account_id", accountId)
        .order("date"),
    ]);

    const grouped: Record<number, RuleRow[]> = {};
    for (const row of rulesRes.data ?? []) {
      const day = row.day_of_week as number;
      const bucket = grouped[day] ?? (grouped[day] = []);
      bucket.push({
        id: row.id,
        start_time: (row.start_time as string).slice(0, 5),
        end_time: (row.end_time as string).slice(0, 5),
      });
    }
    setRulesByDay(grouped);
    setDuration((settingsRes.data?.slot_duration_minutes as number) ?? 60);
    setExceptions((exceptionsRes.data ?? []) as ExceptionRow[]);
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const toggleDay = (day: number, on: boolean) => {
    setRulesByDay((prev) => {
      const next = { ...prev };
      if (on) next[day] = [newRange()];
      else delete next[day];
      return next;
    });
  };

  const updateRange = (day: number, index: number, patch: Partial<RuleRow>) => {
    setRulesByDay((prev) => ({
      ...prev,
      [day]: prev[day].map((r, i) => (i === index ? { ...r, ...patch } : r)),
    }));
  };

  const addRange = (day: number) => {
    setRulesByDay((prev) => ({ ...prev, [day]: [...(prev[day] ?? []), newRange()] }));
  };

  const removeRange = (day: number, index: number) => {
    setRulesByDay((prev) => {
      const remaining = prev[day].filter((_, i) => i !== index);
      const next = { ...prev };
      if (remaining.length === 0) delete next[day];
      else next[day] = remaining;
      return next;
    });
  };

  const copyMondayToWeekdays = () => {
    const monday = rulesByDay[1];
    if (!monday || monday.length === 0) return;
    setRulesByDay((prev) => {
      const next = { ...prev };
      for (const day of [2, 3, 4, 5]) {
        next[day] = monday.map((r) => ({ start_time: r.start_time, end_time: r.end_time }));
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!accountId) return;
    // Every range needs end > start — the DB CHECK constraint would
    // reject it anyway, but a clear toast beats a raw Postgres error.
    for (const day of Object.keys(rulesByDay)) {
      for (const r of rulesByDay[Number(day)]) {
        if (r.end_time <= r.start_time) {
          toast.error(t("toastInvalidRange"));
          return;
        }
      }
    }

    setSaving(true);
    // Simplest correct approach for a small, non-FK-referenced table:
    // replace the account's whole rule set rather than diffing row by
    // row. Two round-trips, not a single transaction — acceptable
    // here (a rare, admin-only, low-frequency settings save, not a
    // hot path anything else depends on mid-write).
    const del = await supabase.from("availability_rules").delete().eq("account_id", accountId);
    if (del.error) {
      toast.error(t("toastFailedSave"));
      setSaving(false);
      return;
    }
    const rows = Object.entries(rulesByDay).flatMap(([day, ranges]) =>
      ranges.map((r) => ({
        account_id: accountId,
        day_of_week: Number(day),
        start_time: r.start_time,
        end_time: r.end_time,
      })),
    );
    if (rows.length > 0) {
      const ins = await supabase.from("availability_rules").insert(rows);
      if (ins.error) {
        toast.error(t("toastFailedSave"));
        setSaving(false);
        return;
      }
    }

    const settings = await supabase
      .from("agenda_availability_settings")
      .upsert({ account_id: accountId, slot_duration_minutes: duration }, { onConflict: "account_id" });
    if (settings.error) {
      toast.error(t("toastFailedSave"));
      setSaving(false);
      return;
    }

    setSaving(false);
    toast.success(t("toastSaved"));
    void load();
  };

  const sortedExceptions = useMemo(
    () => [...exceptions].sort((a, b) => a.date.localeCompare(b.date)),
    [exceptions],
  );

  const handleAddException = async () => {
    if (!accountId || !newExceptionStart) return;
    const start = newExceptionStart;
    const end = newExceptionEnd || newExceptionStart;
    if (end < start) {
      toast.error(t("toastInvalidExceptionRange"));
      return;
    }
    // A "vacation" range is expanded client-side into one row per
    // date — keeps the table (and the future booking-engine lookup:
    // "is this exact date closed?") a single indexed equality check,
    // no range-containment query needed.
    const dates: string[] = [];
    const cursor = new Date(`${start}T00:00:00`);
    const endDate = new Date(`${end}T00:00:00`);
    while (cursor <= endDate) {
      dates.push(format(cursor, "yyyy-MM-dd"));
      cursor.setDate(cursor.getDate() + 1);
    }

    setAddingException(true);
    const { data, error } = await supabase
      .from("availability_exceptions")
      .upsert(
        dates.map((date) => ({
          account_id: accountId,
          date,
          label: newExceptionLabel.trim() || null,
        })),
        { onConflict: "account_id,date" },
      )
      .select();
    setAddingException(false);
    if (error) {
      toast.error(t("toastFailedAddException"));
      return;
    }
    setExceptions((prev) => {
      const byDate = new Map(prev.map((e) => [e.date, e]));
      for (const row of (data ?? []) as ExceptionRow[]) byDate.set(row.date, row);
      return Array.from(byDate.values());
    });
    setNewExceptionStart("");
    setNewExceptionEnd("");
    setNewExceptionLabel("");
    toast.success(t("toastExceptionAdded"));
  };

  const handleRemoveException = async (id: string) => {
    const { error } = await supabase.from("availability_exceptions").delete().eq("id", id);
    if (error) {
      toast.error(t("toastFailedRemoveException"));
      return;
    }
    setExceptions((prev) => prev.filter((e) => e.id !== id));
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
      {/* Weekly working hours */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t("weeklyTitle")}</h3>
            <p className="text-xs text-muted-foreground">{t("weeklyDesc")}</p>
          </div>
          {canEdit && rulesByDay[1]?.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={copyMondayToWeekdays}
              className="text-xs text-muted-foreground"
            >
              {t("copyMondayToWeekdays")}
            </Button>
          )}
        </div>

        <div className="space-y-2">
          {WEEKDAY_ORDER.map((day) => {
            const ranges = rulesByDay[day] ?? [];
            const on = ranges.length > 0;
            return (
              <div key={day} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <Switch
                      checked={on}
                      onCheckedChange={(v) => toggleDay(day, v)}
                      disabled={!canEdit}
                    />
                    <span className="w-20 text-sm font-medium text-foreground">
                      {WEEKDAY_LABEL[day]}
                    </span>
                  </div>
                  {!on && (
                    <span className="text-xs text-muted-foreground">{t("dayOff")}</span>
                  )}
                </div>

                {on && (
                  <div className="mt-2.5 space-y-1.5 pl-[52px]">
                    {ranges.map((r, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <Input
                          type="time"
                          value={r.start_time}
                          onChange={(e) =>
                            updateRange(day, i, { start_time: e.target.value })
                          }
                          disabled={!canEdit}
                          className="h-8 w-28 border-border bg-muted text-sm text-foreground"
                        />
                        <span className="text-xs text-muted-foreground">{t("rangeTo")}</span>
                        <Input
                          type="time"
                          value={r.end_time}
                          onChange={(e) => updateRange(day, i, { end_time: e.target.value })}
                          disabled={!canEdit}
                          className="h-8 w-28 border-border bg-muted text-sm text-foreground"
                        />
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => removeRange(day, i)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-400"
                            title={t("removeRange")}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => addRange(day)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        <Plus className="h-3 w-3" />
                        {t("addRange")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Default appointment duration */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold text-foreground">{t("durationTitle")}</Label>
        <p className="text-xs text-muted-foreground">{t("durationDesc")}</p>
        <select
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          disabled={!canEdit}
          className="h-9 w-40 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
        >
          {DURATION_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m < 60 ? t("durationMinutes", { m }) : t("durationHours", { h: m / 60 })}
            </option>
          ))}
        </select>
      </div>

      {canEdit && (
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {saving ? t("saving") : t("save")}
        </Button>
      )}

      {/* Date overrides — days off / holidays */}
      <div className="space-y-3 border-t border-border pt-6">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t("exceptionsTitle")}</h3>
          <p className="text-xs text-muted-foreground">{t("exceptionsDesc")}</p>
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-3">
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">{t("exceptionFrom")}</Label>
              <Input
                type="date"
                value={newExceptionStart}
                onChange={(e) => setNewExceptionStart(e.target.value)}
                className="h-8 w-36 border-border bg-muted text-sm text-foreground"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">{t("exceptionTo")}</Label>
              <Input
                type="date"
                value={newExceptionEnd}
                onChange={(e) => setNewExceptionEnd(e.target.value)}
                placeholder={newExceptionStart}
                className="h-8 w-36 border-border bg-muted text-sm text-foreground"
              />
            </div>
            <div className="grid flex-1 gap-1">
              <Label className="text-xs text-muted-foreground">{t("exceptionLabel")}</Label>
              <Input
                value={newExceptionLabel}
                onChange={(e) => setNewExceptionLabel(e.target.value)}
                placeholder={t("exceptionLabelPlaceholder")}
                className="h-8 border-border bg-muted text-sm text-foreground"
              />
            </div>
            <Button
              size="sm"
              onClick={handleAddException}
              disabled={!newExceptionStart || addingException}
              className="h-8 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {addingException ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                t("exceptionAdd")
              )}
            </Button>
          </div>
        )}

        {sortedExceptions.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("exceptionsEmpty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {sortedExceptions.map((ex) => (
              <li
                key={ex.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2"
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-foreground">
                    {format(new Date(`${ex.date}T00:00:00`), "EEEE, d 'de' MMMM", {
                      locale: ptBR,
                    })}
                  </span>
                  {ex.label && (
                    <span className="text-xs text-muted-foreground">— {ex.label}</span>
                  )}
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => handleRemoveException(ex.id)}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-400"
                    title={t("removeException")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
