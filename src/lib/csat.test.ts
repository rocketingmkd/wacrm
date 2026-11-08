import { describe, expect, it } from 'vitest'
import {
  CSAT_MAX_COMMENT,
  csatLink,
  csatMessageText,
  isValidScore,
} from './csat'

describe('csat helpers', () => {
  it.each([1, 2, 3, 4, 5])('accepts score %s', (n) => {
    expect(isValidScore(n)).toBe(true)
  })

  it.each([0, 6, -1, 3.5, '4', null, undefined, NaN])('rejects score %j', (n) => {
    expect(isValidScore(n)).toBe(false)
  })

  it('builds the public link and the message text', () => {
    const link = csatLink('https://crm.example.com', 'abc123')
    expect(link).toBe('https://crm.example.com/csat/abc123')
    expect(csatMessageText(link)).toContain(link)
    expect(csatMessageText(link)).toMatch(/atendimento/)
  })

  it('caps comments at a sane size', () => {
    expect(CSAT_MAX_COMMENT).toBeGreaterThanOrEqual(500)
    expect(CSAT_MAX_COMMENT).toBeLessThanOrEqual(5000)
  })
})
