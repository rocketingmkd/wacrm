"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Contact, Conversation, Deal, Message, PipelineStage } from "@/types";
import { AiCopilotPanel } from "@/components/inbox/ai-copilot-panel";
import { ScrollArea } from "@/components/ui/scroll-area";

interface AiPanelProps {
  contact: Contact | null;
  conversation: Conversation | null;
  messages: Message[];
  /** Push a generated draft into the composer (threaded up to the page). */
  onInsertDraft: (text: string) => void;
}

/**
 * Dedicated right-side panel for the Gerente IA copilot — same chrome
 * (width, border, scroll area) as `ContactSidebar`, so toggling between
 * the two via the thread header feels like switching tabs, not a
 * different UI. Fetches its own slice of the contact's deals + the
 * account's pipeline stages (a small overlap with `ContactSidebar`'s
 * fetch) rather than sharing state, since only one of the two panels is
 * ever mounted at a time.
 */
export function AiPanel({ contact, conversation, messages, onInsertDraft }: AiPanelProps) {
  const tThread = useTranslations("Inbox.messageThread");
  const { accountId } = useAuth();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([]);

  const fetchDeals = useCallback(async () => {
    if (!contact) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("deals")
      .select("*, stage:pipeline_stages(*)")
      .eq("contact_id", contact.id)
      .order("created_at", { ascending: false });
    if (data) setDeals(data);
  }, [contact]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDeals();
  }, [fetchDeals]);

  // Account-wide, not contact-scoped — only needs to (re)load when the
  // account changes, not on every contact switch. Same query
  // `ContactSidebar` runs for its "add to pipeline" shortcut.
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const { data: pipelines } = await supabase
        .from("pipelines")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1);
      const firstPipelineId = pipelines?.[0]?.id;
      if (cancelled || !firstPipelineId) return;
      const { data: stages } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", firstPipelineId)
        .order("position", { ascending: true });
      if (!cancelled) setPipelineStages((stages as PipelineStage[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">{tThread("selectConversation")}</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone || contact.wa_username || "Contato";

  return (
    <div className="flex h-full w-70 flex-col border-l border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3.5">
        <Bot className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">Gerente IA</h3>
          <p className="truncate text-xs text-muted-foreground">{displayName}</p>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4">
          {conversation?.id ? (
            <AiCopilotPanel
              conversationId={conversation.id}
              contactId={contact.id}
              accountId={accountId ?? null}
              messages={messages}
              deals={deals}
              stages={pipelineStages}
              onInsertDraft={onInsertDraft}
              onDataChanged={fetchDeals}
            />
          ) : (
            <p className="text-xs text-muted-foreground">{tThread("selectConversation")}</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
