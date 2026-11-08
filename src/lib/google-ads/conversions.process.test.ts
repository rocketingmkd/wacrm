import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const ingestEvents = vi.fn()
const refreshAccessToken = vi.fn()

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => (v === 'bad' ? (() => { throw new Error('x') })() : `plain-${v}`),
}))
vi.mock('./oauth', () => ({
  refreshAccessToken: (...args: unknown[]) => refreshAccessToken(...args),
}))
vi.mock('./data-manager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./data-manager')>()
  return { ...actual, ingestEvents: (...args: unknown[]) => ingestEvents(...args) }
})

import { processGoogleQueue } from './conversions'

const NOW = new Date('2026-10-21T12:00:00Z')

interface World {
  queue: Record<string, unknown>[]
  settings: Record<string, unknown> | null
  connection: Record<string, unknown> | null
  rule: Record<string, unknown> | null
  attribution: Record<string, unknown> | null
}

/** Tiny in-memory stand-in for the tables the Google processor touches. */
function makeDb(world: World) {
  const updates: { id: string; patch: Record<string, unknown> }[] = []
  const db = {
    from(table: string) {
      let eqId: string | null = null
      let mode: 'select' | 'update' = 'select'
      let patch: Record<string, unknown> = {}
      const b: Record<string, unknown> = {}
      const done = () => {
        if (mode === 'update' && eqId) updates.push({ id: eqId, patch })
        return Promise.resolve({ error: null })
      }
      const one = (data: unknown) => Promise.resolve({ data, error: null })
      b.select = () => b
      b.eq = (col: string, val: string) => {
        if (col === 'id') eqId = val
        return b
      }
      b.in = () => b
      b.lt = () => b
      b.lte = () => b
      b.order = () => b
      b.limit = () =>
        table === 'conversion_events' ? Promise.resolve({ data: world.queue, error: null }) : b
      b.update = (p: Record<string, unknown>) => {
        mode = 'update'
        patch = p
        return b
      }
      b.maybeSingle = () => {
        if (table === 'conversion_settings') return one(world.settings)
        if (table === 'google_ads_connections') return one(world.connection)
        if (table === 'conversion_rules') return one(world.rule)
        if (table === 'lead_attribution') return one(world.attribution)
        return one(null)
      }
      b.then = (resolve: (v: unknown) => unknown) => done().then(resolve)
      return b
    },
  } as unknown as SupabaseClient
  return { db, updates }
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'ev-1',
  account_id: 'acc',
  contact_id: 'ct',
  rule_id: 'rule-1',
  event_name: 'Purchase',
  value: 250,
  currency: 'BRL',
  occurred_at: '2026-10-21T11:00:00Z',
  attempts: 0,
  ...over,
})

const world = (over: Partial<World> = {}): World => ({
  queue: [row()],
  settings: { google_enabled: true, google_validate_only: false },
  connection: {
    client_id: 'client-id',
    client_secret_enc: 'secret',
    refresh_token_enc: 'refresh',
    customer_id: '123-456-7890',
    login_customer_id: '',
  },
  rule: { google_action_id: '555' },
  attribution: { gclid: 'GCLID-1' },
  ...over,
})

const finalPatch = (updates: { id: string; patch: Record<string, unknown> }[]) =>
  updates[updates.length - 1].patch

