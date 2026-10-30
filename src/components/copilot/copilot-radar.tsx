"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Lock,
  Loader2,
  MessageSquare,
  PlayCircle,
  Radar,
  Sparkles,
  Timer,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Skeleton } from "@/components/dashboard/skeleton";
import { ContactAvatar } from "@/components/inbox/contact-avatar";
import { AttendanceReports } from "@/components/copilot/attendance-reports";

type Kind = "bottleneck" | "quality" | "opportunity";
type Severity = "info" | "warn" | "critical";

interface RadarInsight {
  id: string;
  kind: Kind;
  severity: Severity;
  title: string;
  description: string | null;
  evidence: { waiting_since?: string } | null;
  created_at: string;
  resolved_at: string | null;
  conversation: {
    id: string;
    contact: {
      name: string | null;
      phone: string | null;
      avatar_url: string | null;
      is_group: boolean | null;
    } | null;
  } | null;
}

interface RadarRun {
  created_at: string;
  ai_status: "ok" | "skipped" | "error";
  ai_error: string | null;
  conversations_analyzed: number;
  insights_created: number;
  insights_resolved: number;
}

interface RadarResponse {
  open: RadarInsight[];
  resolved: RadarInsight[];
  lastRun: RadarRun | null;
}

interface ScanResult {
  aiStatus: "ok" | "skipped" | "error";
  aiError: string | null;
  analyzed: number;
  created: number;
  resolved: number;
  bottlenecks: number;
}

const KIND_META: Record<
  Kind,
  { label: string; icon: typeof Timer; tone: string }
> = {
  bottleneck: { label: "Gargalo", icon: Timer, tone: "bg-amber-500/10 text-amber-400" },
  quality: { label: "Qualidade", icon: AlertTriangle, tone: "bg-red-500/10 text-red-400" },
  opportunity: { label: "Oportunidade", icon: TrendingUp, tone: "bg-emerald-500/10 text-emerald-400" },
};

const SEVERITY_META: Record<Severity, { label: string; badge: string; border: string; rank: number }> = {
  critical: { label: "Crítico", badge: "border-red-500/40 bg-red-500/10 text-red-400", border: "border-l-red-500", rank: 0 },
  warn: { label: "Atenção", badge: "border-amber-500/40 bg-amber-500/10 text-amber-400", border: "border-l-amber-500", rank: 1 },
  info: { label: "Informativo", badge: "border-sky-500/40 bg-sky-500/10 text-sky-400", border: "border-l-sky-500", rank: 2 },
};

const FILTERS: { value: "all" | Kind; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "bottleneck", label: "Gargalos" },
  { value: "quality", label: "Qualidade" },
  { value: "opportunity", label: "Oportunidades" },
];

const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR });

