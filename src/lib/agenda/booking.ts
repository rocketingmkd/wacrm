import type { SupabaseClient } from '@supabase/supabase-js'
import { listFreeSlots, loadAgendaConfig, type FreeSlot } from './availability'
import { zonedWallTimeToUtc } from './timezone'
import type { BookingRequest } from '@/lib/ai/types'

/**
 * Turns a `[[BOOK: ...]]` request the AI emitted into a real
 * appointment — or a clear, loggable reason it couldn't. Mirrors
 * `src/lib/ai/kanban-sync.ts`'s discipline: best-effort, never throws
 * (the auto-reply engine's contract is that nothing here may break the
 * customer-facing reply), and every attempt — success or failure —
 * leaves a row in `ai_booking_attempts` so an admin can see whether
 * the agent actually consulted the calendar before offering a time.
 */

/** How many days forward a booking REQUEST is allowed to reach — wider
 *  than the prompt's own display window (14 days) isn't useful since
 *  the model was never shown anything past that, but validation scans
 *  the same window with a generous limit so a legitimately-offered
 *  slot is never missed to a low `limit` truncation. */
const VALIDATION_WINDOW_DAYS = 14
const VALIDATION_SLOT_LIMIT = 1000

const TZ = 'America/Sao_Paulo'

export interface BookingOutcome {
  ok: boolean
  reason?: string
  dealId?: string
  /** Free slots at the moment of this attempt — surfaced so a failed
   *  attempt's retry (see auto-reply.ts) can hand the model a fresh
   *  list instead of just an error. */
  alternatives: FreeSlot[]
}

interface AttemptBookingArgs {
  db: SupabaseClient
  accountId: string
  conversationId: string
  contactId: string
  /** `deals.user_id` for the appointment — the account's WhatsApp
   *  config owner, same stamp `kanban-sync.ts` uses for AI-created
   *  deals. */
  ownerUserId: string
  agentId: string
  agentName: string
  booking: BookingRequest
}

export async function attemptBooking(args: AttemptBookingArgs): Promise<BookingOutcome> {
  const { db, accountId, conversationId, contactId, ownerUserId, agentId, agentName, booking } =
    args
  const requestedAt = new Date()

  try {
    const config = await loadAgendaConfig(db, accountId)
    if (!config) {
      const outcome: BookingOutcome = {
        ok: false,
        reason: 'agenda_not_configured',
        alternatives: [],
      }
      await logAttempt(db, {
        accountId,
        conversationId,
        contactId,
        agentId,
        agentName,
        requestedAt,
        outcome,
        booking,
      })
      return outcome
    }

    let requestedInstant: Date
    try {
      const [datePart, timePart] = booking.whenRaw.split('T')
      if (!datePart || !timePart) throw new Error('missing date or time part')
      requestedInstant = zonedWallTimeToUtc(datePart, timePart.slice(0, 5), TZ)
      if (Number.isNaN(requestedInstant.getTime())) throw new Error('invalid instant')
    } catch {
      const outcome: BookingOutcome = { ok: false, reason: 'invalid_datetime', alternatives: [] }
      await logAttempt(db, {
        accountId,
        conversationId,
        contactId,
        agentId,
        agentName,
        requestedAt,
        outcome,
        booking,
      })
      return outcome
    }

    // Re-run the SAME slot generation that produced the list the model
    // was shown — this is "did it consult the agenda", answered by
    // construction rather than trusted from the model's own claim.
    const fresh = await listFreeSlots(db, {
      accountId,
      days: VALIDATION_WINDOW_DAYS,
      limit: VALIDATION_SLOT_LIMIT,
      tz: TZ,
    })
    const offeredSlots = fresh?.slots ?? []
    const match = offeredSlots.find((s) => s.startsAt.getTime() === requestedInstant.getTime())

    if (!match) {
      const outcome: BookingOutcome = {
        ok: false,
        reason: 'not_available',
        alternatives: offeredSlots.slice(0, 5),
      }
      await logAttempt(db, {
        accountId,
        conversationId,
        contactId,
        agentId,
        agentName,
        requestedAt,
        outcome,
        booking,
      })
      return outcome
    }

    const [{ data: contact }, { data: acct }] = await Promise.all([
      db.from('contacts').select('name, phone, wa_username, email').eq('id', contactId).maybeSingle(),
      db.from('accounts').select('default_currency').eq('id', accountId).maybeSingle(),
    ])

    const title =
      booking.subject || contact?.name || contact?.phone || contact?.wa_username || 'Agendamento'

    const { data: inserted, error: insertErr } = await db
      .from('deals')
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        pipeline_id: config.pipelineId,
        stage_id: config.initialStageId,
        contact_id: contactId,
        conversation_id: conversationId,
        title,
        value: 0,
        currency: acct?.default_currency ?? 'BRL',
        status: 'open',
        scheduled_at: requestedInstant.toISOString(),
      })
      .select('id')
      .single()

    if (insertErr || !inserted) {
      // 23505 = unique_violation — `deals_one_per_slot` (migration 059)
      // caught a race: another conversation booked this exact instant
      // between our check above and this insert.
      const raced = (insertErr as { code?: string } | null)?.code === '23505'
      const outcome: BookingOutcome = {
        ok: false,
        reason: raced ? 'slot_just_taken' : 'insert_failed',
        alternatives: offeredSlots.filter((s) => s !== match).slice(0, 5),
      }
      if (!raced) console.error('[agenda] attemptBooking insert failed:', insertErr)
      await logAttempt(db, {
        accountId,
        conversationId,
        contactId,
        agentId,
        agentName,
        requestedAt,
        outcome,
        booking,
        offeredSlots,
      })
      return outcome
    }

    if (booking.email && !contact?.email) {
      const { error: emailErr } = await db
        .from('contacts')
        .update({ email: booking.email })
        .eq('id', contactId)
      if (emailErr) console.error('[agenda] attemptBooking email update failed:', emailErr)
    }

    void notifyBookingToTeam(db, {
      accountId,
      conversationId,
      contactId,
      title,
      scheduledAt: requestedInstant,
    })

    const outcome: BookingOutcome = { ok: true, dealId: inserted.id as string, alternatives: [] }
    await logAttempt(db, {
      accountId,
      conversationId,
      contactId,
      agentId,
      agentName,
      requestedAt,
      outcome,
      booking,
      offeredSlots,
    })
    return outcome
  } catch (err) {
    console.error('[agenda] attemptBooking failed:', err)
    const outcome: BookingOutcome = { ok: false, reason: 'error', alternatives: [] }
    await logAttempt(db, {
      accountId,
      conversationId,
      contactId,
      agentId,
      agentName,
      requestedAt,
      outcome,
      booking,
    }).catch(() => {})
    return outcome
  }
}

