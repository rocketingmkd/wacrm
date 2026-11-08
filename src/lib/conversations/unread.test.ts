import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { incrementUnread } from './unread'

function fakeDb(rpcResult: { error: unknown }, fallbackError: unknown = null) {
  const calls = {
    rpc: [] as { fn: string; args: unknown }[],
    updates: [] as { patch: Record<string, unknown>; id: unknown }[],
  }
  const db = {
    rpc: (fn: string, args: unknown) => {
      calls.rpc.push({ fn, args })
      return Promise.resolve(rpcResult)
    },
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        eq: (_col: string, id: unknown) => {
          calls.updates.push({ patch, id })
          return Promise.resolve({ error: fallbackError })
        },
      }),
    }),
  } as unknown as SupabaseClient
  return { db, calls }
}

describe('incrementUnread', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('increments in the database and writes nothing else when the function exists', async () => {
    const { db, calls } = fakeDb({ error: null })
    await incrementUnread(db, 'conv-1', 4)
    expect(calls.rpc).toEqual([
      { fn: 'increment_conversation_unread', args: { p_conversation_id: 'conv-1' } },
    ])
    expect(calls.updates).toEqual([])
  })

  it('falls back to read-then-write when the function is missing, so the message is still counted', async () => {
    const { db, calls } = fakeDb({
      error: { code: 'PGRST202', message: 'Could not find the function' },
    })
    await incrementUnread(db, 'conv-1', 4)
    expect(calls.updates).toEqual([{ patch: { unread_count: 5 }, id: 'conv-1' }])
  })

  it('treats a missing count as zero in the fallback', async () => {
    const a = fakeDb({ error: { message: 'x' } })
    await incrementUnread(a.db, 'c', null)
    expect(a.calls.updates[0].patch).toEqual({ unread_count: 1 })

    const b = fakeDb({ error: { message: 'x' } })
    await incrementUnread(b.db, 'c', undefined)
    expect(b.calls.updates[0].patch).toEqual({ unread_count: 1 })
  })

  it('never throws, even when the fallback fails too', async () => {
    const { db } = fakeDb({ error: { message: 'x' } }, { message: 'db down' })
    await expect(incrementUnread(db, 'c', 2)).resolves.toBeUndefined()
  })
})
