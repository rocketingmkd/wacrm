// ============================================================
// Relatórios: shared types and pure helpers (period ranges, number
// formatting, CSV export). The aggregates come from the SQL function
// `report_overview` (migration 067); nothing here touches the DB.
// ============================================================

export type ReportPeriod = 'today' | '7d' | '30d' | 'custom';

export interface ReportOverview {
  totals: { total: number; inbound: number; outbound: number; ai_messages: number };
  per_day: { day: string; inbound: number; outbound: number }[];
  response: {
    samples: number;
    avg_secs: number | null;
    median_secs: number | null;
    human_samples: number;
    human_avg_secs: number | null;
    human_median_secs: number | null;
  };
  deals: {
    created: number;
    won: number;
    won_value: number;
    lost: number;
    open_now: number;
    open_value: number;
  };
  stages: {
    id: string;
    name: string;
    color: string;
    position: number;
    pipeline: string;
    deals: number;
    value: number;
  }[];
  csat: {
    sent: number;
    answered: number;
    avg_score: number | null;
    s1: number;
    s2: number;
    s3: number;
    s4: number;
    s5: number;
  };
  agents: {
    user_id: string;
    name: string | null;
    conversations: number;
    inbound: number;
    replies: number;
    won: number;
    won_value: number;
  }[];
}

export const MAX_RANGE_DAYS = 366;

/** Start (inclusive) and end (exclusive) of a period, in the browser's local time. */
export function rangeFor(
  period: ReportPeriod,
  customFrom?: string,
  customTo?: string,
  now: Date = new Date(),
): { from: Date; to: Date } {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const tomorrow = new Date(startOfToday.getTime() + 86_400_000);

  if (period === 'today') return { from: startOfToday, to: tomorrow };
  if (period === '7d') return { from: new Date(tomorrow.getTime() - 7 * 86_400_000), to: tomorrow };
  if (period === '30d') return { from: new Date(tomorrow.getTime() - 30 * 86_400_000), to: tomorrow };

  // custom: inputs are yyyy-mm-dd; the end day is included.
  const from = customFrom ? new Date(`${customFrom}T00:00:00`) : new Date(tomorrow.getTime() - 7 * 86_400_000);
  const endDay = customTo ? new Date(`${customTo}T00:00:00`) : startOfToday;
  const to = new Date(endDay.getTime() + 86_400_000);
  return { from, to };
}

/** Validate a range the API receives. Returns an error message or null. */
export function validateRange(from: Date, to: Date): string | null {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 'Datas inválidas.';
  if (to <= from) return 'A data final precisa ser depois da inicial.';
  if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
    return `O período máximo é de ${MAX_RANGE_DAYS} dias.`;
  }
  return null;
}

/** "45 s", "3 min 20 s", "2 h 05 min". Null or non-finite → "—". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const rest = s % 60;
    return rest ? `${m} min ${rest} s` : `${m} min`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

export function percent(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

/** Fills the days with no activity so the chart has a continuous axis. */
export function fillDays(
  perDay: ReportOverview['per_day'],
  from: Date,
  to: Date,
): { day: string; label: string; inbound: number; outbound: number }[] {
  const byDay = new Map(perDay.map((d) => [d.day, d]));
  const out: { day: string; label: string; inbound: number; outbound: number }[] = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  // Cap at one point per day for at most a year, as the API does.
  for (let i = 0; i < MAX_RANGE_DAYS && cursor < to; i++) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    const row = byDay.get(key);
    out.push({
      day: key,
      label: `${String(cursor.getDate()).padStart(2, '0')}/${String(cursor.getMonth() + 1).padStart(2, '0')}`,
      inbound: row?.inbound ?? 0,
      outbound: row?.outbound ?? 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  // Prevent spreadsheet formula injection from user-controlled names.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Semicolon separated (pt-BR Excel), UTF-8 with BOM so accents survive. */
export function buildReportCsv(data: ReportOverview, from: Date, to: Date): string {
  const day = (d: Date) => d.toLocaleDateString('pt-BR');
  const lastDay = new Date(to.getTime() - 86_400_000);
  const rows: (string | number | null)[][] = [
    ['Relatório', `${day(from)} a ${day(lastDay)}`],
    [],
    ['Métrica', 'Valor'],
    ['Mensagens', data.totals.total],
    ['Recebidas', data.totals.inbound],
    ['Enviadas', data.totals.outbound],
    ['Geradas pela IA', data.totals.ai_messages],
    ['Tempo médio de resposta (s)', data.response.avg_secs == null ? '' : Math.round(data.response.avg_secs)],
    ['Tempo médio de resposta humana (s)', data.response.human_avg_secs == null ? '' : Math.round(data.response.human_avg_secs)],
    ['Negócios criados', data.deals.created],
    ['Negócios ganhos', data.deals.won],
    ['Receita dos ganhos', data.deals.won_value],
    ['Negócios perdidos', data.deals.lost],
    ['Avaliações enviadas', data.csat.sent],
    ['Avaliações respondidas', data.csat.answered],
    ['Nota média', data.csat.avg_score == null ? '' : Number(data.csat.avg_score).toFixed(2)],
    [],
    ['Mensagens por dia', 'Recebidas', 'Enviadas'],
    ...data.per_day.map((d) => [d.day, d.inbound, d.outbound]),
    [],
    ['Funil', 'Etapa', 'Negócios abertos', 'Valor'],
    ...data.stages.map((s) => [s.pipeline, s.name, s.deals, s.value]),
    [],
    ['Atendente', 'Conversas', 'Recebidas', 'Respostas', 'Ganhos', 'Receita'],
    ...data.agents.map((a) => [a.name ?? '', a.conversations, a.inbound, a.replies, a.won, a.won_value]),
  ];
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
}
