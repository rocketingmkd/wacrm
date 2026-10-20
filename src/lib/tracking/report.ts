import type { AttributionSource } from './attribution'

/** Shape returned by the SQL function attribution_report (migration 068). */
export interface AttributionReport {
  totals: { leads: number; deals: number; won: number; won_value: number }
  untracked: number
  by_source: {
    source: AttributionSource
    leads: number
    deals: number
    won: number
    won_value: number
  }[]
  by_campaign: {
    source: AttributionSource
    campaign: string
    leads: number
    deals: number
    won: number
    won_value: number
  }[]
  per_day: { day: string; source: AttributionSource; leads: number }[]
  recent: {
    first_seen_at: string
    source: AttributionSource
    campaign: string
    contact_id: string
    contact_name: string
    won: number
    won_value: number
  }[]
}

export const SOURCE_ORDER: AttributionSource[] = ['meta_ctwa', 'meta_site', 'google', 'other']

export const SOURCE_COLORS: Record<AttributionSource, string> = {
  meta_ctwa: '#1877f2',
  meta_site: '#7aa7f7',
  google: '#f5a623',
  other: '#94a3b8',
}

export type DayRow = { day: string } & Record<AttributionSource, number>

/**
 * One row per local day in [from, to), with the leads of each source, so
 * the chart shows empty days instead of skipping them.
 */
export function buildDaySeries(
  perDay: AttributionReport['per_day'],
  from: Date,
  to: Date,
): DayRow[] {
  const byDay = new Map<string, DayRow>()
  const cursor = new Date(from)
  cursor.setHours(0, 0, 0, 0)
  const limit = new Date(to)
  while (cursor < limit && byDay.size < 370) {
    const key = [
      cursor.getFullYear(),
      String(cursor.getMonth() + 1).padStart(2, '0'),
      String(cursor.getDate()).padStart(2, '0'),
    ].join('-')
    byDay.set(key, { day: key, meta_ctwa: 0, meta_site: 0, google: 0, other: 0 })
    cursor.setDate(cursor.getDate() + 1)
  }
  for (const row of perDay) {
    const target = byDay.get(row.day)
    if (target) target[row.source] += Number(row.leads)
  }
  return Array.from(byDay.values())
}

/** CSV of the campaign table, semicolon separated for Brazilian Excel. */
export function buildAttributionCsv(report: AttributionReport, labels: Record<AttributionSource, string>): string {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = [
    ['Origem', 'Campanha', 'Leads', 'Negócios', 'Ganhos', 'Receita'],
    ...report.by_campaign.map((c) => [
      labels[c.source] ?? c.source,
      c.campaign,
      c.leads,
      c.deals,
      c.won,
      Number(c.won_value).toFixed(2).replace('.', ','),
    ]),
  ]
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\n')
}
