import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listFreeSlots, loadAgendaConfig } from './availability'

const TZ = 'America/Sao_Paulo'

interface TableRows {
  pipelines?: { data: unknown }
  pipeline_stages?: { data: unknown }
  agenda_availability_settings?: { data: unknown }
  availability_rules?: { data: unknown[] }
  availability_exceptions?: { data: unknown[] }
  deals?: { data: unknown[] }
}

/** Minimal chainable Supabase stub covering both `.maybeSingle()`
 *  terminals (pipelines/pipeline_stages/agenda_availability_settings)
 *  and plain-awaited terminals (availability_rules/_exceptions/deals —
 *  the query builder itself is thenable when nothing else terminates
 *  it). */
function fakeDb(rows: TableRows): SupabaseClient {
  const db = {
    from(table: keyof TableRows) {
      const row = rows[table] ?? { data: null }
      const resolved = { data: row.data ?? null, error: null }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        neq: () => chain,
        not: () => chain,
        gte: () => chain,
        lte: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => Promise.resolve(resolved),
        then: (onFulfilled: (v: typeof resolved) => unknown, onRejected?: (e: unknown) => unknown) =>
          Promise.resolve(resolved).then(onFulfilled, onRejected),
      }
      return chain
    },
  }
  return db as unknown as SupabaseClient
}

const BASE_ROWS: TableRows = {
  pipelines: { data: { id: 'pipe-1' } },
  pipeline_stages: { data: { id: 'stage-1' } },
  agenda_availability_settings: { data: { slot_duration_minutes: 60 } },
  availability_rules: { data: [] },
  availability_exceptions: { data: [] },
  deals: { data: [] },
}

describe('loadAgendaConfig', () => {
  it('returns null when the account has no scheduling pipeline', async () => {
    const db = fakeDb({ ...BASE_ROWS, pipelines: { data: null } })
    expect(await loadAgendaConfig(db, 'acct-1')).toBeNull()
  })

  it('returns null when the pipeline has no stages', async () => {
    const db = fakeDb({ ...BASE_ROWS, pipeline_stages: { data: null } })
    expect(await loadAgendaConfig(db, 'acct-1')).toBeNull()
  })

  it('defaults slot duration to 60 minutes when unset', async () => {
    const db = fakeDb({ ...BASE_ROWS, agenda_availability_settings: { data: null } })
    const config = await loadAgendaConfig(db, 'acct-1')
    expect(config).toEqual({
      pipelineId: 'pipe-1',
      initialStageId: 'stage-1',
      slotDurationMinutes: 60,
    })
  })
})

describe('listFreeSlots', () => {
  it('returns null when there is no Agenda pipeline configured', async () => {
    const db = fakeDb({ ...BASE_ROWS, pipelines: { data: null } })
    expect(await listFreeSlots(db, { accountId: 'acct-1' })).toBeNull()
  })

  // 2026-09-10 is a Thursday (day_of_week 4); 10:00 UTC is 07:00 in
  // Sao Paulo that same calendar day.
  const FROM = new Date('2026-09-10T10:00:00.000Z')

  it('cuts a rule into slots, dropping anything inside the lead-time window', async () => {
    const db = fakeDb({
      ...BASE_ROWS,
      availability_rules: {
        data: [{ day_of_week: 4, start_time: '08:00:00', end_time: '10:00:00' }],
      },
    })
    const result = await listFreeSlots(db, { accountId: 'acct-1', from: FROM, days: 1, tz: TZ })
    expect(result).not.toBeNull()
    expect(result!.slotDurationMinutes).toBe(60)
    // 08:00 local (11:00 UTC) is only 1h after FROM — inside the 2h
    // minimum lead time, so only the 09:00 slot survives.
    expect(result!.slots).toEqual([
      {
        startsAt: new Date('2026-09-10T12:00:00.000Z'),
        token: '2026-09-10T09:00',
        label: 'quinta-feira, 10/09 às 09:00',
      },
    ])
  })

  it('skips a date with a full-day exception', async () => {
    const db = fakeDb({
      ...BASE_ROWS,
      availability_rules: {
        data: [{ day_of_week: 4, start_time: '08:00:00', end_time: '10:00:00' }],
      },
      availability_exceptions: { data: [{ date: '2026-09-10' }] },
    })
    const result = await listFreeSlots(db, { accountId: 'acct-1', from: FROM, days: 1, tz: TZ })
    expect(result!.slots).toEqual([])
  })

  it('excludes a slot that already has an appointment', async () => {
    const db = fakeDb({
      ...BASE_ROWS,
      availability_rules: {
        data: [{ day_of_week: 4, start_time: '08:00:00', end_time: '10:00:00' }],
      },
      deals: { data: [{ scheduled_at: '2026-09-10T12:00:00.000Z' }] },
    })
    const result = await listFreeSlots(db, { accountId: 'acct-1', from: FROM, days: 1, tz: TZ })
    expect(result!.slots).toEqual([])
  })

  it('stops once `limit` slots are collected', async () => {
    const db = fakeDb({
      ...BASE_ROWS,
      availability_rules: {
        data: [{ day_of_week: 4, start_time: '00:00:00', end_time: '23:00:00' }],
      },
    })
    const result = await listFreeSlots(db, {
      accountId: 'acct-1',
      from: FROM,
      days: 1,
      limit: 3,
      tz: TZ,
    })
    expect(result!.slots).toHaveLength(3)
  })
})
