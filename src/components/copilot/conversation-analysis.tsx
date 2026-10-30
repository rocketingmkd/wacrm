"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Analysis {
  summary: string;
  intent: string;
  outcome: string;
  quality: number;
  objections: string[];
  failures: string[];
  nextAction: string;
}

interface Metrics {
  customerMessages: number;
  teamMessages: number;
  firstResponseMin: number | null;
  avgResponseMin: number | null;
  unanswered: boolean;
}

interface Result {
  analysis: Analysis;
  metrics: Metrics;
  messagesRead: number;
}

const OUTCOME_LABEL: Record<string, string> = {
  fechado: "Fechado",
  em_andamento: "Em andamento",
  perdido: "Perdido",
  sem_resposta_da_equipe: "Sem resposta da equipe",
  sem_interesse: "Sem interesse",
  outro: "Outro",
};

function minutes(min: number | null) {
  if (min == null) return "—";
  if (min < 60) return `${Math.round(min * 10) / 10} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h ${Math.round(min % 60)}min` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * Lê UMA conversa com a IA e mostra a ficha na própria tela. "Copiar ficha"
 * leva o JSON da análise, base para um agente de follow up. Só lê, não
 * envia nada ao cliente. Gasta tokens da chave de API da conta.
 */
export function ConversationAnalysis({ conversationId }: { conversationId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const run = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/ai/conversations/${conversationId}/analyze`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Não foi possível analisar a conversa.");
        return;
      }
      setResult(body as Result);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify({ conversationId, ...result }, null, 2));
      toast.success("Ficha copiada.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={() => void run()} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
        {result ? "Analisar de novo" : "Analisar conversa"}
      </Button>

      {result && (
        <div className="space-y-2 rounded-lg border border-border bg-background p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">
              {OUTCOME_LABEL[result.analysis.outcome] ?? result.analysis.outcome} · nota {result.analysis.quality} de 5
            </p>
            <Button variant="ghost" size="sm" onClick={() => void copy()} title="Copiar a ficha em JSON">
              <Copy />
              Copiar ficha
            </Button>
          </div>
          <p className="text-foreground">{result.analysis.summary}</p>
          <p className="text-muted-foreground">
            1ª resposta {minutes(result.metrics.firstResponseMin)} · resposta média {minutes(result.metrics.avgResponseMin)}
            {result.metrics.unanswered ? " · última mensagem do cliente sem resposta" : ""} · {result.messagesRead}{" "}
            mensagens lidas
          </p>
          {result.analysis.intent && (
            <p>
              <span className="font-medium text-foreground">O que buscava:</span>{" "}
              <span className="text-muted-foreground">{result.analysis.intent}</span>
            </p>
          )}
          {result.analysis.objections.length > 0 && (
            <p>
              <span className="font-medium text-foreground">Objeções:</span>{" "}
              <span className="text-muted-foreground">{result.analysis.objections.join("; ")}</span>
            </p>
          )}
          {result.analysis.failures.length > 0 && (
            <p>
              <span className="font-medium text-foreground">Falhas do atendimento:</span>{" "}
              <span className="text-muted-foreground">{result.analysis.failures.join("; ")}</span>
            </p>
          )}
          {result.analysis.nextAction && (
            <p>
              <span className="font-medium text-foreground">Próximo passo:</span>{" "}
              <span className="text-muted-foreground">{result.analysis.nextAction}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
