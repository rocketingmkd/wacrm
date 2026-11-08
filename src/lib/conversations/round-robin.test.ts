import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { maybeAssignRoundRobin, pickNextAgent } from './round-robin'

type Scripted = { data?: unknown; error?: unknown }

/**
 * Scripted stand-in for the three tables the rotation touches.
 *  - `accounts` read (`maybeSingle`) pops from `account`
 *  - `profiles` reads (awaited) pop from `profiles`, agents first
 *  - the `accounts` cursor update (awaited after `select('id')`) pops
 *    from `advance`
 * Every write is recorded with the filters it carried.
 */
function rotationDb(script: {
  account: Scripted[]
  profiles?: Scripted[]
  advance?: Scripted[]
}) {
  const account = [...script.account]
  const profiles = [...(script.profiles ?? [])]
  const advance = [...(script.advance ?? [{ data: [{ id: 'acc' }] }])]
  const log = {
    cursorUpdates: [] as { patch: Record<string, unknown>; filters: unknown[][] }[],
    conversationUpdates: [] as { patch: Record<string, unknown>; id: unknown }[],
    profileReads: 0,
  }

  const db = {
    from(table: string) {
      let op: 'select' | 'update' = 'select'
      let patch: Record<string, unknown> = {}
      const filters: unknown[][] = []
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.order = () => b
      b.update = (p: Record<string, unknown>) => {
        op = 'update'
        patch = p
        return b
      }
      b.eq = (col: string, value: unknown) => {
        filters.push(['eq', col, value])
        return b
      }
      b.is = (col: string, value: unknown) => {
        filters.push(['is', col, value])
        return b
      }
      b.maybeSingle = () => Promise.resolve(account.shift() ?? { data: null, error: null })
      b.then = (resolve: (v: unknown) => unknown) => {
        if (table === 'profiles') {
          log.profileReads++
          return resolve(profiles.shift() ?? { data: [], error: null })
        }
        if (table === 'accounts' && op === 'update') {
          log.cursorUpdates.push({ patch, filters })
          return resolve(advance.shift() ?? { data: [], error: null })
        }
        if (table === 'conversations' && op === 'update') {
          log.conversationUpdates.push({ patch, id: filters.find((f) => f[1] === 'id')?.[2] })
          return resolve({ error: null })
        }
        return resolve({ data: null, error: null })
      }
      return b
    },
  }
  return { db, log }
}

const members = (...ids: string[]) => ({ data: ids.map((user_id) => ({ user_id })) })
const accountRow = (last: string | null, enabled = true) => ({
  data: { round_robin_enabled: enabled, round_robin_last_agent_id: last },
})

