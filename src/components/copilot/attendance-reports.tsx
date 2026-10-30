"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Download, ExternalLink, FileBarChart, Loader2, Play, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";

type Mode = "full" | "keyword";
type Status = "pending" | "running" | "done" | "error" | "cancelled";

interface ReportSummary {
  id: string;
  mode: Mode;
  keyword: string | null;
  source_filter: string | null;
  date_from: string | null;
  date_to: string | null;
  status: Status;
  total: number;
  processed: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

interface Preview {
  total: number;
  truncated: boolean;
  estimatedTokens: number;
}

const SOURCE_OPTIONS = [
  { value: "", label: "Todas as origens" },
  { value: "meta_ctwa", label: "Meta (clique no anúncio)" },
  { value: "meta_site", label: "Meta (site)" },
  { value: "google", label: "Google" },
  { value: "other", label: "Outra origem" },
  { value: "sem_origem", label: "Sem origem" },
];

const STATUS_LABEL: Record<Status, string> = {
  pending: "Aguardando",
  running: "Em andamento",
  done: "Pronto",
  error: "Falhou",
  cancelled: "Cancelado",
};

const INPUT_CLASS =
  "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

const tokens = (n: number) => new Intl.NumberFormat("pt-BR").format(Math.round(n / 1000) * 1000);

export function AttendanceReports() {
  const [mode, setMode] = useState<Mode>("keyword");
  const [keyword, setKeyword] = useState("");
  const [source, setSource] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"preview" | "create" | null>(null);
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const stopRef = useRef(false);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/reports");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Não foi possível carregar os relatórios.");
        return;
      }
      setError(null);
      setReports(body.reports as ReportSummary[]);
    } catch {
      setError("Não foi possível carregar os relatórios.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void loadList();
    return () => {
      stopRef.current = true;
    };
  }, [loadList]);

  const payload = (extra: Record<string, unknown> = {}) => ({
    mode,
    keyword: mode === "keyword" ? keyword : undefined,
    source: source || undefined,
    dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : undefined,
    dateTo: dateTo ? new Date(`${dateTo}T23:59:59`).toISOString() : undefined,
    ...extra,
  });

  const post = async (body: unknown) => {
    const res = await fetch("/api/ai/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, json };
  };

  const calculate = async () => {
    setBusy("preview");
    setPreview(null);
    try {
      const { ok, json } = await post(payload({ preview: true }));
      if (!ok) {
        toast.error(json.error ?? "Não foi possível calcular.");
        return;
      }
      setPreview(json as Preview);
    } finally {
      setBusy(null);
    }
  };

  /** Chama o lote em sequência até terminar, falhar ou o usuário parar. */
  const run = useCallback(
    async (id: string) => {
      stopRef.current = false;
      setRunningId(id);
      try {
        while (!stopRef.current) {
          const res = await fetch(`/api/ai/reports/${id}/step`, { method: "POST" });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            toast.error(body.error ?? "O processamento parou. Você pode continuar depois.");
            break;
          }
          setReports((rs) =>
            rs?.map((r) => (r.id === id ? { ...r, status: body.status, processed: body.processed, total: body.total, error: body.error } : r)) ?? rs,
          );
          if (body.status === "done") {
            toast.success("Relatório pronto.");
            break;
          }
          if (body.status === "error") {
            toast.error(body.error ?? "A leitura por IA falhou.");
            break;
          }
          if (body.status === "cancelled") break;
        }
      } finally {
        setRunningId(null);
        await loadList();
      }
    },
    [loadList],
  );

  const create = async () => {
    setBusy("create");
    try {
      const { ok, json } = await post(payload());
      if (!ok) {
        toast.error(json.error ?? "Não foi possível criar o relatório.");
        return;
      }
      setPreview(null);
      await loadList();
      void run(json.id as string);
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (id: string) => {
    stopRef.current = true;
    const res = await fetch(`/api/ai/reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    if (!res.ok) toast.error("Não foi possível cancelar.");
    await loadList();
  };

  const title = (r: ReportSummary) => (r.mode === "keyword" ? `Palavra-chave: “${r.keyword}”` : "Histórico completo");
  const canCalculate = mode === "full" || keyword.trim().length >= 3;

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FileBarChart className="h-4 w-4 text-primary" />
          Relatórios de atendimento
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          A IA lê os atendimentos e gera um relatório com tempos de resposta, resultado, objeções e falhas, comparando
          por origem do lead. Gasta tokens da sua chave de API. Só lê, não envia nada ao cliente.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>
      )}

      <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-xs w-fit">
        {(
          [
            { v: "keyword", label: "Por palavra-chave" },
            { v: "full", label: "Histórico completo" },
          ] as const
        ).map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => {
              setMode(o.v);
              setPreview(null);
            }}
            aria-pressed={mode === o.v}
            className={cn(
              "rounded-md px-3 py-1 font-medium transition-colors",
              mode === o.v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {mode === "keyword" && (
          <input
            className={cn(INPUT_CLASS, "sm:col-span-2 lg:col-span-4")}
            placeholder="Palavra ou frase que o cliente escreveu (ex: vim pelo site)"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPreview(null);
            }}
            maxLength={200}
            aria-label="Palavra-chave"
          />
        )}
        <select className={INPUT_CLASS} value={source} onChange={(e) => { setSource(e.target.value); setPreview(null); }} aria-label="Origem">
          {SOURCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input className={INPUT_CLASS} type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPreview(null); }} aria-label="Data inicial" />
        <input className={INPUT_CLASS} type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPreview(null); }} aria-label="Data final" />
        <Button variant="outline" onClick={() => void calculate()} disabled={!canCalculate || busy !== null || runningId !== null}>
          {busy === "preview" ? <Loader2 className="animate-spin" /> : <Play />}
          Calcular
        </Button>
      </div>

      {preview && (
        <div className="space-y-2 rounded-lg border border-border bg-background p-3">
          <p className="text-sm text-foreground">
            {preview.total} {preview.total === 1 ? "conversa será lida" : "conversas serão lidas"}. Estimativa: cerca de{" "}
            <span className="font-medium">{tokens(preview.estimatedTokens)} tokens</span> da sua chave de API (valor
            aproximado).
          </p>
          {preview.truncated && (
            <p className="text-xs text-amber-300">A busca atingiu o limite de mensagens, pode haver mais conversas.</p>
          )}
          <Button size="sm" onClick={() => void create()} disabled={busy !== null || runningId !== null}>
            {busy === "create" ? <Loader2 className="animate-spin" /> : <Play />}
            Gerar relatório
          </Button>
        </div>
      )}

      {reports && reports.length > 0 && (
        <ul className="space-y-2 border-t border-border pt-3">
          {reports.map((r) => {
            const active = runningId === r.id;
            const pct = r.total ? Math.round((r.processed / r.total) * 100) : 0;
            return (
              <li key={r.id} className="rounded-lg border border-border bg-background p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{title(r)}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(r.created_at), "dd/MM/yyyy HH:mm")} · {r.total} conversa(s) ·{" "}
                      {active ? "Processando..." : STATUS_LABEL[r.status]}
                    </p>
                  </div>

                  {r.status === "done" && (
                    <div className="flex flex-wrap gap-1.5">
                      <a
                        href={`/api/ai/reports/${r.id}/download?format=html&inline=1`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        <ExternalLink />
                        Abrir
                      </a>
                      <a
                        href={`/api/ai/reports/${r.id}/download?format=html`}
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        <Download />
                        HTML
                      </a>
                      <a
                        href={`/api/ai/reports/${r.id}/download?format=json`}
                        title="Fichas por conversa, para usar em um agente de follow up"
                        className={buttonVariants({ variant: "ghost", size: "sm" })}
                      >
                        <Download />
                        JSON
                      </a>
                    </div>
                  )}

                  {(r.status === "pending" || r.status === "running") && !active && (
                    <Button size="sm" onClick={() => void run(r.id)} disabled={runningId !== null}>
                      <Play />
                      Continuar
                    </Button>
                  )}
                  {(r.status === "pending" || r.status === "running") && (
                    <Button variant="ghost" size="sm" onClick={() => void cancel(r.id)} title="Cancelar">
                      <Square />
                      Cancelar
                    </Button>
                  )}
                </div>

                {(r.status === "pending" || r.status === "running") && (
                  <div className="mt-2">
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {r.processed} de {r.total} · mantenha esta tela aberta; se fechar, é só clicar em Continuar.
                    </p>
                  </div>
                )}
                {r.status === "error" && r.error && <p className="mt-2 text-xs text-red-300">{r.error}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
