"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Check,
  Code2,
  Copy,
  DollarSign,
  Download,
  Loader2,
  Megaphone,
  Send,
  Trophy,
  UserPlus,
  UserX,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { hasMinRole } from "@/lib/auth/roles";
import { formatCurrency } from "@/lib/currency";
import { percent, rangeFor, type ReportPeriod } from "@/lib/reports";
import { SOURCE_LABELS } from "@/lib/tracking/attribution";
import {
  buildAttributionCsv,
  buildDaySeries,
  SOURCE_COLORS,
  SOURCE_ORDER,
  type AttributionReport,
} from "@/lib/tracking/report";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ConversionsPanel } from "@/components/tracking/conversions-panel";

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

function SourceChip({ source }: { source: keyof typeof SOURCE_LABELS }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium">
      <span
        className="size-2.5 rounded-full"
        style={{ background: SOURCE_COLORS[source] }}
        aria-hidden
      />
      {SOURCE_LABELS[source] ?? source}
    </span>
  );
}

function InstallPanel() {
  const [data, setData] = useState<{ snippet: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/tracking/settings", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setError(body?.error ?? "Não foi possível carregar o código.");
        else setData(body);
      })
      .catch(() => {
        if (!cancelled) setError("Falha de conexão.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function copy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the code stays selectable on screen */
    }
  }

  return (
    <div className="min-w-0 space-y-5 text-sm break-words">
      <div>
        <h4 className="font-semibold">1. Anúncios que abrem o WhatsApp (Meta)</h4>
        <p className="mt-1 text-muted-foreground">
          Não precisa instalar nada. Quando alguém clica no anúncio e manda a primeira mensagem, a
          Meta informa o anúncio de origem e o CRM registra sozinho.
        </p>
      </div>

      <div>
        <h4 className="font-semibold">2. Anúncios que levam a uma página (Meta e Google)</h4>
        <p className="mt-1 text-muted-foreground">
          Cole este código no <code className="rounded bg-muted px-1">&lt;head&gt;</code> da sua
          página. Ele guarda de onde o visitante veio e, ao clicar no botão do WhatsApp, inclui um
          código curto no fim da mensagem.
        </p>
        {error ? (
          <p className="mt-2 text-destructive">{error}</p>
        ) : !data ? (
          <div className="mt-2 flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Gerando o código...
          </div>
        ) : (
          <div className="mt-2 flex min-w-0 flex-wrap items-start gap-2 sm:flex-nowrap">
            <pre className="min-w-0 flex-1 basis-full whitespace-pre-wrap break-all rounded-xl border border-border bg-muted/50 p-3 text-xs sm:basis-0">
              {data.snippet}
            </pre>
            <Button variant="outline" size="sm" onClick={copy} className="shrink-0">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
        )}
      </div>

      <div>
        <h4 className="font-semibold">3. Parâmetros nos links dos anúncios</h4>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            <strong className="text-foreground">Google Ads:</strong> deixe a marcação automática
            ligada (gclid) e, no modelo de rastreamento da conta, use{" "}
            <code className="break-all rounded bg-muted px-1">
              {"{lpurl}?utm_source=google&utm_medium=cpc&utm_campaign={campaignid}"}
            </code>
            .
          </li>
          <li>
            <strong className="text-foreground">Meta Ads:</strong> no campo Parâmetros de URL do
            anúncio, use{" "}
            <code className="break-all rounded bg-muted px-1">
              {"utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}"}
            </code>
            .
          </li>
        </ul>
      </div>

      <p className="text-xs text-muted-foreground">
        O script usa o armazenamento do navegador do visitante, só nos botões de WhatsApp, e só
        age em quem chegou por um link com campanha. Se a sua página tem aviso de cookies, inclua
        o script na categoria de marketing.
      </p>
    </div>
  );
}

