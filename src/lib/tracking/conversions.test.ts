import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { backoffMinutes, buildMetaEvent, hashPhone, MAX_EVENT_AGE_SECS } from './conversions'

const NOW = Math.floor(new Date('2026-10-21T12:00:00Z').getTime() / 1000)
const event = (over: Record<string, unknown> = {}) => ({
  id: 'ev-1',
  event_name: 'Purchase',
  value: 250 as number | null,
  currency: 'BRL' as string | null,
  occurred_at: '2026-10-21T11:00:00Z',
  ...over,
})
const ctwa = { source: 'meta_ctwa' as const, ctwa_clid: 'CLID1', fbc: null, fbp: null, landing_url: null }
const site = {
  source: 'meta_site' as const,
  ctwa_clid: null,
  fbc: 'fb.1.1.ABC',
  fbp: 'fb.1.2.123',
  landing_url: 'https://lp.exemplo.com/oferta',
}

describe('hashPhone', () => {
  it('hashes only the digits', () => {
    const expected = createHash('sha256').update('5543991943029').digest('hex')
    expect(hashPhone('+55 (43) 99194-3029')).toBe(expected)
  })
  it.each([null, undefined, '', '123'])('returns null for %j', (p) => {
    expect(hashPhone(p)).toBeNull()
  })
})

describe('buildMetaEvent', () => {
  it('Click to WhatsApp lead becomes a business messaging event', () => {
    const out = buildMetaEvent(event(), ctwa, '5543991943029', NOW)
    expect(out).toEqual({
      payload: {
        event_name: 'Purchase',
        event_time: NOW - 3600,
        event_id: 'ev-1',
        custom_data: { value: 250, currency: 'BRL' },
        action_source: 'business_messaging',
        messaging_channel: 'whatsapp',
        user_data: { ctwa_clid: 'CLID1' },
      },
    })
  })

  it('site lead from Meta becomes a website event with fbc, fbp and hashed phone', () => {
    const out = buildMetaEvent(event({ event_name: 'Lead', value: null }), site, '5543991943029', NOW)
    expect('payload' in out && out.payload).toMatchObject({
      event_name: 'Lead',
      action_source: 'website',
      event_source_url: 'https://lp.exemplo.com/oferta',
      user_data: { fbc: 'fb.1.1.ABC', fbp: 'fb.1.2.123', ph: [hashPhone('5543991943029')] },
    })
    expect('payload' in out && 'custom_data' in out.payload).toBe(false)
  })

  it('omits value when it is zero', () => {
    const out = buildMetaEvent(event({ value: 0 }), ctwa, null, NOW)
    expect('payload' in out && 'custom_data' in out.payload).toBe(false)
  })

  it('defaults the currency to BRL', () => {
    const out = buildMetaEvent(event({ currency: null }), ctwa, null, NOW)
    expect('payload' in out && out.payload.custom_data).toEqual({ value: 250, currency: 'BRL' })
  })

  it('skips Google and other origins', () => {
    for (const source of ['google', 'other'] as const) {
      expect(buildMetaEvent(event(), { ...ctwa, source }, null, NOW)).toEqual({ skip: 'Origem fora da Meta' })
    }
  })

  it('skips contacts without an origin', () => {
    expect(buildMetaEvent(event(), null, null, NOW)).toEqual({ skip: 'Contato sem origem de anúncio' })
  })

  it('skips a Click to WhatsApp lead without ctwa_clid', () => {
    expect(buildMetaEvent(event(), { ...ctwa, ctwa_clid: null }, null, NOW)).toEqual({
      skip: 'Anúncio sem ctwa_clid',
    })
  })

  it('skips a site lead with nothing to match on', () => {
    expect(buildMetaEvent(event(), { ...site, fbc: null, fbp: null }, null, NOW)).toEqual({
      skip: 'Sem dados para casar com o anúncio',
    })
  })

  it('skips events older than the Meta limit', () => {
    const old = new Date((NOW - MAX_EVENT_AGE_SECS - 60) * 1000).toISOString()
    expect(buildMetaEvent(event({ occurred_at: old }), ctwa, null, NOW)).toEqual({
      skip: 'Evento com mais de 7 dias (a Meta recusa)',
    })
  })
})

describe('backoffMinutes', () => {
  it('grows and is capped', () => {
    expect([1, 2, 3, 4].map(backoffMinutes)).toEqual([2, 4, 8, 16])
    expect(backoffMinutes(20)).toBe(240)
    expect(backoffMinutes(0)).toBe(2)
  })
})
