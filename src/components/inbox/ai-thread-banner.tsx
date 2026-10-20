"use client";

import { useEffect, useState } from "react";
import { Hand } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

// ------------------------------------------------------------
// Account AI status is the same for every conversation, so cache it per
// account and reuse it across thread switches instead of hitting
// /api/ai/agents every time the agent opens a chat.
//
// Keyed by accountId (a multi-account user switching workspaces must not
// see the previous account's status), and only *successful* fetches are
// cached: a transient failure returns a default without poisoning the
// cache, so it retries on the next thread open.
//
// This only answers "does the account have ANY agent that could
// auto-reply". Which specific agent is on duty for a conversation is
// resolved server-side.
// ------------------------------------------------------------
interface AiAccountStatus {
  autoReplyOn: boolean;
}
const statusCache = new Map<string, AiAccountStatus>();

export async function fetchAiAccountStatus(accountId: string): Promise<AiAccountStatus> {
  const cached = statusCache.get(accountId);
  if (cached) return cached;
  try {
    const res = await fetch("/api/ai/agents", { cache: "no-store" });
    if (!res.ok) return { autoReplyOn: false }; // don't cache a transient failure
    const j = await res.json();
    const agents = Array.isArray(j?.agents) ? j.agents : [];
    const status = {
      // Auto-reply is "live" when the receptionist is active with the
      // inbound bot enabled (`auto_reply_enabled` is receptionist-only,
      // guaranteed by a DB constraint, migration 053).
      autoReplyOn: agents.some(
        (a: { is_active?: boolean; auto_reply_enabled?: boolean }) =>
          a?.is_active && a?.auto_reply_enabled,
      ),
    };
    statusCache.set(accountId, status);
    return status;
  } catch {
    return { autoReplyOn: false }; // don't cache
  }
}

/** Whether the account has AI auto-reply set up (cached per account). */
export function useAiAutoReplyAvailable(): boolean | null {
  const { accountId } = useAuth();
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    fetchAiAccountStatus(accountId).then((s) => alive && setOn(s.autoReplyOn));
    return () => {
      alive = false;
    };
  }, [accountId]);
  return on;
}

interface AiThreadBannerProps {
  /** AI auto-reply is paused on this thread (owned by the thread header). */
  paused: boolean;
  /** `conversations.ai_handoff_summary`: note the bot left on handoff. */
  handoffSummary?: string | null;
}

/**
 * Note shown under the header only when the bot handed the conversation
 * to a human and left a summary. The on/off control itself lives in the
 * header ("IA ativa" switch), so this renders nothing otherwise.
 */
export function AiThreadBanner({ paused, handoffSummary }: AiThreadBannerProps) {
  if (!paused || !handoffSummary) return null;
  return (
    <div className="flex items-start gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs sm:px-4">
      <Hand className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="font-medium text-foreground">A IA transferiu esta conversa para um humano</p>
        <p className="text-muted-foreground">{handoffSummary}</p>
      </div>
    </div>
  );
}
