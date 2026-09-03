"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AiSummaryButtonProps {
  /** The contact's `ai_summary` (migration 058). Button is hidden when
   *  null/empty — there's nothing to show yet. */
  summary?: string | null;
  updatedAt?: string | null;
  /** Display name of the agent that last wrote the summary. */
  agent?: string | null;
  /** Extra classes for the trigger button (sizing differs between the
   *  inbox sidebar and the contacts page). */
  className?: string;
}

/**
 * "Nota IA" — a button that opens a popup with the single evolving
 * summary the AI auto-reply agents keep on a contact. Deliberately
 * separate from the human `contact_notes` list so the two never mix.
 * Renders nothing until an agent has recorded a summary.
 */
export function AiSummaryButton({
  summary,
  updatedAt,
  agent,
  className,
}: AiSummaryButtonProps) {
  const t = useTranslations("AiNote");
  const [open, setOpen] = useState(false);

  if (!summary || !summary.trim()) return null;

  const when = updatedAt
    ? formatDistanceToNow(new Date(updatedAt), { addSuffix: true, locale: ptBR })
    : null;
  const by = [agent ? `IA · ${agent}` : "IA", when].filter(Boolean).join(" · ");

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className={className}
      >
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        {t("button")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              {t("title")}
            </DialogTitle>
          </DialogHeader>
          <p className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-sm text-foreground">
            {summary.trim()}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{by}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
