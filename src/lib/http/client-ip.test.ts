import { describe, expect, it } from 'vitest'

import { getClientIp } from './client-ip'

function requestWith(headers: Record<string, string>): Request {
  return new Request('http://localhost/x', { headers })
}

describe('getClientIp', () => {
  it('takes the leftmost x-forwarded-for entry', () => {
    expect(
      getClientIp(requestWith({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' })),
    ).toBe('203.0.113.7')
  })

  it('trims whitespace around the entry', () => {
    expect(getClientIp(requestWith({ 'x-forwarded-for': '  198.51.100.4  ' }))).toBe('198.51.100.4')
  })

  it('prefers x-forwarded-for over x-real-ip', () => {
    expect(
      getClientIp(requestWith({ 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '198.51.100.9' })),
    ).toBe('203.0.113.7')
  })

  it('falls back to x-real-ip when there is no x-forwarded-for', () => {
    expect(getClientIp(requestWith({ 'x-real-ip': ' 198.51.100.9 ' }))).toBe('198.51.100.9')
  })

  it("returns 'unknown' when no proxy header is present", () => {
    expect(getClientIp(requestWith({}))).toBe('unknown')
  })
})
