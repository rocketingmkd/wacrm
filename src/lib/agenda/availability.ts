import type { SupabaseClient } from '@supabase/supabase-js'
import { zonedWallTimeToUtc, formatWallTimeToken, zonedDateString, formatSlotLabelPtBr } from './timezone'

/**
 * Reads the Agenda pipeline + availability configuration (migrations
 * 054/055) and turns them into the actual free slots the AI booking
 * agent may offer — the "booking logic" those migrations' comments
 * said didn't exist yet.
 *
 * Everything here is a pure reader: it never writes. `attemptBooking`
 * (./booking.ts) is what turns a chosen slot into a real `deals` row.
 */

const DEFAULT_SLOT_DURATION_MINUTES = 60
/** Never offer a slot closer than this to "now" — gives a human enough
 *  runway to see a same-day booking before it's due. */
const MIN_LEAD_MINUTES = 120
const DEFAULT_WINDOW_DAYS = 14
const DEFAULT_SLOT_LIMIT = 12

export interface AgendaConfig {
  pipelineId: string
  /** The stage a freshly-booked appointment lands in — the pipeline's
   *  lowest `position` stage (e.g. "Agendado"). */
  initialStageId: string
  slotDurationMinutes: number
}

/**
 * Resolve the account's scheduling pipeline + starting stage + slot
 * length. Returns `null` when the account has no Agenda pipeline yet,
 * or that pipeline has no stages — both mean "nothing to book against
 * here", and every caller treats that as a no-op rather than an error.
 */
export async function loadAgendaConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<AgendaConfig | null> {
  const { data: pipeline, error: pipelineErr } = await db
    .from('pipelines')
    .select('id')
    .eq('account_id', accountId)
    .eq('is_scheduling', true)
    .maybeSingle()
  if (pipelineErr) {
    console.error('[agenda] loadAgendaConfig pipeline lookup failed:', pipelineErr)
    return null
  }
  if (!pipeline) return null

  const { data: stage, error: stageErr } = await db
    .from('pipeline_stages')
    .select('id')
    .eq('pipeline_id', pipeline.id as string)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (stageErr) {
    console.error('[agenda] loadAgendaConfig stage lookup failed:', stageErr)
    return null
  }
  if (!stage) return null

  const { data: settings } = await db
    .from('agenda_availability_settings')
    .select('slot_duration_minutes')
    .eq('account_id', accountId)
    .maybeSingle()

  return {
    pipelineId: pipeline.id as string,
    initialStageId: stage.id as string,
    slotDurationMinutes:
      (settings?.slot_duration_minutes as number | undefined) ?? DEFAULT_SLOT_DURATION_MINUTES,
  }
}

export interface FreeSlot {
  /** The UTC instant this slot starts at. */
  startsAt: Date
  /** Exact "YYYY-MM-DDTHH:MM" wall-clock token the AI must echo back
   *  verbatim in `[[BOOK: quando=...]]` — round-trips through
   *  `zonedWallTimeToUtc` with no ambiguity. */
  token: string
  /** pt-BR human label, e.g. "quinta-feira, 10/09 às 14:00". */
  label: string
}

export interface FreeSlotsResult {
  slotDurationMinutes: number
  slots: FreeSlot[]
}

interface AvailabilityRuleRow {
  day_of_week: number
  start_time: string
  end_time: string
}

/**
 * The actual booking algorithm the migration 055 comment described:
 * for each day in the window, skip it if it's a full exception date,
 * otherwise cut that weekday's `availability_rules` ranges into
 * `slotDurationMinutes` chunks, drop anything too soon or already
 * booked, and stop once `limit` slots are collected.
 *
 * Deliberately the SAME function backs both "what do we tell the
 * customer" (the prompt injection in buildSystemPrompt) and "is what
 * they just confirmed actually still free" (attemptBooking re-runs
 * this right before writing) — one source of truth for what counts as
 * available, so a slot offered can never fail validation for a reason
 * other than "someone else just took it".
 *
 * Returns `null` when the account has no Agenda configured at all
 * (see `loadAgendaConfig`) — everything downstream treats that as "no
 * booking possible today", not an error.
 */
