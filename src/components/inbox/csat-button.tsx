"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Star } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface CsatButtonProps {
  conversationId: string;
  /** The 24h service window is open (the link goes as free text). */
  windowOpen: boolean;
}

interface LatestCsat {
  score: number | null;
  answered_at: string | null;
}

/**
 * "Enviar avaliação": sends the customer a link to rate the service.
 * Shows the latest state for the thread: rated (score), sent and waiting.
 */
export function CsatButton({ conversationId, windowOpen }: CsatButtonProps) {
  const [latest, setLatest] = useState<LatestCsat | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await createClient()
      .from("csat_responses")
      .select("score, answered_at")
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle<LatestCsat>();
    setLatest(data ?? null);
  }, [conversationId]);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .from("csat_responses")
      .select("score, answered_at")
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle<LatestCsat>()
      .then(({ data }) => {
        if (!cancelled) setLatest(data ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  async function send() {
    setBusy(true);
    try {
      const res = await fetch("/api/csat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? "Não foi possível enviar a avaliação.");
        return;
      }
      toast.success("Pedido de avaliação enviado ao cliente.");
      await load();
    } catch {
      toast.error("Falha de conexão ao enviar a avaliação.");
    } finally {
      setBusy(false);
    }
  }

  const answered = latest?.answered_at && latest.score;
  const pending = latest && !latest.answered_at;
  const label = answered ? `Nota ${latest.score}` : pending ? "Avaliação enviada" : "Enviar avaliação";
  const title = !windowOpen
    ? "A janela de 24h está fechada. Reabra a conversa para enviar a avaliação."
    : answered
      ? `O cliente deu nota ${latest.score}. Clique para enviar outro pedido.`
      : pending
        ? "Pedido enviado, aguardando o cliente. Clique para reenviar depois de 1 hora."
        : "Envia ao cliente um link para avaliar o atendimento.";

  return (
    <button
      type="button"
      onClick={() => void send()}
      disabled={busy || !windowOpen}
      title={title}
      aria-label={label}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
        answered ? "text-primary" : "text-muted-foreground",
      )}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Star className={cn("h-3.5 w-3.5", answered && "fill-primary")} />
      )}
      <span className="hidden 2xl:inline">{label}</span>
    </button>
  );
}
