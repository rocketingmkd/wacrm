"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Bot,
  ChevronDown,
  Clock,
  Loader2,
  RefreshCw,
  ArrowRight,
  HelpCircle,
  StickyNote,
  PenLine,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Deal, Message, PipelineStage } from "@/types";
import type {
  CopilotAction,
  CopilotInsight,
  CopilotTemperature,
} from "@/lib/ai/copilot";
import {
  computeResponseTiming,
  formatDurationPtBr,
  AWAITING_REPLY_WARN_MS,
  SLOW_FIRST_RESPONSE_MS,
} from "@/lib/inbox/response-timing";

interface AiCopilotPanelProps {
  conversationId: string | null;
  contactId: string;
  accountId: string | null;
  messages: Pick<Message, "sender_type" | "created_at" | "content_type">[];
  /** From ContactSidebar — the contact's deals (newest first) + the
   *  account's pipeline stages, so "mover card" doesn't re-fetch. */
  deals: Deal[];
  stages: PipelineStage[];
  /** Drop generated draft text into the message composer. */
  onInsertDraft: (text: string) => void;
  /** Re-fetch sidebar data after a stage move / note add. */
  onDataChanged: () => void;
}

const OPEN_KEY = "rcc.copilot.open";

const TEMP_META: Record<
  CopilotTemperature,
  { label: string; dot: string; text: string }
> = {
  cold: { label: "Frio", dot: "bg-sky-400", text: "text-sky-400" },
  warm: { label: "Morno", dot: "bg-amber-400", text: "text-amber-400" },
  hot: { label: "Quente", dot: "bg-red-400", text: "text-red-400" },
};

interface InsightMeta {
  generated_at: string;
  msg_count_at_gen: number;
  model: string | null;
}

