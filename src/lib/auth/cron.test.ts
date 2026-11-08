import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { requireCronSecret } from './cron'

const ORIGINAL = process.env.AUTOMATION_CRON_SECRET

function requestWith(secret?: string): Request {
  const headers: Record<string, string> = {}
  if (secret !== undefined) headers['x-cron-secret'] = secret
  return new Request('http://localhost/api/x/cron', { headers })
}

describe('requireCronSecret', () => {
  beforeEach(() => {
    process.env.AUTOMATION_CRON_SECRET = 's3cret-value'
  })

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.AUTOMATION_CRON_SECRET
    else process.env.AUTOMATION_CRON_SECRET = ORIGINAL
  })

  it('lets the request through when the header matches', () => {
    expect(requireCronSecret(requestWith('s3cret-value'))).toBeNull()
  })

  it('answers 503 when no secret is configured, even with a header sent', async () => {
    delete process.env.AUTOMATION_CRON_SECRET
    const res = requireCronSecret(requestWith('anything'))
    expect(res?.status).toBe(503)
    expect(await res?.json()).toEqual({ error: 'cron not configured' })
  })

  it('answers 401 for a wrong secret of the same length', async () => {
    const res = requireCronSecret(requestWith('s3cret-valuf'))
    expect(res?.status).toBe(401)
    expect(await res?.json()).toEqual({ error: 'Unauthorized' })
  })

  it('answers 401 for a different length without throwing', () => {
    expect(requireCronSecret(requestWith('short'))?.status).toBe(401)
  })

  it('answers 401 when the header is missing', () => {
    expect(requireCronSecret(requestWith())?.status).toBe(401)
  })
})
