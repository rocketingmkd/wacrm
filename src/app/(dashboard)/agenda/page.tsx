"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Pipeline, PipelineStage, Deal } from "@/types";
import { PipelineBoard } from "@/components/pipelines/pipeline-board";
import { PipelineSettings } from "@/components/pipelines/pipeline-settings";
import { DealForm } from "@/components/pipelines/deal-form";
import { AgendaList } from "@/components/agenda/agenda-list";
import { AgendaCalendar } from "@/components/agenda/agenda-calendar";
import { AgendaAvailability } from "@/components/agenda/agenda-availability";
import { Button } from "@/components/ui/button";
import { CalendarDays, Plus, Settings } from "lucide-react";
import { toast } from "sonner";
import { useCan } from "@/hooks/use-can";
import { useAuth } from "@/hooks/use-auth";
import { GatedButton } from "@/components/ui/gated-button";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// Seeded once per account, the first time /agenda is opened — mirrors
// how /pipelines seeds a "Sales Pipeline" on first visit. Names/colors
// match the reminder-cadence design discussed for this feature: a
// booked appointment starts here and moves right as the account (or
// the scheduling AI agent) works it.
const DEFAULT_AGENDA_STAGES = [
  { name: "Agendado", color: "#3b82f6", position: 0 },
  { name: "Lembrete enviado", color: "#eab308", position: 1 },
  { name: "Confirmado", color: "#8b5cf6", position: 2 },
  { name: "Realizado", color: "#22c55e", position: 3 },
  { name: "Não compareceu", color: "#ef4444", position: 4 },
];

type Tab = "calendar" | "list" | "kanban" | "availability";