export function AiCopilotPanel({
  conversationId,
  contactId,
  accountId,
  messages,
  deals,
  stages,
  onInsertDraft,
  onDataChanged,
}: AiCopilotPanelProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [insight, setInsight] = useState<CopilotInsight | null>(null);
  const [meta, setMeta] = useState<InsightMeta | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  // Guards the auto-refresh so a stale insight only triggers one POST
  // per conversation view, not a loop.
  const autoRefreshedFor = useRef<string | null>(null);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(OPEN_KEY) === "1");
    } catch {
      /* private mode */
    }
  }, []);

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const textMsgCount = messages.filter((m) => m.content_type === "text").length;
  const timing = computeResponseTiming(messages);

  const refresh = useCallback(
    async (force: boolean) => {
      if (!conversationId) return;
      setRefreshing(true);
      try {
        const res = await fetch("/api/ai/copilot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversation_id: conversationId, force }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (force) toast.error(data.error || "Não foi possível atualizar.");
          return;
        }
        if (data.insight) {
          setInsight(data.insight as CopilotInsight);
          setMeta({
            generated_at: data.generated_at,
            msg_count_at_gen: data.msg_count_at_gen ?? 0,
            model: data.model ?? null,
          });
          setNotConfigured(false);
        } else {
          setNotConfigured(true);
        }
      } catch {
        if (force) toast.error("Não foi possível falar com o Gerente IA.");
      } finally {
        setRefreshing(false);
      }
    },
    [conversationId],
  );

  const load = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/ai/copilot?conversation_id=${encodeURIComponent(conversationId)}`,
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.insight) {
        setInsight(data.insight as CopilotInsight);
        setMeta({
          generated_at: data.generated_at,
          msg_count_at_gen: data.msg_count_at_gen ?? 0,
          model: data.model ?? null,
        });
      } else {
        setInsight(null);
        setMeta(null);
      }
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  // Reset + (re)load when the open panel switches conversation.
  useEffect(() => {
    setInsight(null);
    setMeta(null);
    setNotConfigured(false);
    autoRefreshedFor.current = null;
    if (open && conversationId) void load();
  }, [conversationId, open, load]);

  // Auto-refresh once when what we loaded is behind the live thread
  // (or there's nothing cached yet). Not forced — the server still
  // skips the LLM call if nothing actually moved.
  useEffect(() => {
    if (!open || !conversationId || loading || refreshing) return;
    if (autoRefreshedFor.current === conversationId) return;
    const stale = !meta || meta.msg_count_at_gen < textMsgCount;
    if (stale && textMsgCount > 0) {
      autoRefreshedFor.current = conversationId;
      void refresh(false);
    }
  }, [open, conversationId, loading, refreshing, meta, textMsgCount, refresh]);

  const activeDeal = deals.find((d) => d.status !== "lost") ?? deals[0] ?? null;
  const suggestedStage =
    insight?.suggestedStage != null
      ? stages.find((s) => s.name === insight.suggestedStage) ?? null
      : null;
  const canMoveStage =
    !!suggestedStage && !!activeDeal && activeDeal.stage_id !== suggestedStage.id;

  const handleDraft = useCallback(
    async (action: CopilotAction, idx: number) => {
      if (!conversationId) return;
      setBusyAction(`draft-${idx}`);
      try {
        const res = await fetch("/api/ai/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversation_id: conversationId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(
            data.code === "ai_not_configured"
              ? "A IA ainda não está configurada."
              : data.error || "Não foi possível gerar o rascunho.",
          );
          return;
        }
        if (typeof data.draft === "string" && data.draft.trim()) {
          onInsertDraft(data.draft.trim());
          toast.success("Rascunho inserido no campo de mensagem.");
        }
      } finally {
        setBusyAction(null);
      }
    },
    [conversationId, onInsertDraft],
  );

  const handleMoveStage = useCallback(async () => {
    if (!suggestedStage || !activeDeal) return;
    setBusyAction("move");
    try {
      const { error } = await createClient()
        .from("deals")
        .update({ stage_id: suggestedStage.id })
        .eq("id", activeDeal.id);
      if (error) {
        toast.error("Não foi possível mover o card.");
        return;
      }
      toast.success(`Card movido para «${suggestedStage.name}».`);
      onDataChanged();
    } finally {
      setBusyAction(null);
    }
  }, [suggestedStage, activeDeal, onDataChanged]);

  const handleAddNote = useCallback(
    async (action: CopilotAction, idx: number) => {
      if (!accountId) return;
      setBusyAction(`note-${idx}`);
      try {
        const { error } = await createClient()
          .from("contact_notes")
          .insert({
            contact_id: contactId,
            account_id: accountId,
            note_text: `Follow-up: ${action.label}`,
          });
        if (error) {
          toast.error("Não foi possível salvar a nota.");
          return;
        }
        toast.success("Nota de follow-up adicionada.");
        onDataChanged();
      } finally {
        setBusyAction(null);
      }
    },
    [accountId, contactId, onDataChanged],
  );

  const tempMeta = insight ? TEMP_META[insight.temperature] : null;
  const awaitingWarn =
    timing.awaitingReplyMs != null &&
    timing.awaitingReplyMs >= AWAITING_REPLY_WARN_MS;

  return (
    <div className="rounded-lg border border-border bg-muted/30">
      {/* Header — always visible, one-glance signal even when collapsed */}
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Bot className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Gerente IA
        </span>
        {tempMeta && (
          <span className={cn("h-2 w-2 shrink-0 rounded-full", tempMeta.dot)} />
        )}
        {timing.awaitingReplyMs != null && (
          <span
            className={cn(
              "flex items-center gap-1 text-[10px] font-medium",
              awaitingWarn ? "text-amber-400" : "text-muted-foreground",
            )}
          >
            <Clock className="h-3 w-3" />
            {formatDurationPtBr(timing.awaitingReplyMs)}
          </span>
        )}
        <ChevronDown
          className={cn(
            "ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="space-y-3 border-t border-border px-3 py-3 text-xs">
          {/* Timing flags — no AI, always live */}
          <div className="space-y-1">
            {timing.awaitingReplyMs != null && (
              <p
                className={cn(
                  "flex items-center gap-1.5",
                  awaitingWarn ? "text-amber-300" : "text-muted-foreground",
                )}
              >
                <Clock className="h-3 w-3 shrink-0" />
                Cliente esperando resposta há{" "}
                {formatDurationPtBr(timing.awaitingReplyMs)}
              </p>
            )}
            {timing.firstResponseMs != null && (
              <p
                className={cn(
                  "flex items-center gap-1.5",
                  timing.firstResponseMs >= SLOW_FIRST_RESPONSE_MS
                    ? "text-amber-300"
                    : "text-muted-foreground",
                )}
              >
                <Clock className="h-3 w-3 shrink-0" />
                1ª resposta em {formatDurationPtBr(timing.firstResponseMs)}
              </p>
            )}
          </div>

          {(loading || refreshing) && !insight && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Analisando a conversa…
            </p>
          )}

          {notConfigured && !insight && (
            <p className="text-muted-foreground">
              Configure a IA em Configurações → Assistente de IA para ligar a
              análise do Gerente IA.
            </p>
          )}

          {insight && (
            <>
              {/* Temperatura */}
              {tempMeta && (
                <div>
                  <span className={cn("font-semibold", tempMeta.text)}>
                    {tempMeta.label}
                  </span>
                  {insight.temperatureReason && (
                    <span className="text-muted-foreground">
                      {" — "}
                      {insight.temperatureReason}
                    </span>
                  )}
                </div>
              )}

              {/* O que o cliente quer */}
              {insight.customerWants && (
                <div>
                  <p className="font-medium text-foreground">O cliente quer</p>
                  <p className="text-muted-foreground">{insight.customerWants}</p>
                </div>
              )}

              {/* Estágio sugerido */}
              {canMoveStage && suggestedStage && (
                <div className="flex items-center justify-between gap-2 rounded-md bg-primary/5 px-2 py-1.5">
                  <span className="text-muted-foreground">
                    Sugere mover para{" "}
                    <span className="font-medium text-foreground">
                      «{suggestedStage.name}»
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 shrink-0 px-2 text-[11px]"
                    disabled={busyAction === "move"}
                    onClick={handleMoveStage}
                  >
                    {busyAction === "move" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ArrowRight className="h-3 w-3" />
                    )}
                    Mover
                  </Button>
                </div>
              )}

              {/* Perguntas em aberto */}
              {insight.openQuestions.length > 0 && (
                <div>
                  <p className="flex items-center gap-1 font-medium text-foreground">
                    <HelpCircle className="h-3 w-3" />
                    Perguntas sem resposta
                  </p>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {insight.openQuestions.map((q, i) => (
                      <li key={i} className="flex gap-1.5">
                        <span className="text-muted-foreground/50">•</span>
                        {q}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Próximas ações */}
              {insight.nextActions.length > 0 && (
                <div>
                  <p className="font-medium text-foreground">Próximas ações</p>
                  <ul className="mt-1 space-y-1.5">
                    {insight.nextActions.map((action, i) => (
                      <li
                        key={i}
                        className="rounded-md border border-border bg-card px-2 py-1.5"
                      >
                        <p className="text-foreground">{action.label}</p>
                        {action.kind === "reply" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="mt-1 h-6 px-1.5 text-[11px] text-primary hover:text-primary"
                            disabled={busyAction === `draft-${i}`}
                            onClick={() => handleDraft(action, i)}
                          >
                            {busyAction === `draft-${i}` ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <PenLine className="h-3 w-3" />
                            )}
                            Gerar rascunho
                          </Button>
                        )}
                        {action.kind === "reminder" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="mt-1 h-6 px-1.5 text-[11px]"
                            disabled={busyAction === `note-${i}`}
                            onClick={() => handleAddNote(action, i)}
                          >
                            {busyAction === `note-${i}` ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <StickyNote className="h-3 w-3" />
                            )}
                            Adicionar como nota
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border pt-2 text-[10px] text-muted-foreground">
            <span>
              {meta
                ? `Atualizado ${relTimePtBr(meta.generated_at)}`
                : insight
                  ? ""
                  : "Sem análise ainda"}
            </span>
            <button
              type="button"
              className="flex items-center gap-1 hover:text-foreground disabled:opacity-50"
              disabled={refreshing || !conversationId}
              onClick={() => refresh(true)}
            >
              {refreshing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Atualizar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function relTimePtBr(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "agora";
  return `há ${formatDurationPtBr(diff)}`;
}
