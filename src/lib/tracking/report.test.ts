import { describe, expect, it } from 'vitest'
import { SOURCE_LABELS } from './attribution'
import { attachConversationIds, buildAttributionCsv, buildDaySeries, type AttributionReport } from './report'

describe('buildDaySeries', () => {
  it('fills empty days and sums leads per source', () => {
    const from = new Date(2026, 9, 18)
    const to = new Date(2026, 9, 21)
    const rows = buildDaySeries(
      [
        { day: '2026-10-18', source: 'google', leads: 2 },
        { day: '2026-10-20', source: 'meta_ctwa', leads: 3 },
        { day: '2026-10-20', source: 'google', leads: 1 },
      ],
      from,
      to,
    )
    expect(rows.map((r) => r.day)).toEqual(['2026-10-18', '2026-10-19', '2026-10-20'])
    expect(rows[0].google).toBe(2)
    expect(rows[1]).toMatchObject({ meta_ctwa: 0, google: 0 })
    expect(rows[2]).toMatchObject({ meta_ctwa: 3, google: 1 })
  })

  it('ignores rows outside the range', () => {
    const rows = buildDaySeries(
      [{ day: '2026-01-01', source: 'other', leads: 9 }],
      new Date(2026, 9, 18),
      new Date(2026, 9, 19),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].other).toBe(0)
  })
})

describe('buildAttributionCsv', () => {
  it('writes a header, escapes separators and uses a decimal comma', () => {
    const report = {
      by_campaign: [
        { source: 'google', campaign: 'Black; "2026"', leads: 4, deals: 2, won: 1, won_value: 1890.5 },
      ],
    } as unknown as AttributionReport
    const csv = buildAttributionCsv(report, SOURCE_LABELS)
    const lines = csv.replace('﻿', '').split('\n')
    expect(lines[0]).toBe('Origem;Campanha;Leads;Negócios;Ganhos;Receita')
    expect(lines[1]).toBe('Google Ads;"Black; ""2026""";4;2;1;1890,50')
  })
})

describe('attachConversationIds', () => {
  it('anexa a conversa mais recente de cada contato e null quando não há', () => {
    const out = attachConversationIds(
      [{ contact_id: 'a' }, { contact_id: 'b' }, { contact_id: 'c' }],
      [
        { id: 'a-antiga', contact_id: 'a', last_message_at: '2026-10-01T10:00:00Z' },
        { id: 'a-nova', contact_id: 'a', last_message_at: '2026-10-05T10:00:00Z' },
        { id: 'b-sem-data', contact_id: 'b', last_message_at: null },
      ],
    )
    expect(out.map((r) => r.conversation_id)).toEqual(['a-nova', 'b-sem-data', null])
  })
})
