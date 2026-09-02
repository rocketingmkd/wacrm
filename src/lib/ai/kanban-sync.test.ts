import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const moveDealStage = vi.fn()
const dispatchDealStageChanged = vi.fn()
vi.mock('@/lib/deals/move-stage', () => ({
  moveDealStage: (...a: unknown[]) => moveDealStage(...a),
  dispatchDealStageChanged: (...a: unknown[]) => dispatchDealStageChanged(...a),
}))

import { syncDealToAiStage, moveFunnelDealToHumanStage } from './kanban-sync'

const CONFIG = {
  pipeline_id: 'pipe-1',
  stage_ia_id: 'stage-ia',
  stage_human_id: 'stage-human',
  stage_done_id: null,
  enabled: true,
}

/**
 * Minimal chainable Supabase stub. `tableResults` maps a table name to
 * an ordered queue of `{ data }` objects returned by the terminal
 * `.maybeSingle()` calls against that table; `.insert()` resolves
 * `{ error: null }` and records into `inserts`.
 */
function fakeDb(tableResults: Record<string, Array<{ data: unknown }>>) {
  const inserts: Array<{ table: string; row: unknown }> = []
  const db = {
    inserts,
    from(table: string) {
      const queue = tableResults[table] ?? []
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () =>
          Promise.resolve(queue.shift() ?? { data: null, error: null }),
        insert: (row: unknown) => {
          inserts.push({ table, row })
          return Promise.resolve({ error: null })
        },
      }
      return chain
    },
  }
  return db as unknown as SupabaseClient & { inserts: typeof inserts }
}

beforeEach(() => {
  moveDealStage.mockReset()
  dispatchDealStageChanged.mockReset()
  moveDealStage.mockResolvedValue({ ok: true, move: { dealId: 'd1' } })
})

describe('syncDealToAiStage', () => {
  it('no-ops when there is no config', async () => {
    const db = fakeDb({ ai_kanban_config: [{ data: null }] })
    await syncDealToAiStage({
      db,
      accountId: 'a1',
      conversationId: 'c1',
      contactId: 'ct1',
      ownerUserId: 'u1',
    })
    expect(moveDealStage).not.toHaveBeenCalled()
    expect(db.inserts).toHaveLength(0)
  })

  it('no-ops when the config is disabled', async () => {
    const db = fakeDb({
      ai_kanban_config: [{ data: { ...CONFIG, enabled: false } }],
    })
    await syncDealToAiStage({
      db,
      accountId: 'a1',
      conversationId: 'c1',
      contactId: 'ct1',
      ownerUserId: 'u1',
    })
    expect(moveDealStage).not.toHaveBeenCalled()
    expect(db.inserts).toHaveLength(0)
  })

  it('creates a deal in the AI stage when the contact has none', async () => {
    const db = fakeDb({
      ai_kanban_config: [{ data: CONFIG }],
      deals: [{ data: null }, { data: null }], // by-conversation, then by-contact
      contacts: [{ data: { name: 'Ana' } }],
      accounts: [{ data: { default_currency: 'BRL' } }],
    })
    await syncDealToAiStage({
      db,
      accountId: 'a1',
      conversationId: 'c1',
      contactId: 'ct1',
      ownerUserId: 'u1',
    })
    expect(moveDealStage).not.toHaveBeenCalled()
    expect(db.inserts).toHaveLength(1)
    expect(db.inserts[0]).toMatchObject({
      table: 'deals',
      row: {
        pipeline_id: 'pipe-1',
        stage_id: 'stage-ia',
        conversation_id: 'c1',
        contact_id: 'ct1',
        title: 'Ana',
        currency: 'BRL',
        status: 'open',
      },
    })
  })

  it('moves an existing deal that is in another stage', async () => {
    const db = fakeDb({
      ai_kanban_config: [{ data: CONFIG }],
      deals: [{ data: { id: 'd9', stage_id: 'stage-new' } }],
    })
    await syncDealToAiStage({
      db,
      accountId: 'a1',
      conversationId: 'c1',
      contactId: 'ct1',
      ownerUserId: 'u1',
    })
    expect(moveDealStage).toHaveBeenCalledWith(
      expect.objectContaining({ dealId: 'd9', toStageId: 'stage-ia' }),
    )
    expect(dispatchDealStageChanged).toHaveBeenCalledOnce()
    expect(db.inserts).toHaveLength(0)
  })

  it('does nothing when the deal is already in the AI stage', async () => {
    const db = fakeDb({
      ai_kanban_config: [{ data: CONFIG }],
      deals: [{ data: { id: 'd9', stage_id: 'stage-ia' } }],
    })
    await syncDealToAiStage({
      db,
      accountId: 'a1',
      conversationId: 'c1',
      contactId: 'ct1',
      ownerUserId: 'u1',
    })
    expect(moveDealStage).not.toHaveBeenCalled()
    expect(db.inserts).toHaveLength(0)
  })
})

describe('moveFunnelDealToHumanStage', () => {
  it('moves an existing deal to the human stage', async () => {
    const db = fakeDb({
      ai_kanban_config: [{ data: CONFIG }],
      deals: [{ data: { id: 'd9', stage_id: 'stage-ia' } }],
    })
    await moveFunnelDealToHumanStage({
      db,
      accountId: 'a1',
      conversationId: 'c1',
      contactId: 'ct1',
    })
    expect(moveDealStage).toHaveBeenCalledWith(
      expect.objectContaining({ dealId: 'd9', toStageId: 'stage-human' }),
    )
  })

  it('never creates a deal', async () => {
    const db = fakeDb({
      ai_kanban_config: [{ data: CONFIG }],
      deals: [{ data: null }, { data: null }],
    })
    await moveFunnelDealToHumanStage({
      db,
      accountId: 'a1',
      conversationId: 'c1',
      contactId: 'ct1',
    })
    expect(moveDealStage).not.toHaveBeenCalled()
    expect(db.inserts).toHaveLength(0)
  })

  it('no-ops when the deal is already in the human stage', async () => {
    const db = fakeDb({
      ai_kanban_config: [{ data: CONFIG }],
      deals: [{ data: { id: 'd9', stage_id: 'stage-human' } }],
    })
    await moveFunnelDealToHumanStage({
      db,
      accountId: 'a1',
      conversationId: 'c1',
      contactId: 'ct1',
    })
    expect(moveDealStage).not.toHaveBeenCalled()
  })
})
