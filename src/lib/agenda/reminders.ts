import type { SupabaseClient } from '@supabase/supabase-js'
import type { MessageTemplate } from '@/types'
import { loadAgendaConfig } from './availability'
import { engineSendTemplate } from '@/lib/automations/meta-send'
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation'
import { moveDealStage, dispatchDealStageChanged } from '@/lib/deals/move-stage'
import { extractVariableIndices } from '@/lib/whatsapp/template-validators'

/**
 * The appointment-reminder engine (migration 061). Deliberately has no
 * concept of a persisted "next run time": it derives what's due
 * straight from `deals.scheduled_at` on every cron tick, and
 * `agenda_reminders` (the ledger table) exists only to make one
 * (deal, kind, scheduled_at) combination send at most once. A
 * reschedule changes `scheduled_at`, which is part of that key — so
 * the new appointment time is automatically eligible again with zero
 * recalculation code. See the migration's header comment for why the
 * earlier `wait`-step design was rejected.
 *
 * Reuses the same "move card, fire deal_stage_changed" primitive the
 * sales-pipeline Kanban already uses (`src/lib/deals/move-stage.ts`)
 * for the post-send stage move, instead of a second card-moving path.
 */

const TZ = 'America/Sao_Paulo'
const REMINDER_BODY_VAR_COUNT = 3
const MAX_ATTEMPTS = 3
/** A ledger row stuck at 'pending' this long is assumed to be an
 *  interrupted run (server restarted mid-send), not a live claim by a
 *  concurrent cron tick — safe to retry. */
const STALE_PENDING_MS = 10 * 60_000

export type ReminderKind = 'first' | 'second'

export interface ReminderSettings {
  account_id: string
  enabled: boolean
  template_id: string | null
  first_offset_minutes: number | null
  second_offset_minutes: number | null
  confirm_button_index: number
  reschedule_button_index: number
  stage_after_send_id: string | null
  stage_after_confirm_id: string | null
  stop_stage_ids: string[]
}

interface DealForReminder {
  id: string
  account_id: string
  pipeline_id: string
  stage_id: string
  contact_id: string | null
  scheduled_at: string
  created_at: string
}

// ------------------------------------------------------------
// Pure eligibility — no I/O, unit-tested directly.
// ------------------------------------------------------------

/**
 * Which reminder kinds are due for this deal right now. A kind is due
 * when its offset window opened (scheduled_at - offset <= now) AFTER
 * the deal was created — otherwise a compromisso booked with less
 * lead time than the offset (e.g. booked 3h out with a 24h-before
 * reminder configured) would fire immediately, which reads as a bug
 * to the customer ("lembrete" for something they just booked seconds
 * ago). A stop stage (Realizado, Não compareceu, …) or a
 * past/missing scheduled_at makes nothing due.
 */
export function dueReminderKinds(
  deal: Pick<DealForReminder, 'scheduled_at' | 'created_at' | 'stage_id'>,
  settings: Pick<ReminderSettings, 'first_offset_minutes' | 'second_offset_minutes' | 'stop_stage_ids'>,
  now: Date,
): ReminderKind[] {
  if (settings.stop_stage_ids.includes(deal.stage_id)) return []

  const scheduledAt = new Date(deal.scheduled_at)
  const createdAt = new Date(deal.created_at)
  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= now.getTime()) return []
  if (Number.isNaN(createdAt.getTime())) return []

  const due: ReminderKind[] = []
  const offsets: Array<[ReminderKind, number | null]> = [
    ['first', settings.first_offset_minutes],
    ['second', settings.second_offset_minutes],
  ]
  for (const [kind, offsetMinutes] of offsets) {
    if (offsetMinutes == null) continue
    const dueAt = scheduledAt.getTime() - offsetMinutes * 60_000
    if (dueAt <= now.getTime() && dueAt >= createdAt.getTime()) {
      due.push(kind)
    }
  }
  return due
}

/** A template is usable by this engine when it has exactly the 3 body
 *  variables (name, date, time) the send path always supplies, plus
 *  at least the 2 quick-reply buttons (confirm, reschedule) whose
 *  payload gets overridden per send. Extra quick-reply buttons beyond
 *  the configured indices are allowed (ignored). `buttons` accepts
 *  null (not just undefined) — the DB column is a nullable jsonb, and
 *  MessageTemplate's own type only declares `| undefined`. */
