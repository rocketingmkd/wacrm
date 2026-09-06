"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, CalendarCheck, CalendarX, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * "Registros" tab in /agenda — the answer to "did the AI actually
 * check the calendar before offering a time". One row per booking
 * attempt (migration 059, `ai_booking_attempts`), written by the
 * auto-reply engine (src/lib/agenda/booking.ts) regardless of outcome.
 * Read-only, direct RLS-scoped client reads — mirrors the style of
 * `src/app/(dashboard)/automations/[id]/logs/page.tsx`.
 */

type Outcome = "booked" | "rejected" | "no_availability" | "error";

interface OfferedSlot {
  token: string;
  label: string;
}

interface BookingAttempt {
  id: string;
  requested_at: string;
  outcome: Outcome;
  reason: string | null;
  agent_name: string | null;
  offered_slots: OfferedSlot[];
  payload: { whenRaw?: string; email?: string | null; subject?: string | null } | null;
  contact: { name: string | null; phone: string | null } | null;
}

const OUTCOME_LABEL: Record<Outcome, string> = {
  booked: "Marcado",
  rejected: "Recusado",
  no_availability: "Agenda não configurada",
  error: "Erro",
};

const OUTCOME_TONE: Record<Outcome, string> = {
  booked: "border-primary/30 bg-primary/10 text-primary",
  rejected: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  no_availability: "border-muted-foreground/30 bg-muted text-muted-foreground",
  error: "border-red-500/30 bg-red-500/10 text-red-300",
};

const REASON_LABEL: Record<string, string> = {
  agenda_not_configured: "a conta ainda não tem uma Agenda configurada",
  invalid_datetime: "o horário emitido pela IA veio em formato inválido",
  not_available: "o horário pedido não está na lista de disponibilidade real",
  slot_just_taken: "outra conversa marcou esse mesmo horário primeiro",
  insert_failed: "falha ao gravar o compromisso",
  error: "erro inesperado ao tentar marcar",
};

export function AgendaBookingLog() {
  const [attempts, setAttempts] = useState<BookingAttempt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data, error: err } = await supabase
        .from("ai_booking_attempts")
        .select("*, contact:contacts(name, phone)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (cancelled) return;
      if (err) {
        setError(err.message);
        return;
      }
      setAttempts((data ?? []) as unknown as BookingAttempt[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="text-sm text-red-400">{error}</p>;
  }

  if (attempts === null) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (attempts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16">
        <CalendarCheck className="h-10 w-10 text-muted-foreground" />
        <p className="mt-3 text-sm text-foreground">Nenhuma tentativa de agendamento ainda.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Toda vez que um agente com permissão de agendar tentar marcar um horário, o resultado
          aparece aqui — inclusive quando ele é recusado.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {attempts.map((a) => {
        const isOpen = openId === a.id;
        return (
          <li key={a.id} className="rounded-xl border border-border bg-card">
            <button
              type="button"
              onClick={() => setOpenId(isOpen ? null : a.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
            >
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  OUTCOME_TONE[a.outcome],
                )}
              >
                {OUTCOME_LABEL[a.outcome]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  {a.contact?.name ?? a.contact?.phone ?? "Contato desconhecido"}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {a.agent_name ?? "Agente"} · {a.payload?.whenRaw ?? "sem horário"}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(a.requested_at), { addSuffix: true, locale: ptBR })}
              </div>
            </button>
            {isOpen && (
              <div className="space-y-3 border-t border-border px-4 py-3 text-xs">
                {a.reason && (
                  <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-300">
                    {REASON_LABEL[a.reason] ?? a.reason}
                  </p>
                )}
                <div>
                  <p className="mb-1 font-medium text-foreground">
                    Disponibilidade consultada no momento da tentativa
                  </p>
                  {a.offered_slots.length === 0 ? (
                    <p className="flex items-center gap-1.5 text-muted-foreground">
                      <CalendarX className="h-3.5 w-3.5" /> Nenhum horário livre encontrado.
                    </p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {a.offered_slots.map((s) => (
                        <li
                          key={s.token}
                          className="rounded-md border border-border bg-muted/40 px-2 py-1 text-muted-foreground"
                        >
                          {s.label}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
