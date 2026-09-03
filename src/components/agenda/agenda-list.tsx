"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { format, isToday, isTomorrow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Clock, MessageSquare } from "lucide-react";
import Link from "next/link";
import type { Deal, PipelineStage } from "@/types";
import { cn } from "@/lib/utils";

type Filter = "upcoming" | "past" | "all";

interface AgendaListProps {
  deals: Deal[];
  stages: PipelineStage[];
  onEditDeal: (deal: Deal) => void;
}

/**
 * Day-grouped list view of the Agenda pipeline's cards, sorted by
 * `scheduled_at` — the thing a Kanban board (grouped by *stage*, not
 * *time*) can't answer well: "o que eu tenho hoje". Cards with no
 * scheduled_at (shouldn't normally happen — the form requires it on
 * this pipeline, see `DealForm`'s `isScheduling` prop — but a stray
 * row is still possible, e.g. an old deal moved into this pipeline)
 * land in their own trailing section instead of being silently
 * dropped.
 */
export function AgendaList({ deals, stages, onEditDeal }: AgendaListProps) {
  const t = useTranslations("Agenda.list");
  const [filter, setFilter] = useState<Filter>("upcoming");
  // Lazy initializer, not a plain `Date.now()` in the render body or
  // inside `useMemo` below — reads the clock once per mount instead of
  // on every render, which is what React's purity rule for hooks
  // requires. The upcoming/past split doesn't need to live-tick.
  const [now] = useState(() => Date.now());

  const stageById = useMemo(() => {
    const map = new Map<string, PipelineStage>();
    for (const s of stages) map.set(s.id, s);
    return map;
  }, [stages]);

  const { scheduled, unscheduled } = useMemo(() => {
    const scheduled = deals
      .filter((d) => d.scheduled_at)
      .filter((d) => {
        const at = new Date(d.scheduled_at as string).getTime();
        if (filter === "upcoming") return at >= now;
        if (filter === "past") return at < now;
        return true;
      })
      .sort((a, b) => {
        const diff =
          new Date(a.scheduled_at as string).getTime() -
          new Date(b.scheduled_at as string).getTime();
        return filter === "past" ? -diff : diff;
      });
    const unscheduled = filter === "all" ? deals.filter((d) => !d.scheduled_at) : [];
    return { scheduled, unscheduled };
  }, [deals, filter, now]);

  // Group the scheduled list into day buckets, in the order they
  // already come sorted in — a Map preserves insertion order, so this
  // stays consistent with the upcoming/past sort direction above.
  const groups = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const deal of scheduled) {
      const at = new Date(deal.scheduled_at as string);
      const key = format(at, "yyyy-MM-dd");
      const bucket = map.get(key);
      if (bucket) bucket.push(deal);
      else map.set(key, [deal]);
    }
    return Array.from(map.entries());
  }, [scheduled]);

  function dayLabel(iso: string): string {
    const date = new Date(`${iso}T00:00:00`);
    if (isToday(date)) return t("today");
    if (isTomorrow(date)) return t("tomorrow");
    return format(date, "EEEE, d 'de' MMMM", { locale: ptBR });
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {(["upcoming", "past", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filter === f
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            {t(`filter${f === "upcoming" ? "Upcoming" : f === "past" ? "Past" : "All"}`)}
          </button>
        ))}
      </div>

      {groups.length === 0 && unscheduled.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
          {filter === "all" ? t("empty") : t("emptyFiltered")}
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(([day, dayDeals]) => (
            <div key={day}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {dayLabel(day)}
              </h3>
              <ul className="space-y-1.5">
                {dayDeals.map((deal) => (
                  <AgendaRow
                    key={deal.id}
                    deal={deal}
                    stage={deal.stage_id ? stageById.get(deal.stage_id) ?? null : null}
                    onEdit={onEditDeal}
                  />
                ))}
              </ul>
            </div>
          ))}

          {unscheduled.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("noTime")}
              </h3>
              <ul className="space-y-1.5">
                {unscheduled.map((deal) => (
                  <AgendaRow
                    key={deal.id}
                    deal={deal}
                    stage={deal.stage_id ? stageById.get(deal.stage_id) ?? null : null}
                    onEdit={onEditDeal}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AgendaRow({
  deal,
  stage,
  onEdit,
}: {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
}) {
  const contactLabel = deal.contact?.name || deal.contact?.phone || deal.title;
  return (
    <li>
      <button
        type="button"
        onClick={() => onEdit(deal)}
        className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
      >
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
        />
        <span className="flex w-16 shrink-0 items-center gap-1 text-xs font-medium text-foreground">
          <Clock className="h-3 w-3 text-muted-foreground" />
          {deal.scheduled_at ? format(new Date(deal.scheduled_at), "HH:mm") : "—"}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {contactLabel}
        </span>
        <span className="shrink-0 truncate text-xs text-muted-foreground">
          {stage?.name ?? ""}
        </span>
        {deal.conversation_id && (
          <Link
            href={`/inbox?c=${deal.conversation_id}`}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 rounded-md bg-primary/10 p-1.5 text-primary hover:bg-primary/20"
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </Link>
        )}
      </button>
    </li>
  );
}
