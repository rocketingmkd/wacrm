"use client";

import Link from "next/link";
import type { Deal, PipelineStage } from "@/types";
import { formatCurrency } from "@/lib/currency";
import { Check, MessageSquare, X } from "lucide-react";
import { useTranslations } from "next-intl";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || "?").trim();
  if (!source) return "?";
  return source.charAt(0).toUpperCase();
}

export function DealCard({ deal, stage, onEdit, isOverlay }: DealCardProps) {
  const t = useTranslations("Pipelines.card");
  const contactLabel = deal.contact?.name || deal.contact?.phone || t("noContact");

  return (
    // A plain <button> can't contain the "go to conversation" <Link>
    // below (nested interactive elements are invalid HTML), so the
    // card itself is a div with a button role instead.
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => {
        // `onClick` still fires after a non-drag tap because the PointerSensor
        // requires 5px movement before it counts as a drag.
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      onKeyDown={(e) => {
        if (isOverlay) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEdit(deal);
        }
      }}
      className={`group relative w-full cursor-pointer rounded-xl border border-border/50 bg-muted/70 pl-4 pr-3 py-3 text-left shadow-sm transition-all ${
        isOverlay
          ? "shadow-xl"
          : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
      }`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
            {initials(deal.contact?.name, deal.contact?.phone)}
          </span>
          <span className="truncate text-sm font-semibold leading-snug text-foreground">
            {contactLabel}
          </span>
        </div>
        {deal.status === "won" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
            <Check className="h-3 w-3" />
            {t("won")}
          </span>
        )}
        {deal.status === "lost" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
            <X className="h-3 w-3" />
            {t("lost")}
          </span>
        )}
      </div>

      {/* Lead source lands here once the field exists — a future
          phase, per product decision. */}

      {(deal.value > 0 || deal.conversation_id) && (
        <div className="mt-2 flex items-center justify-between gap-2">
          {deal.value > 0 ? (
            <span className="text-sm font-bold text-primary">
              {formatCurrency(deal.value, deal.currency)}
            </span>
          ) : (
            <span />
          )}
          {deal.conversation_id && (
            <Link
              href={`/inbox?c=${deal.conversation_id}`}
              onClick={(e) => e.stopPropagation()}
              title={t("goToConversation")}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20"
            >
              <MessageSquare className="h-3 w-3" />
              {t("goToConversation")}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
