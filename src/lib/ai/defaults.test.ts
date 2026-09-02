import { describe, it, expect } from 'vitest'
import { normalizeReplyCap, MAX_REPLY_CAP } from './defaults'

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
