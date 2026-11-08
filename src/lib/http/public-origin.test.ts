import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FALLBACK_PUBLIC_ORIGIN, resolvePublicOrigin } from './public-origin'

const req = (headers: Record<string, string> = {}, url = 'http://internal:3000/api/x') =>
  new Request(url, { headers })

describe('resolvePublicOrigin', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL
    delete process.env.ALLOWED_INVITE_HOSTS
  })

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL
    delete process.env.ALLOWED_INVITE_HOSTS
    vi.restoreAllMocks()
  })

  it('prefers the configured site URL and trims trailing slashes', () => {
    process.env.NEXT_PUBLIC_SITE_URL = ' https://rocket-crm.autosolution.pro// '
    expect(
      resolvePublicOrigin(req({ 'x-forwarded-host': 'other.test', host: 'internal:3000' })),
    ).toBe('https://rocket-crm.autosolution.pro')
  })

  it('uses the first forwarded host and proto when there is no configured URL', () => {
    expect(
      resolvePublicOrigin(
        req({ 'x-forwarded-host': 'crm.test, proxy.internal', 'x-forwarded-proto': 'https, http' }),
      ),
    ).toBe('https://crm.test')
  })

  it('assumes https for a forwarded host without a forwarded proto', () => {
    expect(resolvePublicOrigin(req({ 'x-forwarded-host': 'crm.test' }))).toBe('https://crm.test')
  })

  it('falls back to the request origin when no host header is present', () => {
    expect(resolvePublicOrigin(req({}, 'http://localhost:3000/x'))).toBe('http://localhost:3000')
  })

  describe('with ALLOWED_INVITE_HOSTS', () => {
    beforeEach(() => {
      process.env.ALLOWED_INVITE_HOSTS = 'crm.test, Staging.Test'
    })

    it('accepts a listed forwarded host, case-insensitively', () => {
      expect(resolvePublicOrigin(req({ 'x-forwarded-host': 'STAGING.test' }))).toBe(
        'https://STAGING.test',
      )
    })

    it('rejects an unlisted forwarded host and returns the fallback with a warning', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(resolvePublicOrigin(req({ 'x-forwarded-host': 'phishing.example' }))).toBe(
        FALLBACK_PUBLIC_ORIGIN,
      )
      expect(warn).toHaveBeenCalledOnce()
    })

    it('does not let the configured URL be overridden by headers', () => {
      process.env.NEXT_PUBLIC_SITE_URL = 'https://crm.test'
      expect(resolvePublicOrigin(req({ 'x-forwarded-host': 'phishing.example' }))).toBe(
        'https://crm.test',
      )
    })
  })

  it('exposes the production fallback the operator confirmed', () => {
    expect(FALLBACK_PUBLIC_ORIGIN).toBe('https://rocket-crm.autosolution.pro')
  })
})
