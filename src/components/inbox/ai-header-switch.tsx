"use client";

import { useState } from "react";
import { Bot, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { useAiAutoReplyAvailable } from "./ai-thread-banner";

interface AiHeaderSwitchProps {
  conversationId: string;
  /** AI auto-reply is paused on this thread. */
  paused: boolean;
  /** Called after the server accepted the change. */
  onPausedChange: (paused: boolean) => void;
}

/**
 * "IA ativa" switch for the conversation header. On means the AI answers
 * this thread; turning it off takes the conversation over (it also
 * assigns it to the acting agent), turning it on hands it back. Uses the
 * same endpoint the old banner used. Hidden when the account has no AI
 * auto-reply set up, unless the thread is already paused (so it can be
 * resumed).
 */
export function AiHeaderSwitch({ conversationId, paused, onPausedChange }: AiHeaderSwitchProps) {
  const available = useAiAutoReplyAvailable();
  const [busy, setBusy] = useState(false);

  if (!available && !paused) return null;

  async function change(nextPaused: boolean) {
    setBusy(true);
    try {
      const res = await fetch(`/api/ai/autoreply/${conversationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Taking over also assigns the thread to the acting agent.
        body: JSON.stringify({ paused: nextPaused, assign_to_me: nextPaused }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j?.error ?? "Não foi possível atualizar a IA nesta conversa.");
        return;
      }
      onPausedChange(nextPaused);
      toast.success(nextPaused ? "Você assumiu a conversa. IA pausada." : "IA reativada nesta conversa.");
    } catch {
      toast.error("Falha de conexão ao atualizar a IA.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <label
      className="inline-flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      title={paused ? "IA pausada. Ative para ela voltar a responder." : "IA respondendo. Desative para assumir a conversa."}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
      <span className="hidden 2xl:inline">IA ativa</span>
      <Switch
        checked={!paused}
        disabled={busy}
        onCheckedChange={(on) => void change(!on)}
        aria-label="IA ativa nesta conversa"
      />
    </label>
  );
}
