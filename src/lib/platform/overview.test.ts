import { describe, expect, it } from 'vitest'
import {
  countSince,
  monthlyGrowth,
  planPrice,
  startOfMonthUtc,
  summarizeSubscriptions,
} from './overview'

describe('planPrice', () => {
  it('knows the two plans and ignores anything else', () => {
    expect(planPrice('starter')).toBe(97)
    expect(planPrice('pro')).toBe(197)
    expect(planPrice('business')).toBe(0)
    expect(planPrice(null)).toBe(0)
  })
})

describe('summarizeSubscriptions', () => {
  it('counts each status and sums MRR only from active plans', () => {
    const s = summarizeSubscriptions([
      { status: 'active', plan: 'pro' },
      { status: 'active', plan: 'starter' },
      { status: 'active', plan: null }, // active without a known plan: counted, no revenue
      { status: 'trialing', plan: 'pro' }, // trial never counts as revenue
      { status: 'past_due', plan: 'pro' },
      { status: 'expired', plan: null },
      { status: 'canceled', plan: 'starter' },
      { status: null, plan: null },
    ])
    expect(s).toEqual({
      mrr: 97 + 197,
      active: 3,
      trialing: 1,
      pastDue: 1,
      expired: 1,
      canceled: 1,
    })
  })

  it('is all zeros for no rows', () => {
    expect(summarizeSubscriptions([])).toEqual({
      mrr: 0,
      active: 0,
      trialing: 0,
      pastDue: 0,
      expired: 0,
      canceled: 0,
    })
  })
})

describe('monthlyGrowth', () => {
  const now = new Date('2026-10-28T12:00:00Z')

  it('returns 12 cumulative points ending in the current month', () => {
    const g = monthlyGrowth(
      ['2026-10-02T10:00:00Z', '2026-10-20T10:00:00Z', '2026-08-15T00:00:00Z', '2025-01-01T00:00:00Z'],
      now,
    )
    expect(g).toHaveLength(12)
    expect(g[0].key).toBe('2025-11')
    expect(g[11].key).toBe('2026-10')
    // the 2025-01 account already existed 12 months ago
    expect(g[0].total).toBe(1)
    expect(g.find((p) => p.key === '2026-07')!.total).toBe(1)
    expect(g.find((p) => p.key === '2026-08')!.total).toBe(2)
    expect(g[11].total).toBe(4)
  })

  it('is non-decreasing and ignores bad dates', () => {
    const g = monthlyGrowth(['2026-09-10T00:00:00Z', null, undefined, 'not a date'], now)
    for (let i = 1; i < g.length; i++) expect(g[i].total).toBeGreaterThanOrEqual(g[i - 1].total)
    expect(g[11].total).toBe(1)
  })

  it('labels months in pt-BR without the trailing dot', () => {
    const g = monthlyGrowth([], now)
    expect(g[11].month).toBe('out')
    expect(g.every((p) => !p.month.includes('.'))).toBe(true)
  })
})

describe('countSince / startOfMonthUtc', () => {
  it('counts only dates on or after the boundary', () => {
    const now = new Date('2026-10-28T12:00:00Z')
    const start = startOfMonthUtc(now)
    expect(start.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(
      countSince(['2026-10-01T00:00:00Z', '2026-09-30T23:59:59Z', '2026-10-27T00:00:00Z', null], start),
    ).toBe(2)
  })
})
