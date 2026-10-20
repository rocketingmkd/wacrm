"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Clock, DollarSign, Download, Loader2, MessageCircle, Star, Trophy } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { hasMinRole } from "@/lib/auth/roles";
import { formatCurrency } from "@/lib/currency";
import {
  buildReportCsv,
  fillDays,
  formatDuration,
  percent,
  rangeFor,
  type ReportOverview,
  type ReportPeriod,
} from "@/lib/reports";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/dashboard/metric-card";

const PERIODS: { value: ReportPeriod; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "custom", label: "Personalizado" },
];

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--foreground)",
  fontSize: 12,
};

function Panel({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]",
        className,
      )}
    >
      <h3 className="font-display text-[16px] font-bold">{title}</h3>
      {subtitle && <p className="mb-3 text-xs text-muted-foreground">{subtitle}</p>}
      {children}
    </section>
  );
}

export default function ReportsPage() {
  const { accountRole, defaultCurrency } = useAuth();
  const isAdmin = accountRole ? hasMinRole(accountRole, "admin") : false;

  const [period, setPeriod] = useState<ReportPeriod>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  // The request is identified by a key (range + retry counter). The latest
  // answer is kept until the next one arrives, so the page dims instead of
  // flashing empty while a new period loads. `loading` is derived.
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data: ReportOverview | null;
    error: string | null;
  } | null>(null);

  const range = useMemo(
    () => rangeFor(period, customFrom, customTo),
    [period, customFrom, customTo],
  );
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();
  const key = `${fromIso}|${toIso}|${retry}`;

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const qs = new URLSearchParams({ from: fromIso, to: toIso, tz });
    fetch(`/api/reports/overview?${qs.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setResult((prev) => ({
            key,
            data: prev?.data ?? null,
            error: body?.error ?? "Não foi possível carregar o relatório.",
          }));
          return;
        }
        setResult({ key, data: body as ReportOverview, error: null });
      })
      .catch(() => {
        if (cancelled) return;
        setResult((prev) => ({
          key,
          data: prev?.data ?? null,
          error: "Falha de conexão ao carregar o relatório.",
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, fromIso, toIso, key]);

  const data = result?.data ?? null;
  const loading = isAdmin && result?.key !== key;
  const error = result?.key === key ? result.error : null;

  const days = useMemo(
    () => (data ? fillDays(data.per_day, range.from, range.to) : []),
    [data, range.from, range.to],
  );
  const stageData = useMemo(
    () => (data?.stages ?? []).filter((s) => s.deals > 0),
    [data],
  );
  const activeAgents = useMemo(
    () => (data?.agents ?? []).filter((a) => a.conversations + a.replies + a.won > 0),
    [data],
  );

  function exportCsv() {
    if (!data) return;
    const csv = buildReportCsv(data, range.from, range.to);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio_${fromIso.slice(0, 10)}_${toIso.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (accountRole && !isAdmin) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Os relatórios estão disponíveis para administradores da conta.
      </div>
    );
  }

  const lastDay = new Date(range.to.getTime() - 86_400_000);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">Relatórios</h1>
          <p className="text-sm text-muted-foreground">
            {range.from.toLocaleDateString("pt-BR")} a {lastDay.toLocaleDateString("pt-BR")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full border border-border bg-card p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPeriod(p.value)}
                aria-pressed={period === p.value}
                className={cn(
                  "h-8 rounded-full px-3 text-xs font-medium transition-colors",
                  period === p.value
                    ? "bg-primary-soft text-primary shadow-[inset_0_0_0_1px_var(--primary-soft-2)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {period === "custom" && (
            <div className="flex items-center gap-1.5 text-sm">
              <input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-label="Data inicial"
                className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              />
              <span className="text-muted-foreground">a</span>
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-label="Data final"
                className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              />
            </div>
          )}
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!data || loading}>
            <Download className="size-4" />
            Exportar CSV
          </Button>
        </div>
      </header>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => setRetry((n) => n + 1)}>
            Tentar de novo
          </Button>
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : data ? (
        <div className={cn("space-y-6 transition-opacity", loading && "opacity-60")}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              title="Mensagens"
              icon={MessageCircle}
              value={data.totals.total.toLocaleString("pt-BR")}
              subtitle={`${data.totals.inbound} recebidas, ${data.totals.outbound} enviadas, ${data.totals.ai_messages} pela IA`}
            />
            <MetricCard
              title="Tempo de resposta"
              icon={Clock}
              value={formatDuration(data.response.human_avg_secs ?? data.response.avg_secs)}
              subtitle={
                data.response.human_samples > 0
                  ? `Equipe humana. Geral, com IA: ${formatDuration(data.response.avg_secs)}`
                  : data.response.samples > 0
                    ? "Todas as respostas, com IA"
                    : "Sem respostas no período"
              }
            />
            <MetricCard
              title="Negócios ganhos"
              icon={Trophy}
              value={String(data.deals.won)}
              subtitle={`${data.deals.created} criados, ${data.deals.lost} perdidos (${percent(data.deals.won, data.deals.created)}% de conversão)`}
            />
            <MetricCard
              title="Receita"
              icon={DollarSign}
              value={formatCurrency(data.deals.won_value, defaultCurrency)}
              subtitle={`${formatCurrency(data.deals.open_value, defaultCurrency)} em aberto agora`}
            />
            <MetricCard
              title="Avaliação dos clientes"
              icon={Star}
              value={data.csat.avg_score == null ? "—" : `${Number(data.csat.avg_score).toFixed(1)} / 5`}
              subtitle={
                data.csat.sent
                  ? `${data.csat.answered} de ${data.csat.sent} respondidas (${percent(data.csat.answered, data.csat.sent)}%)`
                  : "Nenhuma avaliação enviada"
              }
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
            <Panel title="Mensagens por dia" subtitle="Recebidas dos clientes e enviadas pela equipe e pela IA">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={days} margin={{ left: -16, right: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    stroke="var(--muted-foreground)"
                  />
                  <YAxis fontSize={11} allowDecimals={false} tickLine={false} axisLine={false} stroke="var(--muted-foreground)" />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="inbound" name="Recebidas" stackId="m" fill="var(--primary)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="outbound" name="Enviadas" stackId="m" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Negócios abertos por etapa" subtitle="Funis de vendas, agora">
              {stageData.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Nenhum negócio aberto.</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={190}>
                    <PieChart>
                      <Pie
                        data={stageData}
                        dataKey="deals"
                        nameKey="name"
                        innerRadius={50}
                        outerRadius={82}
                        paddingAngle={2}
                        stroke="var(--card)"
                        strokeWidth={2}
                      >
                        {stageData.map((s) => (
                          <Cell key={s.id} fill={s.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {stageData.map((s) => (
                      <li key={s.id} className="flex items-center gap-2">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                        <span className="min-w-0 flex-1 truncate">{s.name}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {s.deals} · {formatCurrency(s.value, defaultCurrency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Panel>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
            <Panel title="Desempenho por atendente" subtitle="Conversas atribuídas com atividade no período">
              {activeAgents.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nenhuma conversa atribuída a um atendente no período.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Atendente</th>
                        <th className="px-3 py-2 text-right font-medium">Conversas</th>
                        <th className="px-3 py-2 text-right font-medium">Recebidas</th>
                        <th className="px-3 py-2 text-right font-medium">Respostas</th>
                        <th className="px-3 py-2 text-right font-medium">Ganhos</th>
                        <th className="py-2 pl-3 text-right font-medium">Receita</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeAgents.map((a) => (
                        <tr key={a.user_id} className="border-b border-border/60 last:border-0">
                          <td className="py-2.5 pr-3 font-medium">{a.name || "Sem nome"}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{a.conversations}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{a.inbound}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{a.replies}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{a.won}</td>
                          <td className="py-2.5 pl-3 text-right tabular-nums">
                            {formatCurrency(a.won_value, defaultCurrency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel title="Notas das avaliações" subtitle="Distribuição das respostas no período">
              {data.csat.answered === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Ainda sem respostas. Use o botão de avaliação no chat.
                </p>
              ) : (
                <ul className="space-y-2">
                  {([5, 4, 3, 2, 1] as const).map((n) => {
                    const count = data.csat[`s${n}` as "s1"] ?? 0;
                    const pct = percent(count, data.csat.answered);
                    return (
                      <li key={n} className="flex items-center gap-2 text-sm">
                        <span className="flex w-10 shrink-0 items-center gap-0.5 tabular-nums">
                          {n}
                          <Star className="size-3.5 fill-primary text-primary" />
                        </span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                          <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                        </span>
                        <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">
                          {count} ({pct}%)
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      ) : null}
    </div>
  );
}