export default function AgendaPage() {
  const t = useTranslations("Agenda.page");
  const tPipelines = useTranslations("Pipelines.page");
  const supabase = createClient();
  const canEditSettings = useCan("edit-settings");
  const canCreateDeals = useCan("send-messages");
  const { accountId } = useAuth();

  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  // Calendar first — the visual "what's on today" view the user
  // (and, over their shoulder, the client) reaches for; Kanban stays
  // last as the process/status view for internal follow-up.
  const [tab, setTab] = useState<Tab>("calendar");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string>("");

  // Guards against double-seeding (React StrictMode double-effect in
  // dev, or a second tab opening /agenda at the same instant).
  const seedAttempted = useRef(false);

  const loadPipeline = useCallback(async (): Promise<Pipeline | null> => {
    const { data, error } = await supabase
      .from("pipelines")
      .select("*")
      .eq("is_scheduling", true)
      .maybeSingle();
    if (error) {
      console.error("Failed to load agenda pipeline:", error.message);
      return null;
    }
    return (data as Pipeline | null) ?? null;
  }, [supabase]);

  const loadStages = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .order("position");
      return (data ?? []) as PipelineStage[];
    },
    [supabase],
  );

  const loadDeals = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("deals")
        .select("*, contact:contacts(*), assignee:profiles!deals_assigned_to_fkey(*)")
        .eq("pipeline_id", pipelineId)
        .order("scheduled_at", { ascending: true, nullsFirst: false });
      return (data ?? []) as Deal[];
    },
    [supabase],
  );

  const seedAgendaPipeline = useCallback(async (): Promise<Pipeline | null> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user || !accountId) return null;

    const { data: created, error } = await supabase
      .from("pipelines")
      .insert({
        user_id: user.id,
        account_id: accountId,
        name: t("title"),
        is_scheduling: true,
      })
      .select()
      .single();
    if (error || !created) {
      // A concurrent tab may have won the `pipelines_one_scheduling`
      // partial unique index race — that's fine, just load whichever
      // pipeline ended up flagged instead of surfacing an error.
      console.error("Failed to seed agenda pipeline:", error?.message);
      return loadPipeline();
    }

    const stagesPayload = DEFAULT_AGENDA_STAGES.map((s) => ({
      pipeline_id: created.id,
      name: s.name,
      color: s.color,
      position: s.position,
    }));
    await supabase.from("pipeline_stages").insert(stagesPayload);

    return created as Pipeline;
  }, [supabase, accountId, loadPipeline, t]);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      let p = await loadPipeline();
      if (!p && !seedAttempted.current) {
        seedAttempted.current = true;
        p = await seedAgendaPipeline();
      }
      if (cancelled) return;
      setPipeline(p);
      if (p) {
        const [s, d] = await Promise.all([loadStages(p.id), loadDeals(p.id)]);
        if (cancelled) return;
        setStages(s);
        setDeals(d);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const refreshStages = useCallback(async () => {
    if (!pipeline) return;
    setStages(await loadStages(pipeline.id));
  }, [loadStages, pipeline]);

  const refreshDeals = useCallback(async () => {
    if (!pipeline) return;
    setDeals(await loadDeals(pipeline.id));
  }, [loadDeals, pipeline]);

  // A rename in PipelineSettings changes `pipeline.name` — re-read the
  // row itself, not just its stages, so the header stays in sync. Also
  // doubles as the recovery path if the pipeline was just deleted
  // (PipelineSettings' own "delete pipeline" action): re-seed a fresh
  // one instead of leaving the page on a dead-end "couldn't load"
  // state — the account always has an Agenda, same guarantee as the
  // very first load.
  const refreshPipeline = useCallback(async () => {
    let p = await loadPipeline();
    if (!p) p = await seedAgendaPipeline();
    setPipeline(p);
    if (p) {
      const [s, d] = await Promise.all([loadStages(p.id), loadDeals(p.id)]);
      setStages(s);
      setDeals(d);
    }
  }, [loadPipeline, seedAgendaPipeline, loadStages, loadDeals]);

  const handleDealMoved = useCallback(
    async (dealId: string, newStageId: string) => {
      setDeals((prev) =>
        prev.map((d) => (d.id === dealId ? { ...d, stage_id: newStageId } : d)),
      );
      const res = await fetch(`/api/deals/${dealId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage_id: newStageId }),
      });
      if (!res.ok) {
        toast.error(tPipelines("toastFailedMoveDeal"));
        refreshDeals();
      }
    },
    [refreshDeals, tPipelines],
  );

  const handleAddAppointment = useCallback(
    (stageId?: string) => {
      setEditingDeal(null);
      setDefaultStageId(stageId ?? stages[0]?.id ?? "");
      setDealFormOpen(true);
    },
    [stages],
  );

  const handleEditDeal = useCallback((deal: Deal) => {
    setEditingDeal(deal);
    setDefaultStageId(deal.stage_id);
    setDealFormOpen(true);
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="h-9 w-28 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-96 w-72 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  if (!pipeline) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20">
        <CalendarDays className="h-12 w-12 text-muted-foreground" />
        <p className="mt-4 text-sm text-muted-foreground">{t("loadError")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <CalendarDays className="h-5 w-5 text-primary" />
            {pipeline.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {canEditSettings && (
            <Button
              variant="outline"
              onClick={() => setSettingsOpen(true)}
              className="border-border bg-card text-foreground hover:bg-muted"
            >
              <Settings className="mr-1 h-4 w-4" />
              {t("manage")}
            </Button>
          )}
          <GatedButton
            canAct={canCreateDeals}
            gateReason="criar compromissos"
            disabled={stages.length === 0}
            onClick={() => handleAddAppointment()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("addAppointment")}
          </GatedButton>
        </div>
      </div>

      {/* Calendário / Agenda / Kanban / Disponibilidade — calendar
          answers "what's on today" (the client-facing glance), the
          list answers "what's next in order", the board answers
          "where is each lead in the process" (internal follow-up),
          and availability is the config surface the scheduling agent
          will read before offering a slot. */}
      <div className="flex gap-1 rounded-lg border border-border bg-card p-1 w-fit">
        {(["calendar", "list", "kanban", "availability"] as const).map((tb) => (
          <button
            key={tb}
            type="button"
            onClick={() => setTab(tb)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === tb
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tb === "calendar"
              ? t("tabCalendar")
              : tb === "list"
                ? t("tabList")
                : tb === "kanban"
                  ? t("tabKanban")
                  : t("tabAvailability")}
          </button>
        ))}
      </div>

      {tab === "kanban" ? (
        <PipelineBoard
          stages={stages}
          deals={deals}
          onDealMoved={handleDealMoved}
          onAddDeal={handleAddAppointment}
          onEditDeal={handleEditDeal}
          hideValue
        />
      ) : tab === "list" ? (
        <AgendaList deals={deals} stages={stages} onEditDeal={handleEditDeal} />
      ) : tab === "calendar" ? (
        <AgendaCalendar deals={deals} stages={stages} onEditDeal={handleEditDeal} />
      ) : (
        <AgendaAvailability />
      )}

      {pipeline && (
        <PipelineSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeline={pipeline}
          stages={stages}
          onPipelinesChanged={refreshPipeline}
          onStagesChanged={refreshStages}
          onCreateNewPipeline={() => setSettingsOpen(false)}
          hideCreateNew
        />
      )}

      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={editingDeal}
        pipelineId={pipeline.id}
        stages={stages}
        defaultStageId={defaultStageId}
        isScheduling
        onSaved={refreshDeals}
      />
    </div>
  );
}