async function logAttempt(
  db: SupabaseClient,
  args: {
    accountId: string
    conversationId: string
    contactId: string
    agentId: string
    agentName: string
    requestedAt: Date
    outcome: BookingOutcome
    booking: BookingRequest
    offeredSlots?: FreeSlot[]
  },
): Promise<void> {
  try {
    const { error } = await db.from('ai_booking_attempts').insert({
      account_id: args.accountId,
      conversation_id: args.conversationId,
      contact_id: args.contactId,
      agent_id: args.agentId,
      agent_name: args.agentName,
      requested_at: args.requestedAt.toISOString(),
      outcome: args.outcome.ok
        ? 'booked'
        : args.outcome.reason === 'agenda_not_configured'
          ? 'no_availability'
          : args.outcome.reason === 'error'
            ? 'error'
            : 'rejected',
      reason: args.outcome.ok ? null : (args.outcome.reason ?? null),
      deal_id: args.outcome.dealId ?? null,
      offered_slots: (args.offeredSlots ?? args.outcome.alternatives).map((s) => ({
        token: s.token,
        label: s.label,
      })),
      payload: args.booking,
    })
    if (error) console.error('[agenda] ai_booking_attempts insert failed:', error)
  } catch (err) {
    console.error('[agenda] logAttempt failed:', err)
  }
}

/**
 * Tell the account's team the AI booked something on its own —
 * deliberately duplicated from `src/lib/ai/handoff-notify.ts`'s
 * member-lookup pattern rather than shared, since the two notify
 * different `notifications.type` values with different bodies and
 * this module has no reason to depend on the AI lib.
 */
async function notifyBookingToTeam(
  db: SupabaseClient,
  args: {
    accountId: string
    conversationId: string
    contactId: string
    title: string
    scheduledAt: Date
  },
): Promise<void> {
  try {
    const { data: members, error: membersErr } = await db
      .from('profiles')
      .select('user_id')
      .eq('account_id', args.accountId)
      .in('account_role', ['owner', 'admin', 'agent'])
    if (membersErr) {
      console.error('[agenda] notifyBookingToTeam member lookup failed:', membersErr)
      return
    }
    if (!members || members.length === 0) return

    const when = new Intl.DateTimeFormat('pt-BR', {
      timeZone: TZ,
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(args.scheduledAt)

    const rows = members.map((m) => ({
      account_id: args.accountId,
      user_id: m.user_id as string,
      type: 'ai_booked_appointment',
      conversation_id: args.conversationId,
      contact_id: args.contactId,
      actor_user_id: null,
      title: 'IA marcou um compromisso',
      body: `${args.title} — ${when}.`,
    }))

    const { error: insErr } = await db.from('notifications').insert(rows)
    if (insErr) console.error('[agenda] notifyBookingToTeam insert failed:', insErr)
  } catch (err) {
    console.error('[agenda] notifyBookingToTeam failed:', err)
  }
}
