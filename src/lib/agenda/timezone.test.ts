import { describe, it, expect } from 'vitest'
import {
  zonedWallTimeToUtc,
  formatWallTimeToken,
  zonedDateString,
  formatSlotLabelPtBr,
} from './timezone'

const TZ = 'America/Sao_Paulo' // UTC-3, no DST since 2019

describe('zonedWallTimeToUtc', () => {
  it('converts a Sao Paulo wall-clock time to the correct UTC instant', () => {
    const utc = zonedWallTimeToUtc('2026-09-10', '14:00', TZ)
    expect(utc.toISOString()).toBe('2026-09-10T17:00:00.000Z')
  })

  it('round-trips through formatWallTimeToken', () => {
    const utc = zonedWallTimeToUtc('2026-09-10', '14:00', TZ)
    expect(formatWallTimeToken(utc, TZ)).toBe('2026-09-10T14:00')
  })
})

describe('zonedDateString', () => {
  it('returns the Sao Paulo calendar date, not the UTC one', () => {
    // 02:00 UTC on the 10th is still 23:00 on the 9th in Sao Paulo.
    const date = new Date('2026-09-10T02:00:00.000Z')
    expect(zonedDateString(date, TZ)).toBe('2026-09-09')
  })

  it('agrees with the UTC date well inside the day', () => {
    const date = new Date('2026-09-10T17:00:00.000Z')
    expect(zonedDateString(date, TZ)).toBe('2026-09-10')
  })
})

describe('formatSlotLabelPtBr', () => {
  it('formats a pt-BR weekday + date + time label', () => {
    const date = new Date('2026-09-10T17:00:00.000Z') // 14:00 in Sao Paulo
    expect(formatSlotLabelPtBr(date, TZ)).toBe('quinta-feira, 10/09 às 14:00')
  })
})