export function isReminderShapedTemplate(t: {
  body_text: string
  buttons?: MessageTemplate['buttons'] | null
}): boolean {
  const bodyVars = extractVariableIndices(t.body_text ?? '').length
  const quickReplyButtons = (t.buttons ?? []).filter((b) => b.type === 'QUICK_REPLY').length
  return bodyVars === REMINDER_BODY_VAR_COUNT && quickReplyButtons >= 2
}

// ------------------------------------------------------------
// Orchestration — one cron tick across every account with reminders on.
// ------------------------------------------------------------

export interface ProcessRemindersResult {
  processed: number
  failed: number
}

export async function processDueReminders(db: SupabaseClient): Promise<ProcessRemindersResult> {
  const now = new Date()

  const { data: settingsRows, error: settingsErr } = await db
    .from('agenda_reminder_settings')
    .select('*')
    .eq('enabled', true)
  if (settingsErr) {
    console.error('[agenda] reminders: settings lookup failed:', settingsErr)
    return { processed: 0, failed: 0 }
  }
  if (!settingsRows || settingsRows.length === 0) return { processed: 0, failed: 0 }

  let processed = 0
  let failed = 0
  for (const row of settingsRows as ReminderSettings[]) {
    const result = await processAccountReminders(db, row, now)
    processed += result.processed
    failed += result.failed
  }
  return { processed, failed }
}

async function processAccountReminders(
  db: SupabaseClient,
  settings: ReminderSettings,
  now: Date,
): Promise<ProcessRemindersResult> {
  let processed = 0
  let failed = 0

  const config = await loadAgendaConfig(db, settings.account_id)
  if (!config) return { processed, failed }

  const template = await resolveTemplate(db, settings)
  if (!template) return { processed, failed }

  const { data: waConfig } = await db
    .from('whatsapp_config')
    .select('user_id')
    .eq('account_id', settings.account_id)
    .maybeSingle()
  const ownerUserId = waConfig?.user_id as string | undefined
  if (!ownerUserId) return { processed, failed }

  const { data: deals, error: dealsErr } = await db
    .from('deals')
    .select('id, account_id, pipeline_id, stage_id, contact_id, scheduled_at, created_at')
    .eq('account_id', settings.account_id)
    .eq('pipeline_id', config.pipelineId)
    .neq('status', 'lost')
    .not('scheduled_at', 'is', null)
    .gt('scheduled_at', now.toISOString())
  if (dealsErr) {
    console.error('[agenda] reminders: deal lookup failed:', dealsErr)
    return { processed, failed }
  }
  if (!deals || deals.length === 0) return { processed, failed }

  for (const deal of deals as DealForReminder[]) {
    if (!deal.contact_id) continue
    const kinds = dueReminderKinds(deal, settings, now)
    for (const kind of kinds) {
      const outcome = await sendOneReminder(db, { settings, template, deal, kind, ownerUserId })
      if (outcome === 'sent') processed++
      else if (outcome === 'failed') failed++
    }
  }
  return { processed, failed }
}

async function resolveTemplate(
  db: SupabaseClient,
  settings: ReminderSettings,
): Promise<MessageTemplate | null> {
  if (settings.template_id) {
    const { data } = await db
      .from('message_templates')
      .select('*')
      .eq('id', settings.template_id)
      .eq('account_id', settings.account_id)
      .eq('status', 'APPROVED')
      .maybeSingle()
    return (data as MessageTemplate | null) ?? null
  }

  const { data: candidates } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', settings.account_id)
    .eq('category', 'Utility')
    .eq('status', 'APPROVED')

  const matches = ((candidates ?? []) as MessageTemplate[]).filter(isReminderShapedTemplate)
  // Ambiguous (0 or >1 candidates) → refuse to guess which one to send.
  // The Lembretes tab surfaces this as "escolha um template" instead.
  return matches.length === 1 ? matches[0] : null
}

/**
 * Claim the ledger row for (deal, kind, scheduled_at) — insert if new,
 * or reopen a retryable 'failed'/stuck-'pending' row. Returns null
 * when nothing should be sent (already sent, exhausted retries, or
 * genuinely claimed by a concurrent run).
 */
