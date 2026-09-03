import { describe, it, expect } from 'vitest'
import {
  normalizeReplyCap,
  MAX_REPLY_CAP,
  currentDateTimeLine,
  buildSystemPrompt,
} from './defaults'

describe('currentDateTimeLine', () => {
  const noon = new Date('2026-09-06T15:00:00Z') // 12:00 in America/Sao_Paulo (UTC-3)

  it('states the date/time in the given timezone and defines hoje/amanhã', () => {
    const line = currentDateTimeLine(noon, 'America/Sao_Paulo')
    expect(line).toContain('06/09/2026')
    expect(line).toContain('12:00')
    expect(line).toContain('America/Sao_Paulo')
    expect(line).toContain('"hoje"')
    expect(line).toContain('"amanhã"')
  })

  it('honours a different timezone', () => {
    expect(currentDateTimeLine(noon, 'UTC')).toContain('15:00')
  })
})

describe('buildSystemPrompt — current date', () => {
  it('injects the date line by default and omits it when now is null', () => {
    const withDate = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply' })
    expect(withDate).toContain('Data e hora atuais:')

    const withoutDate = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      now: null,
    })
    expect(withoutDate).not.toContain('Data e hora atuais:')
  })
})

describe('normalizeReplyCap', () => {
  it('treats null / undefined / empty string as "no limit"', () => {
    expect(normalizeReplyCap(null)).toBeNull()
    expect(normalizeReplyCap(undefined)).toBeNull()
    expect(normalizeReplyCap('')).toBeNull()
  })

  it('treats unparseable values as "no limit"', () => {
    expect(normalizeReplyCap('abc')).toBeNull()
    expect(normalizeReplyCap(NaN)).toBeNull()
    expect(normalizeReplyCap({})).toBeNull()
  })

  it('keeps a valid number, floored', () => {
    expect(normalizeReplyCap(3)).toBe(3)
    expect(normalizeReplyCap('10')).toBe(10)
    expect(normalizeReplyCap(4.9)).toBe(4)
  })

  it('clamps to [1, MAX_REPLY_CAP]', () => {
    expect(normalizeReplyCap(0)).toBe(1)
    expect(normalizeReplyCap(-5)).toBe(1)
    expect(normalizeReplyCap(9999)).toBe(MAX_REPLY_CAP)
  })
})