beforeEach(() => {
  ingestEvents.mockReset()
  ingestEvents.mockResolvedValue({ warnings: [] })
  refreshAccessToken.mockReset()
  refreshAccessToken.mockResolvedValue('access-token')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('processGoogleQueue', () => {
  it('sends a conversion with the refreshed token and marks it sent', async () => {
    const { db, updates } = makeDb(world())
    const out = await processGoogleQueue(db, NOW)

    expect(out).toEqual({ processed: 1, sent: 1, skipped: 0, failed: 0 })
    expect(refreshAccessToken).toHaveBeenCalledWith({
      refreshToken: 'plain-refresh',
      clientId: 'client-id',
      clientSecret: 'plain-secret',
    })
    expect(ingestEvents).toHaveBeenCalledTimes(1)
    expect(ingestEvents.mock.calls[0][0]).toBe('access-token')
    expect(finalPatch(updates)).toMatchObject({ status: 'sent', attempts: 1, detail: null })
    expect(finalPatch(updates)).toHaveProperty('sent_at')
  })

  it('keeps Google warnings in the detail of a sent row', async () => {
    ingestEvents.mockResolvedValue({ warnings: ['gclid is old', 'value missing'] })
    const { db, updates } = makeDb(world())
    await processGoogleQueue(db, NOW)
    expect(finalPatch(updates)).toMatchObject({
      status: 'sent',
      detail: 'Avisos: gclid is old; value missing',
    })
  })

  it('validate-only mode asks Google to validate and closes the row as skipped, counting the attempt', async () => {
    const { db, updates } = makeDb(world({ settings: { google_enabled: true, google_validate_only: true } }))
    const out = await processGoogleQueue(db, NOW)

    expect(out).toEqual({ processed: 1, sent: 0, skipped: 1, failed: 0 })
    expect(ingestEvents).toHaveBeenCalledTimes(1)
    const patch = finalPatch(updates)
    expect(patch).toMatchObject({ status: 'skipped', attempts: 1 })
    expect(patch.detail).toMatch(/^Teste: o Google validou, nada foi importado\./)
  })

  it('treats a missing validate-only setting as on, the safe default', async () => {
    const { db, updates } = makeDb(world({ settings: { google_enabled: true } }))
    const out = await processGoogleQueue(db, NOW)
    expect(out.skipped).toBe(1)
    expect(finalPatch(updates).detail).toMatch(/^Teste:/)
  })

  it('skips without calling Google when sending is off', async () => {
    const { db, updates } = makeDb(world({ settings: { google_enabled: false, google_validate_only: false } }))
    const out = await processGoogleQueue(db, NOW)
    expect(out.skipped).toBe(1)
    expect(ingestEvents).not.toHaveBeenCalled()
    expect(refreshAccessToken).not.toHaveBeenCalled()
    expect(finalPatch(updates)).toMatchObject({ status: 'skipped', detail: 'Envio ao Google desativado' })
  })

  it('skips when Google Ads is not connected or has no account chosen', async () => {
    for (const connection of [
      null,
      { client_id: 'c', client_secret_enc: 's', refresh_token_enc: 'r', customer_id: null, login_customer_id: null },
    ]) {
      const { db, updates } = makeDb(world({ connection }))
      const out = await processGoogleQueue(db, NOW)
      expect(out.skipped).toBe(1)
      expect(finalPatch(updates)).toMatchObject({
        status: 'skipped',
        detail: 'Google Ads não conectado ou sem conta escolhida',
      })
    }
    expect(ingestEvents).not.toHaveBeenCalled()
  })

  it('skips a rule that has no Google conversion action', async () => {
    const { db, updates } = makeDb(world({ rule: { google_action_id: null } }))
    await processGoogleQueue(db, NOW)
    expect(ingestEvents).not.toHaveBeenCalled()
    expect(finalPatch(updates)).toMatchObject({
      status: 'skipped',
      detail: 'Regra sem ação de conversão do Google',
    })
  })

  it('skips a lead with no click id', async () => {
    const { db, updates } = makeDb(world({ attribution: null }))
    const out = await processGoogleQueue(db, NOW)
    expect(out.skipped).toBe(1)
    expect(ingestEvents).not.toHaveBeenCalled()
    expect(finalPatch(updates)).toMatchObject({ status: 'skipped' })
  })

  it('marks a Google failure for retry with backoff', async () => {
    ingestEvents.mockRejectedValue(new Error('PERMISSION_DENIED'))
    const { db, updates } = makeDb(world({ queue: [row({ attempts: 1 })] }))
    const out = await processGoogleQueue(db, NOW)

    expect(out).toMatchObject({ failed: 1, sent: 0 })
    const patch = finalPatch(updates)
    expect(patch).toMatchObject({ status: 'failed', attempts: 2, detail: 'PERMISSION_DENIED' })
    // second failure waits 4 minutes
    expect(patch.next_attempt_at).toBe(new Date(NOW.getTime() + 4 * 60_000).toISOString())
  })

  it('claims each row before sending so a parallel run skips it', async () => {
    const { db, updates } = makeDb(world())
    await processGoogleQueue(db, NOW)
    expect(updates[0].patch).toEqual({ next_attempt_at: new Date(NOW.getTime() + 10 * 60_000).toISOString() })
  })

  it('refreshes the access token once per account, not once per row', async () => {
    const { db } = makeDb(world({ queue: [row({ id: 'ev-1' }), row({ id: 'ev-2' })] }))
    const out = await processGoogleQueue(db, NOW)
    expect(out.sent).toBe(2)
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(ingestEvents).toHaveBeenCalledTimes(2)
  })

  it('returns zeros for an empty queue', async () => {
    const { db } = makeDb(world({ queue: [] }))
    expect(await processGoogleQueue(db, NOW)).toEqual({ processed: 0, sent: 0, skipped: 0, failed: 0 })
  })
})
