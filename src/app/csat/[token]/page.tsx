"use client";

import { use, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CSAT_MAX_COMMENT, CSAT_SCORE_LABELS } from "@/lib/csat";

type Info =
  | { state: "loading" }
  | { state: "notfound" }
  | { state: "ready"; answered: boolean; company: string };

/** Public page opened from the link the agent sends ("Enviar avaliação"). */
export default function CsatPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<Info>({ state: "loading" });
  const [score, setScore] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/csat/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) return setInfo({ state: "notfound" });
        const data = await res.json();
        setInfo({ state: "ready", answered: Boolean(data.answered), company: data.company ?? "" });
      })
      .catch(() => !cancelled && setInfo({ state: "notfound" }));
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function submit() {
    if (score < 1) {
      setError("Escolha uma nota de 1 a 5 estrelas.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/csat/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, comment: comment.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Não foi possível enviar sua avaliação.");
        return;
      }
      setDone(true);
    } catch {
      setError("Falha de conexão. Tente de novo.");
    } finally {
      setSending(false);
    }
  }

  const shell = "grid min-h-screen place-items-center bg-background p-6";

  if (info.state === "loading") {
    return (
      <div className={shell}>
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (info.state === "notfound") {
    return (
      <div className={shell}>
        <p className="text-center text-sm text-muted-foreground">
          Esta pesquisa não foi encontrada ou já expirou.
        </p>
      </div>
    );
  }

  if (info.answered || done) {
    return (
      <div className={shell}>
        <div className="max-w-sm text-center">
          <CheckCircle2 className="mx-auto mb-4 size-14 text-primary" />
          <h1 className="font-display text-2xl font-extrabold">Obrigado!</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {done ? "Sua avaliação foi registrada." : "Esta pesquisa já foi respondida."}
          </p>
        </div>
      </div>
    );
  }

  const shown = hover || score;

  return (
    <div className={shell}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-[var(--shadow-card)]">
        <h1 className="text-center font-display text-xl font-extrabold">
          Como foi o seu atendimento{info.company ? ` na ${info.company}` : ""}?
        </h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          Sua opinião nos ajuda a melhorar.
        </p>

        <div
          className="my-6 flex items-center justify-center gap-1.5"
          onMouseLeave={() => setHover(0)}
          role="radiogroup"
          aria-label="Nota de 1 a 5 estrelas"
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={score === n}
              aria-label={`${n} ${n === 1 ? "estrela" : "estrelas"}: ${CSAT_SCORE_LABELS[n]}`}
              onClick={() => setScore(n)}
              onMouseEnter={() => setHover(n)}
              className="rounded-md p-1 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Star
                className={cn(
                  "size-10 transition-colors",
                  n <= shown ? "fill-primary text-primary" : "text-muted-foreground/50",
                )}
              />
            </button>
          ))}
        </div>

        <p className="mb-4 h-5 text-center text-sm font-medium">
          {shown > 0 ? CSAT_SCORE_LABELS[shown] : ""}
        </p>

        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={CSAT_MAX_COMMENT}
          rows={4}
          placeholder="Conte mais (opcional)"
        />

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <Button className="mt-4 w-full" size="lg" onClick={submit} disabled={sending}>
          {sending && <Loader2 className="size-4 animate-spin" />}
          Enviar avaliação
        </Button>
      </div>
    </div>
  );
}
