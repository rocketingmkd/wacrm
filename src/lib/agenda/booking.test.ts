import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// availability.ts has its own test suite — attemptBooking's own logic
// (validate the requested instant against a fresh list, write the
// deal, log the attempt) is what's under test here, so the slot
// generation it depends on is mocked directly.
const h = vi.hoisted(() => ({
  loadAgendaConfig: vi.fn(),
  listFreeSlots: vi.fn(),
}))
vi.mock('./availability', () => ({
  loadAgendaConfig: h.loadAgendaConfig,
  listFreeSlots: h.listFreeSlots,
}))

import { attemptBooking, textTimeMismatchesBooking } from './booking'
import { zonedWallTimeToUtc, formatWallTimeToken, formatSlotLabelPtBr } from './timezone'
import type { BookingRequest } from '@/lib/ai/types'

const TZ = 'America/Sao_Paulo'
const CONFIG = { pipelineId: 'pipe-1', initialStageId: 'stage-1', slotDurationMinutes: 60 }
const BOOKING: BookingRequest = {
  whenRaw: '2026-09-10T14:00',
  email: 'joao@empresa.com',
  subject: 'Reunião sobre CRM',
}

function freeSlotFor(dateISO: string, timeHHMM: string) {
  const startsAt = zonedWallTimeToUtc(dateISO, timeHHMM, TZ)
  return {
    startsAt,
    token: formatWallTimeToken(startsAt, TZ),
    label: formatSlotLabelPtBr(startsAt, TZ),
  }
}

/** Minimal chainable Supabase stub. Every write (`insert`/`update`) is
 *  recorded flat, tagged with the table name — same pattern as
 *  `src/lib/ai/kanban-sync.test.ts`. */
function fakeDb(cfg: {
  contact?: Record<string, unknown> | null
  account?: Record<string, unknown> | null
  dealInsert?: { data: unknown; error: unknown }
  profiles?: Record<string, unknown>[]
}) {
  const inserts: Array<{ table: string; row: unknown }> = []
  const updates: Array<{ table: string; row: unknown }> = []
  const db = {
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => Promise.resolve({ data: cfg.profiles ?? [], error: null }),
        maybeSingle: () => {
          if (table === 'contacts') return Promise.resolve({ data: cfg.contact ?? null, error: null })
          if (table === 'accounts') return Promise.resolve({ data: cfg.account ?? null, error: null })
          return Promise.resolve({ data: null, error: null })
        },
        single: () => Promise.resolve(cfg.dealInsert ?? { data: { id: 'deal-1' }, error: null }),
        insert: (row: unknown) => {
          inserts.push({ table, row })
          // notifications/ai_booking_attempts are awaited directly with
          // no further chaining; deals.insert(...).select().single()
          // keeps chaining.
          if (table === 'notifications' || table === 'ai_booking_attempts') {
            return Promise.resolve({ error: null })
          }
          return chain
        },
        update: (row: unknown) => {
          updates.push({ table, row })
          return chain
        },
      }
      return chain
    },
  }
  return { db: db as unknown as SupabaseClient, inserts, updates }
}

function attemptsOf(inserts: Array<{ table: string; row: unknown }>) {
  return inserts.filter((i) => i.table === 'ai_booking_attempts').map((i) => i.row as Record<string, unknown>)
}

beforeEach(() => {
  h.loadAgendaConfig.mockReset()
  h.listFreeSlots.mockReset()
  h.loadAgendaConfig.mockResolvedValue(CONFIG)
})

