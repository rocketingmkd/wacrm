"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Deal, PipelineStage } from "@/types";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const MAX_VISIBLE_PER_DAY = 3;
const WEEKDAY_LABELS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

interface AgendaCalendarProps {
  deals: Deal[];
  stages: PipelineStage[];
  onEditDeal: (deal: Deal) => void;
}

/**
 * Month grid view — the "what's scheduled today, at a glance" surface
 * a client-facing user reaches for first. Complements (doesn't
 * replace) `AgendaList`: this answers "what does this month look
 * like", the list answers "what's next in order". Both read the same
 * `deals` the Kanban already loads — no separate fetch.
 */
export function AgendaCalendar({ deals, stages, onEditDeal }: AgendaCalendarProps) {
  const t = useTranslations("Agenda.calendar");
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [dayDetail, setDayDetail] = useState<Date | null>(null);

  const stageById = useMemo(() => {
    const map = new Map<string, PipelineStage>();
    for (const s of stages) map.set(s.id, s);
    return map;
  }, [stages]);

  const dealsByDay = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const deal of deals) {
      if (!deal.scheduled_at) continue;
      const key = format(new Date(deal.scheduled_at), "yyyy-MM-dd");
      const bucket = map.get(key);
      if (bucket) bucket.push(deal);
      else map.set(key, [deal]);
    }
    for (const bucket of map.values()) {
      bucket.sort(
        (a, b) =>
          new Date(a.scheduled_at as string).getTime() -
          new Date(b.scheduled_at as string).getTime(),
      );
    }
    return map;
  }, [deals]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [month]);

  const detailDeals = dayDetail
    ? dealsByDay.get(format(dayDetail, "yyyy-MM-dd")) ?? []
    : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold capitalize text-foreground">
          {format(month, "MMMM 'de' yyyy", { locale: ptBR })}
        </h3>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMonth(startOfMonth(new Date()))}
            className="border-border bg-card text-xs text-muted-foreground hover:bg-muted"
          >
            {t("today")}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setMonth((m) => subMonths(m, 1))}
            aria-label={t("previousMonth")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setMonth((m) => addMonths(m, 1))}
            aria-label={t("nextMonth")}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="grid grid-cols-7 border-b border-border bg-muted/40">
          {WEEKDAY_LABELS.map((w) => (
            <div
              key={w}
              className="px-2 py-1.5 text-center text-[11px] font-medium uppercase text-muted-foreground"
            >
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const dayDeals = dealsByDay.get(key) ?? [];
            const visible = dayDeals.slice(0, MAX_VISIBLE_PER_DAY);
            const overflow = dayDeals.length - visible.length;
            return (
              <div
                key={key}
                className={cn(
                  "min-h-[92px] border-b border-r border-border p-1.5 last:border-r-0 [&:nth-child(7n)]:border-r-0",
                  !isSameMonth(day, month) && "bg-muted/20",
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-5 w-5 items-center justify-center rounded-full text-xs",
                    isToday(day)
                      ? "bg-primary font-semibold text-primary-foreground"
                      : isSameMonth(day, month)
                        ? "text-foreground"
                        : "text-muted-foreground/50",
                  )}
                >
                  {format(day, "d")}
                </span>
                <div className="mt-1 space-y-0.5">
                  {visible.map((deal) => {
                    const stage = deal.stage_id ? stageById.get(deal.stage_id) : null;
                    const label =
                      deal.contact?.name || deal.contact?.phone || deal.title;
                    return (
                      <button
                        key={deal.id}
                        type="button"
                        onClick={() => onEditDeal(deal)}
                        title={label}
                        className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] leading-tight hover:bg-muted"
                        style={{
                          borderLeft: `2px solid ${stage?.color ?? "#94a3b8"}`,
                        }}
                      >
                        <span className="shrink-0 font-medium text-foreground">
                          {format(new Date(deal.scheduled_at as string), "HH:mm")}
                        </span>
                        <span className="truncate text-muted-foreground">{label}</span>
                      </button>
                    );
                  })}
                  {overflow > 0 && (
                    <button
                      type="button"
                      onClick={() => setDayDetail(day)}
                      className="w-full rounded px-1 py-0.5 text-left text-[11px] font-medium text-primary hover:underline"
                    >
                      {t("more", { count: overflow })}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Dialog open={!!dayDetail} onOpenChange={(o) => !o && setDayDetail(null)}>
        <DialogContent className="sm:max-w-sm bg-popover border-border">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground capitalize">
              {dayDetail && format(dayDetail, "EEEE, d 'de' MMMM", { locale: ptBR })}
            </DialogTitle>
          </DialogHeader>
          <ul className="space-y-1.5">
            {detailDeals.map((deal) => {
              const stage = deal.stage_id ? stageById.get(deal.stage_id) : null;
              const label = deal.contact?.name || deal.contact?.phone || deal.title;
              return (
                <li key={deal.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setDayDetail(null);
                      onEditDeal(deal);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm hover:border-primary/40 hover:bg-muted/40"
                  >
                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
                    />
                    <span className="w-12 shrink-0 font-medium text-foreground">
                      {format(new Date(deal.scheduled_at as string), "HH:mm")}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-foreground">{label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {stage?.name ?? ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
