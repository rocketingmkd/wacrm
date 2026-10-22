import { beforeAll, describe, expect, it } from 'vitest'

beforeAll(() => {
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
})

const NOW = Math.floor(new Date('2026-10-21T12:00:00Z').getTime() / 1000)
const target = { customerId: '1234567890', loginCustomerId: null, actionId: '98765432' }
const event = {
  id: 'evt-1',
  event_name: 'Purchase',
  value: 150,
  currency: 'BRL',
  occurred_at: '2026-10-20T12:00:00Z',
}

interface RequestBody {
  validateOnly: boolean
  destinations: { operatingAccount: unknown; productDestinationId: string; loginAccount?: unknown }[]
  events: { conversionValue?: number; currency?: string; [key: string]: unknown }[]
}

describe('buildGoogleRequest', async () => {
  const { buildGoogleRequest, onlyDigits } = await import('./data-manager')

  it('skips a lead with no gclid', () => {
    expect(buildGoogleRequest(event, { gclid: null }, target, NOW, false)).toEqual({
      skip: 'Contato sem gclid do Google Ads',
    })
    expect(buildGoogleRequest(event, null, target, NOW, false)).toHaveProperty('skip')
  })

  it('skips events older than the 90 day window', () => {
    const old = { ...event, occurred_at: '2026-06-01T12:00:00Z' }
    expect(buildGoogleRequest(old, { gclid: 'abc' }, target, NOW, false)).toHaveProperty('skip')
  })

  it('builds the destination, the click id and the value', () => {
    const built = buildGoogleRequest(event, { gclid: 'abc' }, target, NOW, false)
    if ('skip' in built) throw new Error(built.skip)
    const body = built.body as unknown as RequestBody
    expect(body.validateOnly).toBe(false)
    expect(body.destinations[0]).toMatchObject({
      operatingAccount: { accountId: '1234567890', accountType: 'GOOGLE_ADS' },
      productDestinationId: '98765432',
    })
    expect(body.destinations[0].loginAccount).toBeUndefined()
    expect(body.events[0]).toMatchObject({
      transactionId: 'evt-1',
      adIdentifiers: { gclid: 'abc' },
      conversionValue: 150,
      currency: 'BRL',
      eventTimestamp: '2026-10-20T12:00:00.000Z',
    })
  })

  it('adds the manager account and drops a zero value', () => {
    const built = buildGoogleRequest(
      { ...event, value: 0 },
      { gclid: 'abc' },
      { ...target, loginCustomerId: '1112223334' },
      NOW,
      true,
    )
    if ('skip' in built) throw new Error(built.skip)
    const body = built.body as unknown as RequestBody
    expect(body.validateOnly).toBe(true)
    expect(body.destinations[0].loginAccount).toEqual({ accountId: '1112223334', accountType: 'GOOGLE_ADS' })
    expect(body.events[0].conversionValue).toBeUndefined()
    expect(body.events[0].currency).toBeUndefined()
  })

  it('keeps only the digits of an id', () => {
    expect(onlyDigits('123-456-7890')).toBe('1234567890')
    expect(onlyDigits(null)).toBe('')
  })
})

describe('oauth state', async () => {
  const { createState, verifyState, buildAuthUrl, redirectUri } = await import('./oauth')

  it('accepts its own state and returns the account, user and nonce', () => {
    const { state, nonce } = createState('acc-1', 'user-1')
    expect(verifyState(state)).toEqual({ accountId: 'acc-1', userId: 'user-1', nonce })
  })

  it('rejects a tampered, expired or empty state', () => {
    const { state } = createState('acc-1', 'user-1', Date.now())
    const [payload, signature] = state.split('.')
    const forged = Buffer.from(JSON.stringify({ a: 'acc-2', u: 'user-1', n: 'x', t: Date.now() })).toString('base64url')
    expect(verifyState(`${forged}.${signature}`)).toBeNull()
    expect(verifyState(`${payload}.x${signature}`)).toBeNull()
    expect(verifyState(null)).toBeNull()
    const old = createState('acc-1', 'user-1', Date.now() - 11 * 60_000)
    expect(verifyState(old.state)).toBeNull()
  })

  it('asks for offline access with the Data Manager scope', () => {
    const url = new URL(buildAuthUrl({ clientId: 'id.apps.googleusercontent.com', redirectUri: 'https://x.test/cb', state: 's' }))
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/datamanager')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('redirect_uri')).toBe('https://x.test/cb')
  })

  it('builds the redirect uri from the forwarded host', () => {
    delete process.env.GOOGLE_ADS_REDIRECT_URI
    delete process.env.NEXT_PUBLIC_SITE_URL
    const req = new Request('http://localhost:3000/api/google-ads/connection', {
      headers: { 'x-forwarded-host': 'rocket-crm.autosolution.pro', 'x-forwarded-proto': 'https' },
    })
    expect(redirectUri(req)).toBe('https://rocket-crm.autosolution.pro/api/google-ads/callback')
  })
})

describe('parseCredentialsInput', async () => {
  const { parseCredentialsInput } = await import('./credentials')
  const base = { client_id: 'abc-123.apps.googleusercontent.com', client_secret: 'GOCSPX-abcdefghij' }

  it('cleans the account ids to digits', () => {
    const r = parseCredentialsInput({ ...base, customer_id: '123-456-7890', login_customer_id: '' })
    expect(r).toMatchObject({ ok: true, value: { customer_id: '1234567890', login_customer_id: null } })
  })

  it('allows a blank secret (keep the stored one)', () => {
    expect(parseCredentialsInput({ ...base, client_secret: '' })).toMatchObject({ ok: true })
  })

  it('rejects a wrong client id and a short account id', () => {
    expect(parseCredentialsInput({ ...base, client_id: 'nope' })).toMatchObject({ ok: false })
    expect(parseCredentialsInput({ ...base, customer_id: '12345' })).toMatchObject({ ok: false })
    expect(parseCredentialsInput(null)).toMatchObject({ ok: false })
  })
})