async function claimLedgerRow(
  db: SupabaseClient,
  args: { accountId: string; dealId: string; kind: ReminderKind; scheduledAt: string },
): Promise<{ id: string; attempts: number } | null> {
  const { data: existing, error: selErr } = await db
    .from('agenda_reminders')
    .select('id, status, attempts, created_at')
    .eq('deal_id', args.dealId)
    .eq('kind', args.kind)
    .eq('scheduled_at', args.scheduledAt)
    .maybeSingle()
  if (selErr) {
    console.error('[agenda] reminders: ledger lookup failed:', selErr)
    return null
  }

  if (!existing) {
    const { data: inserted, error: insErr } = await db
      .from('agenda_reminders')
      .insert({
        account_id: args.accountId,
        deal_id: args.dealId,
        kind: args.kind,
        scheduled_at: args.scheduledAt,
        status: 'pending',
      })
      .select('id')
      .single()
    if (insErr) {
      // 23505 = a concurrent tick inserted the same key first; let it own the send.
      if ((insErr as { code?: string }).code !== '23505') {
        console.error('[agenda] reminders: ledger insert failed:', insErr)
      }
      return null
    }
    return { id: inserted!.id as string, attempts: 0 }
  }

  if (existing.status === 'sent') return null
  if (existing.status === 'failed' && (existing.attempts as number) >= MAX_ATTEMPTS) return null
  if (existing.status === 'pending') {
    const staleMs = Date.now() - new Date(existing.created_at as string).getTime()
    if (staleMs < STALE_PENDING_MS) return null
  }

  const { data: claimed, error: claimErr } = await db
    .from('agenda_reminders')
    .update({ status: 'pending' })
    .eq('id', existing.id as string)
    .neq('status', 'sent')
    .select('id')
    .maybeSingle()
  if (claimErr || !claimed) return null
  return { id: existing.id as string, attempts: existing.attempts as number }
}

async function sendOneReminder(
  db: SupabaseClient,
  args: {
    settings: ReminderSettings
    template: MessageTemplate
    deal: DealForReminder
    kind: ReminderKind
    ownerUserId: string
  },
): Promise<'sent' | 'failed' | 'skipped'> {
  const { settings, template, deal, kind, ownerUserId } = args

  const claim = await claimLedgerRow(db, {
    accountId: settings.account_id,
    dealId: deal.id,
    kind,
    scheduledAt: deal.scheduled_at,
  })
  if (!claim) return 'skipped'

  try {
    const { data: contact, error: contactErr } = await db
      .from('contacts')
      .select('id, name, phone')
      .eq('id', deal.contact_id as string)
      .eq('account_id', settings.account_id)
      .maybeSingle()
    if (contactErr) throw new Error(contactErr.message)
    if (!contact?.phone) throw new Error('contact has no phone')

    const { conversationId } = await resolveConversationByPhone(
      db,
      settings.account_id,
      contact.phone as string,
      (contact.name as string) ?? null,
    )

    const scheduledAt = new Date(deal.scheduled_at)
    const dateLabel = new Intl.DateTimeFormat('pt-BR', {
      timeZone: TZ,
      day: '2-digit',
      month: '2-digit',
    }).format(scheduledAt)
    const timeLabel = new Intl.DateTimeFormat('pt-BR', {
      timeZone: TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(scheduledAt)
    const name = (contact.name as string) || ''

    const buttonParams: Record<number, string> = {
      [settings.confirm_button_index]: `AGENDA_CONFIRM:${deal.id}:${kind}`,
      [settings.reschedule_button_index]: `AGENDA_RESCHEDULE:${deal.id}`,
    }

    const { whatsapp_message_id } = await engineSendTemplate({
      accountId: settings.account_id,
      userId: ownerUserId,
      conversationId,
      contactId: contact.id as string,
      templateName: template.name,
      language: template.language || 'pt_BR',
      template,
      messageParams: { body: [name, dateLabel, timeLabel], buttonParams },
    })

    await db
      .from('agenda_reminders')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        whatsapp_message_id,
        attempts: claim.attempts + 1,
        error: null,
      })
      .eq('id', claim.id)

    await maybeAdvanceAfterSend(db, settings, deal)
    return 'sent'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[agenda] reminders: send failed for deal', deal.id, kind, msg)
    await db
      .from('agenda_reminders')
      .update({ status: 'failed', error: msg, attempts: claim.attempts + 1 })
      .eq('id', claim.id)
    return 'failed'
  }
}

async function maybeAdvanceAfterSend(
  db: SupabaseClient,
  settings: ReminderSettings,
  deal: DealForReminder,
): Promise<void> {
  if (!settings.stage_after_send_id) return
  if (deal.stage_id === settings.stage_after_send_id) return
  const move = await moveDealStage({
    db,
    dealId: deal.id,
    accountId: settings.account_id,
    toStageId: settings.stage_after_send_id,
  })
  if (move.ok && move.move) {
    await dispatchDealStageChanged(move.move)
  }
}