describe('attemptBooking', () => {
  it('fails with agenda_not_configured when the account has no Agenda pipeline', async () => {
    h.loadAgendaConfig.mockResolvedValue(null)
    const { db, inserts } = fakeDb({})
    const outcome = await attemptBooking({
      db,
      accountId: 'acct-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      ownerUserId: 'user-1',
      agentId: 'agent-1',
      agentName: 'Agendamento',
      booking: BOOKING,
    })
    expect(outcome).toEqual({ ok: false, reason: 'agenda_not_configured', alternatives: [] })
    expect(attemptsOf(inserts)).toHaveLength(1)
    expect(attemptsOf(inserts)[0].outcome).toBe('no_availability')
  })

  it('fails with invalid_datetime for a malformed whenRaw', async () => {
    h.listFreeSlots.mockResolvedValue({ slotDurationMinutes: 60, slots: [] })
    const { db } = fakeDb({})
    const outcome = await attemptBooking({
      db,
      accountId: 'acct-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      ownerUserId: 'user-1',
      agentId: 'agent-1',
      agentName: 'Agendamento',
      booking: { whenRaw: 'not-a-date', email: null, subject: null },
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('invalid_datetime')
  })

  it('rejects a requested time that is not in the fresh availability list', async () => {
    h.listFreeSlots.mockResolvedValue({
      slotDurationMinutes: 60,
      slots: [freeSlotFor('2026-09-10', '15:00')],
    })
    const { db, inserts } = fakeDb({})
    const outcome = await attemptBooking({
      db,
      accountId: 'acct-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      ownerUserId: 'user-1',
      agentId: 'agent-1',
      agentName: 'Agendamento',
      booking: BOOKING,
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('not_available')
    expect(outcome.alternatives).toHaveLength(1)
    expect(attemptsOf(inserts)[0].outcome).toBe('rejected')
  })

  it('books the appointment when the requested time matches a free slot', async () => {
    h.listFreeSlots.mockResolvedValue({
      slotDurationMinutes: 60,
      slots: [freeSlotFor('2026-09-10', '14:00')],
    })
    const { db, inserts, updates } = fakeDb({
      contact: { name: 'Ana', phone: '5511999999999', email: null },
      account: { default_currency: 'BRL' },
      dealInsert: { data: { id: 'deal-9' }, error: null },
      profiles: [{ user_id: 'owner-1' }],
    })
    const outcome = await attemptBooking({
      db,
      accountId: 'acct-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      ownerUserId: 'user-1',
      agentId: 'agent-1',
      agentName: 'Agendamento',
      booking: BOOKING,
    })
    expect(outcome).toMatchObject({ ok: true, dealId: 'deal-9' })

    const dealInserts = inserts.filter((i) => i.table === 'deals')
    expect(dealInserts).toHaveLength(1)
    expect(dealInserts[0].row).toMatchObject({
      pipeline_id: 'pipe-1',
      stage_id: 'stage-1',
      contact_id: 'contact-1',
      conversation_id: 'conv-1',
      title: 'Reunião sobre CRM',
      status: 'open',
      scheduled_at: freeSlotFor('2026-09-10', '14:00').startsAt.toISOString(),
    })

    const contactUpdates = updates.filter((u) => u.table === 'contacts')
    expect(contactUpdates).toEqual([{ table: 'contacts', row: { email: 'joao@empresa.com' } }])

    expect(inserts.filter((i) => i.table === 'notifications')).toHaveLength(1)
    expect(attemptsOf(inserts)[0].outcome).toBe('booked')
  })

  it('does not overwrite an existing contact email', async () => {
    h.listFreeSlots.mockResolvedValue({
      slotDurationMinutes: 60,
      slots: [freeSlotFor('2026-09-10', '14:00')],
    })
    const { db, updates } = fakeDb({
      contact: { name: 'Ana', phone: '5511999999999', email: 'ja-tinha@empresa.com' },
      account: { default_currency: 'BRL' },
      dealInsert: { data: { id: 'deal-9' }, error: null },
      profiles: [],
    })
    await attemptBooking({
      db,
      accountId: 'acct-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      ownerUserId: 'user-1',
      agentId: 'agent-1',
      agentName: 'Agendamento',
      booking: BOOKING,
    })
    expect(updates.filter((u) => u.table === 'contacts')).toHaveLength(0)
  })

  it('reports slot_just_taken on a unique-violation race at insert time', async () => {
    h.listFreeSlots.mockResolvedValue({
      slotDurationMinutes: 60,
      slots: [freeSlotFor('2026-09-10', '14:00')],
    })
    const { db, inserts } = fakeDb({
      contact: { name: 'Ana' },
      account: { default_currency: 'BRL' },
      dealInsert: { data: null, error: { code: '23505' } },
    })
    const outcome = await attemptBooking({
      db,
      accountId: 'acct-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      ownerUserId: 'user-1',
      agentId: 'agent-1',
      agentName: 'Agendamento',
      booking: BOOKING,
    })
    expect(outcome).toMatchObject({ ok: false, reason: 'slot_just_taken' })
    expect(attemptsOf(inserts)[0].outcome).toBe('rejected')
  })
})

describe('textTimeMismatchesBooking', () => {
  it('flags a reply that states a different time than it books', () => {
    expect(
      textTimeMismatchesBooking(
        'Perfeito! Confirmado segunda-feira, 07/09 às 09:00.',
        '2026-09-07T08:00',
      ),
    ).toBe(true)
  })

  it('does not flag a reply whose stated time matches the booking', () => {
    expect(
      textTimeMismatchesBooking(
        'Perfeito! Confirmado segunda-feira, 07/09 às 08:00.',
        '2026-09-07T08:00',
      ),
    ).toBe(false)
  })

  it('recognizes the "9h" style alongside "09:00"', () => {
    expect(textTimeMismatchesBooking('Combinado às 8h!', '2026-09-07T08:00')).toBe(false)
    expect(textTimeMismatchesBooking('Combinado às 9h!', '2026-09-07T08:00')).toBe(true)
  })

  it('is conservative when no time is mentioned', () => {
    expect(textTimeMismatchesBooking('Perfeito, combinado!', '2026-09-07T08:00')).toBe(false)
  })

  it('is conservative when more than one time is mentioned', () => {
    expect(
      textTimeMismatchesBooking(
        'Consigo às 08:00 ou às 09:00, qual prefere?',
        '2026-09-07T08:00',
      ),
    ).toBe(false)
  })
})