export function CopilotRadar() {
  const [data, setData] = useState<RadarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState<"all" | Kind>("all");
  const [showResolved, setShowResolved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/radar");
      const body = await res.json().catch(() => ({}));
      if (res.status === 403 && body.code === "plan_upgrade_required") {
        setLocked(true);
        return;
      }
      if (!res.ok) {
        setLoadError(body.error ?? "Não foi possível carregar o radar.");
        return;
      }
      setLoadError(null);
      setData(body as RadarResponse);
    } catch {
      setLoadError("Não foi possível carregar o radar.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void load();
  }, [load]);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/ai/radar/scan", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Não foi possível analisar agora.");
        return;
      }
      const r = body as ScanResult;
      if (r.aiStatus === "error") {
        toast.error(`A leitura por IA falhou: ${r.aiError ?? "erro do provedor"}`);
      } else if (r.aiStatus === "skipped") {
        toast.info("Gargalos atualizados. Falta cadastrar a chave de API para a leitura por IA.");
      } else {
        toast.success(
          `Análise concluída: ${r.analyzed} conversa(s) lida(s) pela IA, ${r.created} alerta(s) novo(s).`,
        );
      }
      await load();
    } catch {
      toast.error("Não foi possível analisar agora.");
    } finally {
      setScanning(false);
    }
  }, [load]);

  const resolve = useCallback(
    async (id: string) => {
      // Optimistic: move it to "resolvidos" right away, reload on failure.
      setData((d) => {
        if (!d) return d;
        const item = d.open.find((i) => i.id === id);
        if (!item) return d;
        return {
          ...d,
          open: d.open.filter((i) => i.id !== id),
          resolved: [{ ...item, resolved_at: new Date().toISOString() }, ...d.resolved],
        };
      });
      const res = await fetch(`/api/ai/radar/${id}`, { method: "PATCH" });
      if (!res.ok) {
        toast.error("Não foi possível resolver o alerta.");
        void load();
      }
    },
    [load],
  );

  const open = useMemo(
    () =>
      [...(data?.open ?? [])].sort(
        (a, b) =>
          SEVERITY_META[a.severity].rank - SEVERITY_META[b.severity].rank ||
          b.created_at.localeCompare(a.created_at),
      ),
    [data],
  );
  const counts = useMemo(
    () => ({
      bottleneck: open.filter((i) => i.kind === "bottleneck").length,
      quality: open.filter((i) => i.kind === "quality").length,
      opportunity: open.filter((i) => i.kind === "opportunity").length,
      critical: open.filter((i) => i.severity === "critical").length,
    }),
    [open],
  );

  const list = (showResolved ? data?.resolved ?? [] : open).filter(
    (i) => filter === "all" || i.kind === filter,
  );

  if (locked) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-border bg-card p-8 text-center">
        <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
        <h1 className="mt-3 text-lg font-semibold text-foreground">Copiloto IA</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O radar de gargalos, qualidade e oportunidades faz parte do plano Pro.
        </p>
      </div>
    );
  }

  const run = data?.lastRun ?? null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Radar className="h-5 w-5 text-primary" />
            Copiloto IA
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Aponta conversas paradas, clientes insatisfeitos e oportunidades de venda. Ele não responde ao cliente.
          </p>
          {run && (
            <p className="mt-1 text-xs text-muted-foreground">
              Última análise {ago(run.created_at)}
              {run.ai_status === "ok" && ` · ${run.conversations_analyzed} conversa(s) lida(s) pela IA`}
            </p>
          )}
        </div>
        <Button onClick={scan} disabled={scanning || loading}>
          {scanning ? <Loader2 className="animate-spin" /> : <PlayCircle />}
          {scanning ? "Analisando..." : "Analisar agora"}
        </Button>
      </header>

      {run?.ai_status === "skipped" && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          A leitura por IA (qualidade e oportunidades) precisa só de uma chave de API cadastrada.{" "}
          <Link href="/agents" className="font-medium underline">
            Cadastrar chave de API
          </Link>{" "}
          (aba &quot;Chave de API&quot;). Os gargalos por tempo já funcionam sem IA.
        </div>
      )}
      {run?.ai_status === "error" && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          A última leitura por IA falhou{run.ai_error ? `: ${run.ai_error}` : "."} Confira a chave de API na aba &quot;Chave de API&quot; em{" "}
          <Link href="/agents" className="font-medium underline">
            Agentes de IA
          </Link>
          .
        </div>
      )}
      {loadError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {loadError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard title="Gargalos" value={String(counts.bottleneck)} icon={Timer} subtitle="Cliente esperando resposta" />
        <MetricCard title="Qualidade" value={String(counts.quality)} icon={AlertTriangle} subtitle="Sinais de insatisfação" />
        <MetricCard title="Oportunidades" value={String(counts.opportunity)} icon={TrendingUp} subtitle="Intenção de compra" />
        <MetricCard title="Críticos" value={String(counts.critical)} icon={Sparkles} subtitle="Pedem ação agora" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              aria-pressed={filter === f.value}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                filter === f.value
                  ? "bg-primary-soft text-primary shadow-[inset_0_0_0_1px_var(--primary-soft-2)]"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-xs">
          {[
            { v: false, label: `Abertos (${open.length})` },
            { v: true, label: "Resolvidos" },
          ].map((o) => (
            <button
              key={String(o.v)}
              type="button"
              onClick={() => setShowResolved(o.v)}
              aria-pressed={showResolved === o.v}
              className={cn(
                "rounded-md px-3 py-1 font-medium transition-colors",
                showResolved === o.v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <AttendanceReports />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-6 py-12 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium text-foreground">
            {showResolved ? "Nenhum alerta resolvido ainda." : "Nada pedindo atenção agora."}
          </p>
          {!showResolved && (
            <p className="mt-1 text-xs text-muted-foreground">
              Clique em &quot;Analisar agora&quot; para atualizar o radar com as conversas mais recentes.
            </p>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((item) => (
            <InsightCard key={item.id} item={item} onResolve={resolve} />
          ))}
        </ul>
      )}
    </div>
  );
}

function InsightCard({
  item,
  onResolve,
}: {
  item: RadarInsight;
  onResolve: (id: string) => void;
}) {
  const kind = KIND_META[item.kind];
  const sev = SEVERITY_META[item.severity];
  const Icon = kind.icon;
  const contact = item.conversation?.contact ?? null;
  const name = contact?.name || contact?.phone || "Contato";
  const resolved = Boolean(item.resolved_at);

  return (
    <li>
      <div
        className={cn(
          "flex flex-wrap items-start gap-3 rounded-xl border border-l-4 border-border bg-card p-4",
          sev.border,
          resolved && "opacity-70",
        )}
      >
        <ContactAvatar
          name={name}
          url={contact?.avatar_url}
          isGroup={Boolean(contact?.is_group)}
          className="h-10 w-10"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("flex h-6 w-6 items-center justify-center rounded-md", kind.tone)}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {kind.label}
            </span>
            <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", sev.badge)}>
              {sev.label}
            </span>
          </div>
          {item.description && <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>}
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {resolved
              ? `Resolvido ${ago(item.resolved_at!)}`
              : item.evidence?.waiting_since
                ? `Aguardando resposta ${ago(item.evidence.waiting_since)}`
                : `Detectado ${ago(item.created_at)}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {item.conversation && (
            <Link
              href={`/inbox?c=${item.conversation.id}`}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[0.8rem] font-medium text-foreground hover:bg-muted"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Abrir conversa
            </Link>
          )}
          {!resolved && (
            <Button variant="ghost" size="sm" onClick={() => onResolve(item.id)} title="Marcar como resolvido">
              <CheckCircle2 />
              Resolver
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}
