import { describe, it, expect } from 'vitest'
import { dueReminderKinds, isReminderShapedTemplate } from './reminders'

const NOW = new Date('2026-09-10T12:00:00.000Z')
const STOP_STAGE = 'stage-done'
const OPEN_STAGE = 'stage-agendado'

const baseSettings = {
  first_offset_minutes: 24 * 60,
  second_offset_minutes: 2 * 60,
  stop_stage_ids: [STOP_STAGE],
}

function deal(overrides: Partial<{ scheduled_at: string; created_at: string; stage_id: string }>) {
  return {
    scheduled_at: '2026-09-11T12:00:00.000Z', // exactly 24h after NOW
    created_at: '2026-09-01T00:00:00.000Z', // booked well in advance
    stage_id: OPEN_STAGE,
    ...overrides,
  }
}

describe('dueReminderKinds', () => {
  it('fires the first reminder exactly at the offset window', () => {
    expect(dueReminderKinds(deal({}), baseSettings, NOW)).toEqual(['first'])
  })

  it('fires nothing before the window opens', () => {
    const d = deal({ scheduled_at: '2026-09-12T12:00:00.000Z' }) // 48h out
    expect(dueReminderKinds(d, baseSettings, NOW)).toEqual([])
  })

  it('fires both kinds once both windows have opened', () => {
    const d = deal({ scheduled_at: '2026-09-10T13:30:00.000Z' }) // 1.5h out
    expect(dueReminderKinds(d, baseSettings, NOW)).toEqual(['first', 'second'])
  })

  it('never fires for a past appointment', () => {
    const d = deal({ scheduled_at: '2026-09-10T11:00:00.000Z' }) // 1h ago
    expect(dueReminderKinds(d, baseSettings, NOW)).toEqual([])
  })

  it('stops on a stop stage even if the window is open', () => {
    const d = deal({ stage_id: STOP_STAGE })
    expect(dueReminderKinds(d, baseSettings, NOW)).toEqual([])
  })

  it('skips a reminder whose window opened before the card was created (short-notice booking)', () => {
    // Booked 1h ago for 3h from now — the 24h-before window "opened"
    // long before the card existed, so the first reminder never fires;
    // the second (2h) window opens 1h from now, also not fired yet.
    const d = deal({
      created_at: '2026-09-10T11:00:00.000Z',
      scheduled_at: '2026-09-10T15:00:00.000Z',
    })
    expect(dueReminderKinds(d, baseSettings, NOW)).toEqual([])
  })

  it('ignores a disabled offset (null)', () => {
    const settings = { ...baseSettings, second_offset_minutes: null }
    const d = deal({ scheduled_at: '2026-09-10T13:30:00.000Z' }) // 1.5h out — second would be due
    expect(dueReminderKinds(d, settings, NOW)).toEqual(['first'])
  })

  it('reschedule reopens eligibility: a later scheduled_at with the same deal is evaluated fresh', () => {
    const original = deal({ scheduled_at: '2026-09-10T13:30:00.000Z' })
    expect(dueReminderKinds(original, baseSettings, NOW)).toEqual(['first', 'second'])

    // Reschedule far into the future — created_at (the booking's
    // original creation time) stays the same, but the new scheduled_at
    // is what the ledger's UNIQUE(deal_id, kind, scheduled_at) keys on,
    // so this is a brand new key, not a conflict with the old one.
    const rescheduled = deal({ scheduled_at: '2026-09-20T12:00:00.000Z' })
    expect(dueReminderKinds(rescheduled, baseSettings, NOW)).toEqual([])
    expect(rescheduled.scheduled_at).not.toBe(original.scheduled_at)
  })
})

describe('isReminderShapedTemplate', () => {
  it('accepts exactly 3 body variables and 2+ quick-reply buttons', () => {
    expect(
      isReminderShapedTemplate({
        body_text: 'Olá {{1}}, seu compromisso é em {{2}} às {{3}}.',
        buttons: [{ type: 'QUICK_REPLY', text: 'Confirmar' }, { type: 'QUICK_REPLY', text: 'Remarcar' }],
      }),
    ).toBe(true)
  })

  it('rejects a template with the wrong variable count', () => {
    expect(
      isReminderShapedTemplate({
        body_text: 'Olá {{1}}, seu compromisso está marcado.',
        buttons: [{ type: 'QUICK_REPLY', text: 'Confirmar' }, { type: 'QUICK_REPLY', text: 'Remarcar' }],
      }),
    ).toBe(false)
  })

  it('rejects a template with fewer than 2 quick-reply buttons', () => {
    expect(
      isReminderShapedTemplate({
        body_text: 'Olá {{1}}, seu compromisso é em {{2}} às {{3}}.',
        buttons: [{ type: 'QUICK_REPLY', text: 'Confirmar' }],
      }),
    ).toBe(false)
  })

  it('rejects a template with no buttons at all', () => {
    expect(
      isReminderShapedTemplate({
        body_text: 'Olá {{1}}, seu compromisso é em {{2}} às {{3}}.',
        buttons: null,
      }),
    ).toBe(false)
  })
})
