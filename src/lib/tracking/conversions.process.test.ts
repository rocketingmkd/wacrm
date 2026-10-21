import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const sendCapiEvents = vi.fn()
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendCapiEvents: (...args: unknown[]) => sendCapiEvents(...args),
}))
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => (v === 'bad' ? (() => { throw new Error('x') })() : `plain-${v}`),
}))

import { processConversionQueue } from './conversions'

const NOW = new Date('2026-10-21T12:00:00Z')

interface World {
  queue: Record<string, unknown>[]
  settings: Record<string, unknown> | null
  config: Record<string, unknown> | null
  attribution: Record<string, unknown> | null
  phone: string | null
}

/** Tiny in-memory stand-in for the tables the processor touches. */
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
      b.limit = () => (table === 'conversion_events' ? Promise.resolve({ data: world.queue, error: null }) : b)
      b.update = (p: Record<string, unknown>) => {
        mode = 'update'
        patch = p
        return b
      }
      b.maybeSingle = () => {
        if (table === 'conversion_settings') return one(world.settings)
        if (table === 'whatsapp_config') return one(world.config)
        if (table === 'lead_attribution') return one(world.attribution)
        if (table === 'contacts') return one(world.phone ? { phone: world.phone } : null)
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
  event_name: 'Purchase',
  value: 250,
  currency: 'BRL',
  occurred_at: '2026-10-21T11:00:00Z',
  attempts: 0,
  ...over,
})

const world = (over: Partial<World> = {}): World => ({
  queue: [row()],
  settings: { meta_dataset_id: '999', meta_enabled: true, meta_test_code: null },
  config: { access_token: 'tok' },
  attribution: { source: 'meta_ctwa', ctwa_clid: 'CLID', fbc: null, fbp: null, landing_url: null },
  phone: '5543991943029',
  ...over,
})

const finalPatch = (updates: { id: string; patch: Record<string, unknown> }[]) =>
  updates[updates.length - 1].patch

beforeEach(() => {
  sendCapiEvents.mockReset()
  sendCapiEvents.mockResolvedValue({ eventsReceived: 1 })
})

describe('processConversionQueue', () => {
  it('sends a Click to WhatsApp purchase and marks it sent', async () => {
    const { db, updates } = makeDb(world())
    const out = await processConversionQueue(db, NOW)

    expect(out).toEqual({ processed: 1, sent: 1, skipped: 0, failed: 0 })
    expect(sendCapiEvents).toHaveBeenCalledTimes(1)
    const call = sendCapiEvents.mock.calls[0][0]
    expect(call).toMatchObject({ datasetId: '999', accessToken: 'plain-tok', testEventCode: null })
    expect(call.events[0]).toMatchObject({
      event_name: 'Purchase',
      action_source: 'business_messaging',
      user_data: { ctwa_clid: 'CLID' },
      custom_data: { value: 250, currency: 'BRL' },
    })
    expect(finalPatch(updates)).toMatchObject({ status: 'sent', attempts: 1 })
  })

  it('passes the test code and says so in the log', async () => {
    const { db, updates } = makeDb(world({ settings: { meta_dataset_id: '999', meta_enabled: true, meta_test_code: 'TEST1' } }))
    await processConversionQueue(db, NOW)
    expect(sendCapiEvents.mock.calls[0][0].testEventCode).toBe('TEST1')
    expect(finalPatch(updates)).toMatchObject({ status: 'sent', detail: 'Enviado como teste' })
  })

  it('skips without calling Meta when sending is off', async () => {
    const { db, updates } = makeDb(world({ settings: { meta_dataset_id: '999', meta_enabled: false, meta_test_code: null } }))
    const out = await processConversionQueue(db, NOW)
    expect(out.skipped).toBe(1)
    expect(sendCapiEvents).not.toHaveBeenCalled()
    expect(finalPatch(updates)).toMatchObject({ status: 'skipped', detail: 'Envio à Meta desativado' })
  })

  it('skips when the account has no WhatsApp token', async () => {
    const { db, updates } = makeDb(world({ config: null }))
    await processConversionQueue(db, NOW)
    expect(sendCapiEvents).not.toHaveBeenCalled()
    expect(finalPatch(updates)).toMatchObject({ status: 'skipped' })
  })

  it('skips a Google lead and a lead without origin', async () => {
    for (const attribution of [
      { source: 'google', ctwa_clid: null, fbc: null, fbp: null, landing_url: null },
      null,
    ]) {
      const { db, updates } = makeDb(world({ attribution }))
      const out = await processConversionQueue(db, NOW)
      expect(out.skipped).toBe(1)
      expect(finalPatch(updates)).toMatchObject({ status: 'skipped' })
    }
    expect(sendCapiEvents).not.toHaveBeenCalled()
  })

  it('marks a Meta failure for retry with backoff', async () => {
    sendCapiEvents.mockRejectedValue(new Error('Invalid OAuth access token'))
    const { db, updates } = makeDb(world({ queue: [row({ attempts: 1 })] }))
    const out = await processConversionQueue(db, NOW)

    expect(out).toMatchObject({ failed: 1, sent: 0 })
    const patch = finalPatch(updates)
    expect(patch).toMatchObject({ status: 'failed', attempts: 2, detail: 'Invalid OAuth access token' })
    // second failure waits 4 minutes
    expect(patch.next_attempt_at).toBe(new Date(NOW.getTime() + 4 * 60_000).toISOString())
  })

  it('claims each row before sending so a parallel run skips it', async () => {
    const { db, updates } = makeDb(world())
    await processConversionQueue(db, NOW)
    expect(updates[0].patch).toEqual({ next_attempt_at: new Date(NOW.getTime() + 10 * 60_000).toISOString() })
  })

  it('returns zeros for an empty queue', async () => {
    const { db } = makeDb(world({ queue: [] }))
    expect(await processConversionQueue(db, NOW)).toEqual({ processed: 0, sent: 0, skipped: 0, failed: 0 })
  })
})
