import { describe, expect, it } from 'vitest'
import {
  buildReportCsv,
  fillDays,
  formatDuration,
  percent,
  rangeFor,
  validateRange,
  type ReportOverview,
} from './reports'

const NOW = new Date(2026, 9, 20, 15, 30) // 20 Oct 2026, local time

describe('rangeFor', () => {
  it('today covers the local day', () => {
    const { from, to } = rangeFor('today', undefined, undefined, NOW)
    expect(from).toEqual(new Date(2026, 9, 20, 0, 0))
    expect(to).toEqual(new Date(2026, 9, 21, 0, 0))
  })

  it('7d and 30d end tomorrow 00:00 and start N days earlier', () => {
    const seven = rangeFor('7d', undefined, undefined, NOW)
    expect(seven.to).toEqual(new Date(2026, 9, 21))
    expect(Math.round((+seven.to - +seven.from) / 86_400_000)).toBe(7)
    const thirty = rangeFor('30d', undefined, undefined, NOW)
    expect(Math.round((+thirty.to - +thirty.from) / 86_400_000)).toBe(30)
  })

  it('custom includes the end day', () => {
    const { from, to } = rangeFor('custom', '2026-10-01', '2026-10-05', NOW)
    expect(from).toEqual(new Date(2026, 9, 1))
    expect(to).toEqual(new Date(2026, 9, 6))
  })
})

describe('validateRange', () => {
  it('accepts a normal range', () => {
    expect(validateRange(new Date(2026, 9, 1), new Date(2026, 9, 8))).toBeNull()
  })
  it('rejects inverted, invalid and oversized ranges', () => {
    expect(validateRange(new Date(2026, 9, 8), new Date(2026, 9, 1))).toMatch(/depois/)
    expect(validateRange(new Date('x'), new Date(2026, 9, 1))).toMatch(/inválidas/)
    expect(validateRange(new Date(2024, 0, 1), new Date(2026, 0, 1))).toMatch(/máximo/)
  })
})

describe('formatDuration', () => {
  it.each([
    [null, '—'],
    [undefined, '—'],
    [NaN, '—'],
    [0, '0 s'],
    [45.4, '45 s'],
    [60, '1 min'],
    [200, '3 min 20 s'],
    [7500, '2 h 05 min'],
  ])('%s -> %s', (input, expected) => {
    expect(formatDuration(input as number | null | undefined)).toBe(expected)
  })
})

describe('percent', () => {
  it('rounds and guards against division by zero', () => {
    expect(percent(1, 3)).toBe(33)
    expect(percent(5, 0)).toBe(0)
  })
})

describe('fillDays', () => {
  it('returns one point per day, zero filled, with dd/MM labels', () => {
    const rows = fillDays(
      [{ day: '2026-10-02', inbound: 4, outbound: 3 }],
      new Date(2026, 9, 1),
      new Date(2026, 9, 4),
    )
    expect(rows.map((r) => r.day)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(rows.map((r) => r.label)).toEqual(['01/10', '02/10', '03/10'])
    expect(rows[1]).toMatchObject({ inbound: 4, outbound: 3 })
    expect(rows[0]).toMatchObject({ inbound: 0, outbound: 0 })
  })
})

describe('buildReportCsv', () => {
  const data: ReportOverview = {
    totals: { total: 10, inbound: 6, outbound: 4, ai_messages: 2 },
    per_day: [{ day: '2026-10-02', inbound: 6, outbound: 4 }],
    response: { samples: 3, avg_secs: 120.4, median_secs: 90, human_samples: 1, human_avg_secs: 300, human_median_secs: 300 },
    deals: { created: 2, won: 1, won_value: 1500, lost: 0, open_now: 1, open_value: 800 },
    stages: [{ id: 's', name: 'Proposta', color: '#fff', position: 1, pipeline: 'Vendas', deals: 1, value: 800 }],
    csat: { sent: 4, answered: 2, avg_score: 4.5, s1: 0, s2: 0, s3: 0, s4: 1, s5: 1 },
    agents: [{ user_id: 'u', name: '=HYPERLINK("x")', conversations: 2, inbound: 6, replies: 4, won: 1, won_value: 1500 }],
  }

  it('starts with a BOM, uses semicolons and CRLF', () => {
    const csv = buildReportCsv(data, new Date(2026, 9, 1), new Date(2026, 9, 8))
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('Mensagens;10')
    expect(csv).toContain('\r\n')
    expect(csv).toContain('Tempo médio de resposta (s);120')
    expect(csv).toContain('Nota média;4.50')
  })

  it('neutralises spreadsheet formulas coming from user data', () => {
    const csv = buildReportCsv(data, new Date(2026, 9, 1), new Date(2026, 9, 8))
    expect(csv).not.toMatch(/;=HYPERLINK/)
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
  })
})