export async function listFreeSlots(
  db: SupabaseClient,
  args: {
    accountId: string
    /** "Now", for the lead-time cutoff and the window's start day.
     *  Injectable for deterministic tests. */
    from?: Date
    /** How many calendar days forward to scan. */
    days?: number
    /** Stop collecting once this many free slots are found. Pass a
     *  generous number (not the prompt's display limit) when
     *  validating a specific requested instant, so a real match late
     *  in the window is never missed. */
    limit?: number
    tz?: string
  },
): Promise<FreeSlotsResult | null> {
  const { accountId } = args
  const from = args.from ?? new Date()
  const days = args.days ?? DEFAULT_WINDOW_DAYS
  const limit = args.limit ?? DEFAULT_SLOT_LIMIT
  const tz = args.tz ?? 'America/Sao_Paulo'

  const config = await loadAgendaConfig(db, accountId)
  if (!config) return null

  const [{ data: rules }, { data: exceptions }] = await Promise.all([
    db
      .from('availability_rules')
      .select('day_of_week, start_time, end_time')
      .eq('account_id', accountId),
    db.from('availability_exceptions').select('date').eq('account_id', accountId),
  ])

  const rulesByDay = new Map<number, AvailabilityRuleRow[]>()
  for (const r of (rules ?? []) as AvailabilityRuleRow[]) {
    const list = rulesByDay.get(r.day_of_week) ?? []
    list.push(r)
    rulesByDay.set(r.day_of_week, list)
  }
  const exceptionDates = new Set(
    ((exceptions ?? []) as { date: string }[]).map((e) => e.date),
  )

  // Existing appointments on this pipeline within the window — an
  // exact-timestamp collision is what makes a generated slot "taken".
  // `deals_one_per_slot` (migration 059) is the same rule enforced at
  // the database level as a race backstop.
  const windowEnd = new Date(from.getTime() + days * 24 * 60 * 60 * 1000)
  const { data: booked } = await db
    .from('deals')
    .select('scheduled_at')
    .eq('pipeline_id', config.pipelineId)
    .neq('status', 'lost')
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', from.toISOString())
    .lte('scheduled_at', windowEnd.toISOString())
  const bookedTimes = new Set(
    ((booked ?? []) as { scheduled_at: string }[]).map((b) => new Date(b.scheduled_at).getTime()),
  )

  const earliestMs = from.getTime() + MIN_LEAD_MINUTES * 60 * 1000
  const startDateStr = zonedDateString(from, tz)
  const [startYear, startMonth, startDay] = startDateStr.split('-').map(Number)

  const slots: FreeSlot[] = []
  for (let i = 0; i < days && slots.length < limit; i++) {
    // Stepping through UTC-midnight calendar days here is safe: we
    // only ever read the (year, month, day) triple back out to look
    // up the weekday and the exception-date string, never the instant
    // itself — a plain Gregorian date has the same weekday everywhere.
    const dayUtc = new Date(Date.UTC(startYear, startMonth - 1, startDay + i))
    const dateStr = dayUtc.toISOString().slice(0, 10)
    if (exceptionDates.has(dateStr)) continue

    const ranges = rulesByDay.get(dayUtc.getUTCDay()) ?? []
    for (const range of ranges) {
      const [startH, startM] = range.start_time.slice(0, 5).split(':').map(Number)
      const [endH, endM] = range.end_time.slice(0, 5).split(':').map(Number)
      let cursorMin = startH * 60 + startM
      const endMin = endH * 60 + endM

      while (cursorMin + config.slotDurationMinutes <= endMin) {
        if (slots.length >= limit) break
        const hh = String(Math.floor(cursorMin / 60)).padStart(2, '0')
        const mm = String(cursorMin % 60).padStart(2, '0')
        const startsAt = zonedWallTimeToUtc(dateStr, `${hh}:${mm}`, tz)

        if (startsAt.getTime() >= earliestMs && !bookedTimes.has(startsAt.getTime())) {
          slots.push({
            startsAt,
            token: formatWallTimeToken(startsAt, tz),
            label: formatSlotLabelPtBr(startsAt, tz),
          })
        }
        cursorMin += config.slotDurationMinutes
      }
    }
  }

  return { slotDurationMinutes: config.slotDurationMinutes, slots }
}
