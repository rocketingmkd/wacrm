import { afterEach, describe, expect, it } from 'vitest'
import {
  CSAT_MAX_COMMENT,
  csatLink,
  csatMessageText,
  isValidScore,
  resolvePublicOrigin,
} from './csat'

const req = (headers: Record<string, string> = {}, url = 'http://internal:3000/api/csat/send') =>
  new Request(url, { headers })

describe('csat helpers', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL
  })

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

  it('prefers the configured site URL and trims trailing slashes', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://rocket-crm.autosolution.pro/'
    expect(resolvePublicOrigin(req({ host: 'internal:3000' }))).toBe('https://rocket-crm.autosolution.pro')
  })

  it('falls back to the proxy headers, then to the request origin', () => {
    expect(
      resolvePublicOrigin(req({ 'x-forwarded-host': 'crm.test', 'x-forwarded-proto': 'https' })),
    ).toBe('https://crm.test')
    expect(resolvePublicOrigin(req({}, 'http://localhost:3000/x'))).toMatch(/^https?:\/\//)
  })

  it('caps comments at a sane size', () => {
    expect(CSAT_MAX_COMMENT).toBeGreaterThanOrEqual(500)
    expect(CSAT_MAX_COMMENT).toBeLessThanOrEqual(5000)
  })
})