describe('pickNextAgent', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('picks the member after the cursor and advances the cursor to them', async () => {
    const { db, log } = rotationDb({
      account: [accountRow('a')],
      profiles: [members('a', 'b', 'c')],
    })
    expect(await pickNextAgent(db, 'acc')).toBe('b')
    expect(log.cursorUpdates).toHaveLength(1)
    expect(log.cursorUpdates[0].patch).toEqual({ round_robin_last_agent_id: 'b' })
    expect(log.cursorUpdates[0].filters).toContainEqual(['eq', 'round_robin_last_agent_id', 'a'])
  })

  it('starts at the first member when the cursor is empty, matching on NULL', async () => {
    const { db, log } = rotationDb({
      account: [accountRow(null)],
      profiles: [members('a', 'b')],
    })
    expect(await pickNextAgent(db, 'acc')).toBe('a')
    expect(log.cursorUpdates[0].filters).toContainEqual(['is', 'round_robin_last_agent_id', null])
  })

  it('wraps from the last member back to the first', async () => {
    const { db } = rotationDb({ account: [accountRow('c')], profiles: [members('a', 'b', 'c')] })
    expect(await pickNextAgent(db, 'acc')).toBe('a')
  })

  it('starts over when the cursor member has left the account', async () => {
    const { db } = rotationDb({ account: [accountRow('gone')], profiles: [members('a', 'b')] })
    expect(await pickNextAgent(db, 'acc')).toBe('a')
  })

  it('returns null when round-robin is required but off, without reading members', async () => {
    const { db, log } = rotationDb({ account: [accountRow('a', false)], profiles: [members('a')] })
    expect(await pickNextAgent(db, 'acc', { requireEnabled: true })).toBeNull()
    expect(log.profileReads).toBe(0)
    expect(log.cursorUpdates).toEqual([])
  })

  it('rotates even when the account setting is off if the caller did not require it', async () => {
    const { db } = rotationDb({ account: [accountRow(null, false)], profiles: [members('a')] })
    expect(await pickNextAgent(db, 'acc')).toBe('a')
  })

  it('returns null when the account has no agents, unless told to fall back to any member', async () => {
    const none = rotationDb({ account: [accountRow(null)], profiles: [members()] })
    expect(await pickNextAgent(none.db, 'acc')).toBeNull()

    const fallback = rotationDb({
      account: [accountRow(null)],
      profiles: [members(), members('owner', 'admin')],
    })
    expect(await pickNextAgent(fallback.db, 'acc', { fallbackToAnyMember: true })).toBe('owner')
  })

  it('returns null when nobody at all is eligible', async () => {
    const { db } = rotationDb({ account: [accountRow(null)], profiles: [members(), members()] })
    expect(await pickNextAgent(db, 'acc', { fallbackToAnyMember: true })).toBeNull()
  })

  it('re-reads the cursor and picks again after losing the race to another conversation', async () => {
    // First read sees the cursor at 'a' and picks 'b', but another
    // conversation moved it to 'b' first, so the swap matches nothing.
    // The re-read sees 'b' and the pick becomes 'c'.
    const { db, log } = rotationDb({
      account: [accountRow('a'), accountRow('b')],
      profiles: [members('a', 'b', 'c'), members('a', 'b', 'c')],
      advance: [{ data: [] }, { data: [{ id: 'acc' }] }],
    })
    expect(await pickNextAgent(db, 'acc')).toBe('c')
    expect(log.cursorUpdates.map((u) => u.patch.round_robin_last_agent_id)).toEqual(['b', 'c'])
  })

  it('still returns an agent after repeated contention instead of leaving the conversation unassigned', async () => {
    const lost = { data: [] }
    const { db, log } = rotationDb({
      account: [accountRow('a'), accountRow('a'), accountRow('a')],
      profiles: [members('a', 'b'), members('a', 'b'), members('a', 'b')],
      advance: [lost, lost, lost],
    })
    expect(await pickNextAgent(db, 'acc')).toBe('b')
    expect(log.cursorUpdates).toHaveLength(3)
  })

  it('returns the pick even when the cursor update itself fails', async () => {
    const { db } = rotationDb({
      account: [accountRow('a')],
      profiles: [members('a', 'b')],
      advance: [{ error: { message: 'db down' } }],
    })
    expect(await pickNextAgent(db, 'acc')).toBe('b')
  })

  it('returns null when the account cannot be read', async () => {
    const { db } = rotationDb({ account: [{ error: { message: 'boom' } }] })
    expect(await pickNextAgent(db, 'acc')).toBeNull()
  })
})

describe('maybeAssignRoundRobin', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('assigns the new conversation to the next agent', async () => {
    const { db, log } = rotationDb({ account: [accountRow('a')], profiles: [members('a', 'b')] })
    await maybeAssignRoundRobin(db, 'acc', 'conv-1')
    expect(log.conversationUpdates).toEqual([{ patch: { assigned_agent_id: 'b' }, id: 'conv-1' }])
  })

  it('does nothing when the account has round-robin off', async () => {
    const { db, log } = rotationDb({ account: [accountRow('a', false)], profiles: [members('a')] })
    await maybeAssignRoundRobin(db, 'acc', 'conv-1')
    expect(log.conversationUpdates).toEqual([])
    expect(log.cursorUpdates).toEqual([])
  })

  it('does not assign to a non-agent when the account has no agents', async () => {
    const { db, log } = rotationDb({ account: [accountRow(null)], profiles: [members()] })
    await maybeAssignRoundRobin(db, 'acc', 'conv-1')
    expect(log.conversationUpdates).toEqual([])
  })
})