export default function TrafficPage() {
  const { accountRole, defaultCurrency } = useAuth();
  const isAdmin = accountRole ? hasMinRole(accountRole, "admin") : false;

  const [period, setPeriod] = useState<ReportPeriod>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [showInstall, setShowInstall] = useState(false);
  const [showConversions, setShowConversions] = useState(false);

  // Coming back from the Google authorization: open the panel that says how it went.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("google")) return;
    const t = setTimeout(() => setShowConversions(true), 0);
    return () => clearTimeout(t);
  }, []);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data: AttributionReport | null;
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
    fetch(`/api/reports/attribution?${qs.toString()}`, { cache: "no-store" })
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
        setResult({ key, data: body as AttributionReport, error: null });
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
    () => (data ? buildDaySeries(data.per_day, range.from, range.to) : []),
    [data, range.from, range.to],
  );
  const usedSources = useMemo(
    () => SOURCE_ORDER.filter((s) => data?.by_source.some((r) => r.source === s)),
    [data],
  );

  function exportCsv() {
    if (!data) return;
    const csv = buildAttributionCsv(data, SOURCE_LABELS);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `origem-trafego_${fromIso.slice(0, 10)}_${toIso.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (accountRole && !isAdmin) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        A origem do tráfego está disponível para administradores da conta.
      </div>
    );
  }

  const lastDay = new Date(range.to.getTime() - 86_400_000);
  const empty = data !== null && data.totals.leads === 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">Origem do tráfego</h1>
          <p className="text-sm text-muted-foreground">
            De quais anúncios vêm os seus contatos. {range.from.toLocaleDateString("pt-BR")} a{" "}
            {lastDay.toLocaleDateString("pt-BR")}
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
          <Button variant="outline" size="sm" onClick={() => setShowInstall(true)}>
            <Code2 className="size-4" />
            Como rastrear
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowConversions(true)}>
            <Send className="size-4" />
            Enviar conversões
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!data || loading}>
            <Download className="size-4" />
            Exportar CSV
          </Button>
        </div>
      </header>

      <Dialog open={showInstall} onOpenChange={setShowInstall}>
        <DialogContent className="max-h-[85vh] overflow-y-auto overflow-x-hidden border-border bg-popover sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-[16px] font-bold">Como rastrear os anúncios</DialogTitle>
            <DialogDescription>Configure uma vez; vale para todas as campanhas.</DialogDescription>
          </DialogHeader>
          {showInstall && <InstallPanel />}
        </DialogContent>
      </Dialog>

      <Dialog open={showConversions} onOpenChange={setShowConversions}>
        <DialogContent className="max-h-[85vh] overflow-y-auto overflow-x-hidden border-border bg-popover sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-[16px] font-bold">Enviar conversões para os anúncios</DialogTitle>
            <DialogDescription>Devolve à Meta e ao Google as vendas que vieram dos anúncios.</DialogDescription>
          </DialogHeader>
          {showConversions && <ConversionsPanel />}
        </DialogContent>
      </Dialog>

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
              title="Leads de anúncios"
              icon={Megaphone}
              value={data.totals.leads.toLocaleString("pt-BR")}
              subtitle="Contatos com origem identificada"
            />
            <MetricCard
              title="Sem origem"
              icon={UserX}
              value={data.untracked.toLocaleString("pt-BR")}
              subtitle="Contatos novos sem rastreio (orgânico ou direto)"
            />
            <MetricCard
              title="Negócios criados"
              icon={UserPlus}
              value={Number(data.totals.deals).toLocaleString("pt-BR")}
              subtitle={`${percent(Number(data.totals.deals), data.totals.leads)}% dos leads viraram negócio`}
            />
            <MetricCard
              title="Negócios ganhos"
              icon={Trophy}
              value={String(Number(data.totals.won))}
              subtitle={`${percent(Number(data.totals.won), data.totals.leads)}% dos leads compraram`}
            />
            <MetricCard
              title="Receita"
              icon={DollarSign}
              value={formatCurrency(Number(data.totals.won_value), defaultCurrency)}
              subtitle="De leads de anúncios"
            />
          </div>

          {empty ? (
            <Panel title="Ainda não há leads com origem neste período">
              <p className="text-sm text-muted-foreground">
                Assim que alguém mandar mensagem vindo de um anúncio, ele aparece aqui. Clique em
                “Como rastrear” para conferir se a sua página e os seus anúncios estão prontos.
              </p>
            </Panel>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                <Panel
                  title="Leads por dia"
                  subtitle="Separados pela origem"
                  className="xl:col-span-2"
                >
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={days}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis
                          dataKey="day"
                          tickFormatter={(d: string) => d.slice(8, 10) + "/" + d.slice(5, 7)}
                          tick={{ fontSize: 11 }}
                          minTickGap={16}
                        />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                        <Tooltip
                          contentStyle={tooltipStyle}
                          labelFormatter={(d) => String(d).split("-").reverse().join("/")}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        {usedSources.map((s) => (
                          <Bar
                            key={s}
                            dataKey={s}
                            name={SOURCE_LABELS[s]}
                            stackId="leads"
                            fill={SOURCE_COLORS[s]}
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Panel>

                <Panel title="Por origem" subtitle="Leads, vendas e receita">
                  <ul className="space-y-3">
                    {data.by_source.map((s) => (
                      <li key={s.source} className="rounded-xl border border-border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <SourceChip source={s.source} />
                          <span className="text-sm font-bold tabular-nums">{s.leads} leads</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {Number(s.won)} {Number(s.won) === 1 ? "venda" : "vendas"} (
                          {percent(Number(s.won), s.leads)}%) ·{" "}
                          {formatCurrency(Number(s.won_value), defaultCurrency)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </Panel>
              </div>

              <Panel title="Campanhas" subtitle="Ordenadas pelo número de leads">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Origem</th>
                        <th className="py-2 pr-3 font-medium">Campanha ou anúncio</th>
                        <th className="py-2 pr-3 text-right font-medium">Leads</th>
                        <th className="py-2 pr-3 text-right font-medium">Negócios</th>
                        <th className="py-2 pr-3 text-right font-medium">Vendas</th>
                        <th className="py-2 text-right font-medium">Receita</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_campaign.map((c) => (
                        <tr key={`${c.source}|${c.campaign}`} className="border-b border-border/60 last:border-0">
                          <td className="py-2 pr-3">
                            <SourceChip source={c.source} />
                          </td>
                          <td className="max-w-[280px] truncate py-2 pr-3" title={c.campaign}>
                            {c.campaign}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">{c.leads}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{Number(c.deals)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{Number(c.won)}</td>
                          <td className="py-2 text-right tabular-nums">
                            {formatCurrency(Number(c.won_value), defaultCurrency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel title="Últimos leads com origem">
                <ul className="divide-y divide-border/60">
                  {data.recent.map((r) => (
                    <li key={`${r.contact_id}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{r.contact_name}</p>
                        <p className="truncate text-xs text-muted-foreground">{r.campaign}</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <SourceChip source={r.source} />
                        <span className="text-xs text-muted-foreground">
                          {new Date(r.first_seen_at).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
