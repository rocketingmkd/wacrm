"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { cn } from "@/lib/utils";
import type { Contact } from "@/types";
import { GitBranch, ChevronDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

/**
 * Header control that associates the open conversation's contact with a
 * pipeline, mirroring the agent-assign dropdown next to it. Picking a
 * pipeline creates a placeholder deal (no title prompt — falls back to
 * the contact's name) in that pipeline's first stage. Picking one the
 * contact is already in removes it, but only while the deal is still an
 * empty placeholder (no value, no notes) so real deal history is never
 * silently deleted.
 *
 * A contact can sit in several pipelines at once, so this is a set of
 * toggles, not a single-value assignment like `assigned_agent_id`.
 */

interface PipelineRow {
  id: string;
  name: string;
  firstStageId: string | null;
}

interface ContactDeal {
  id: string;
  pipeline_id: string;
  value: number | null;
  notes: string | null;
}

export function PipelineAssignMenu({
  contact,
  onChanged,
}: {
  contact: Contact;
  onChanged?: () => void;
}) {
  const t = useTranslations("Inbox.messageThread");
  const { accountId, defaultCurrency } = useAuth();
  const canAssign = useCan("send-messages");

  const [pipelines, setPipelines] = useState<PipelineRow[]>([]);
  const [deals, setDeals] = useState<ContactDeal[]>([]);
  const [busy, setBusy] = useState(false);

  // Account-wide list — only reloads when the account changes.
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const { data: pl } = await supabase
        .from("pipelines")
        .select("id, name")
        .order("created_at", { ascending: true });
      const ids = (pl ?? []).map((p) => p.id as string);
      const { data: stages } = ids.length
        ? await supabase
            .from("pipeline_stages")
            .select("id, pipeline_id, position")
            .in("pipeline_id", ids)
            .order("position", { ascending: true })
        : { data: [] as { id: string; pipeline_id: string }[] };
      if (cancelled) return;
      const firstByPipeline = new Map<string, string>();
      for (const s of stages ?? []) {
        if (!firstByPipeline.has(s.pipeline_id)) {
          firstByPipeline.set(s.pipeline_id, s.id as string);
        }
      }
      setPipelines(
        (pl ?? []).map((p) => ({
          id: p.id as string,
          name: p.name as string,
          firstStageId: firstByPipeline.get(p.id as string) ?? null,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const loadDeals = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("deals")
      .select("id, pipeline_id, value, notes")
      .eq("contact_id", contact.id)
      .eq("status", "open");
    setDeals((data as ContactDeal[]) ?? []);
  }, [contact.id]);

  useEffect(() => {
    loadDeals();
  }, [loadDeals]);

  const dealFor = useCallback(
    (pipelineId: string) => deals.find((d) => d.pipeline_id === pipelineId),
    [deals],
  );

  const handleToggle = useCallback(
    async (p: PipelineRow) => {
      if (busy) return;
      const existing = deals.find((d) => d.pipeline_id === p.id);
      const supabase = createClient();
      setBusy(true);
      try {
        if (existing) {
          if ((existing.value ?? 0) > 0 || (existing.notes ?? "").trim()) {
            toast.error(t("pipelineRemoveBlocked"));
            return;
          }
          const { error } = await supabase
            .from("deals")
            .delete()
            .eq("id", existing.id);
          if (error) {
            toast.error(t("pipelineRemoveFailed"));
            return;
          }
          toast.success(t("pipelineRemoved", { name: p.name }));
        } else {
          if (!p.firstStageId) {
            toast.error(t("pipelineNoStages"));
            return;
          }
          if (!accountId) return;
          const {
            data: { session },
          } = await supabase.auth.getSession();
          const uid = session?.user?.id;
          if (!uid) return;
          const title =
            contact.name || contact.phone || contact.wa_username || "Lead";
          const { error } = await supabase.from("deals").insert({
            account_id: accountId,
            user_id: uid,
            pipeline_id: p.id,
            stage_id: p.firstStageId,
            contact_id: contact.id,
            title,
            value: 0,
            currency: defaultCurrency,
            status: "open",
          });
          if (error) {
            toast.error(t("pipelineAddFailed"));
            return;
          }
          toast.success(t("pipelineAdded", { name: p.name }));
        }
        await loadDeals();
        onChanged?.();
      } finally {
        setBusy(false);
      }
    },
    [busy, deals, accountId, defaultCurrency, contact, t, loadDeals, onChanged],
  );

  if (!canAssign) return null;

  const activeCount = deals.length;
  const label =
    activeCount === 0
      ? t("pipeline")
      : activeCount === 1
        ? (pipelines.find((p) => p.id === deals[0].pipeline_id)?.name ??
          t("pipelineAssigned"))
        : t("pipelineCount", { count: activeCount });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
          activeCount > 0 ? "text-primary" : "text-muted-foreground",
        )}
      >
        <GitBranch className="h-3 w-3" />
        <span className="hidden max-w-32 truncate sm:inline">{label}</span>
        <ChevronDown className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border-border bg-popover">
        {pipelines.length === 0 ? (
          <DropdownMenuItem
            disabled
            className="text-sm text-muted-foreground"
          >
            {t("noPipelines")}
          </DropdownMenuItem>
        ) : (
          pipelines.map((p) => {
            const inPipeline = !!dealFor(p.id);
            return (
              <DropdownMenuItem
                key={p.id}
                onClick={() => handleToggle(p)}
                className={cn(
                  "text-sm",
                  inPipeline ? "text-primary" : "text-popover-foreground",
                )}
              >
                <span className="flex-1 truncate">{p.name}</span>
                {inPipeline && <Check className="ml-2 h-3 w-3 shrink-0" />}
              </DropdownMenuItem>
            );
          })
        )}
        {activeCount > 0 && (
          <>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              disabled
              className="text-[11px] text-muted-foreground"
            >
              {t("pipelineRemoveHint")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
