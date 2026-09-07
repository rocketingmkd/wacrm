import type { SupabaseClient } from '@supabase/supabase-js'
import { moveDealStage, dispatchDealStageChanged } from '@/lib/deals/move-stage'
import { activateAgentAndReply } from '@/lib/ai/auto-reply'
import { notifyHandoffToTeam } from '@/lib/ai/handoff-notify'

/**
 * Handles a customer tapping one of the two quick-reply buttons on an
 * appointment reminder (src/lib/agenda/reminders.ts). The button's
 * payload — `AGENDA_CONFIRM:<dealId>:<kind>` or
 * `AGENDA_RESCHEDULE:<dealId>` — is what reminders.ts set as the
 * override at send time, so the webhook's `interactiveReplyId` for a
 * template quick-reply tap round-trips straight back to the deal.
 */

const CONFIRM_PREFIX = 'AGENDA_CONFIRM:'
const RESCHEDULE_PREFIX = 'AGENDA_RESCHEDULE:'

export function isReminderButtonReply(replyId: string | null | undefined): boolean {
  if (!replyId) return false
  return replyId.startsWith(CONFIRM_PREFIX) || replyId.startsWith(RESCHEDULE_PREFIX)
}

export async function handleReminderButtonTap(args: {
  db: SupabaseClient
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
  replyId: string
}): Promise<void> {
  const { db, accountId, conversationId, contactId, configOwnerUserId, replyId } = args
  try {
    if (replyId.startsWith(CONFIRM_PREFIX)) {
      const dealId = replyId.slice(CONFIRM_PREFIX.length).split(':')[0]
      if (dealId) await handleConfirm(db, accountId, dealId)
      return
    }
    if (replyId.startsWith(RESCHEDULE_PREFIX)) {
      const dealId = replyId.slice(RESCHEDULE_PREFIX.length)
      if (dealId) {
        await handleReschedule(db, { accountId, conversationId, contactId, configOwnerUserId, dealId })
      }
      return
    }
  } catch (err) {
    console.error('[agenda] handleReminderButtonTap failed:', err)
  }
}

async function handleConfirm(db: SupabaseClient, accountId: string, dealId: string): Promise<void> {
  const { data: deal } = await db
    .from('deals')
    .select('id')
    .eq('id', dealId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!deal) return

  const { data: settings } = await db
    .from('agenda_reminder_settings')
    .select('stage_after_confirm_id')
    .eq('account_id', accountId)
    .maybeSingle()
  const stageId = settings?.stage_after_confirm_id as string | null | undefined
  if (!stageId) return

  const move = await moveDealStage({ db, dealId, accountId, toStageId: stageId })
  if (move.ok && move.move) {
    await dispatchDealStageChanged(move.move)
  }
}

async function handleReschedule(
  db: SupabaseClient,
  args: {
    accountId: string
    conversationId: string
    contactId: string
    configOwnerUserId: string
    dealId: string
  },
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  const { data: agent } = await db
    .from('ai_agents')
    .select('id')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .eq('can_schedule', true)
    .limit(1)
    .maybeSingle()

  if (agent?.id) {
    try {
      await activateAgentAndReply({
        accountId,
        conversationId,
        contactId,
        configOwnerUserId,
        agentId: agent.id as string,
      })
      return
    } catch (err) {
      console.error('[agenda] reschedule: activateAgentAndReply failed:', err)
    }
  }

  await notifyHandoffToTeam(db, {
    accountId,
    conversationId,
    contactId,
    assignedAgentId: null,
    summary:
      'Cliente pediu para remarcar pelo lembrete de compromisso, mas não há agente de IA com permissão de agendar configurado (ou o agente falhou).',
  })
  await notifyRescheduleFallback(db, { accountId, conversationId, contactId })
}

async function notifyRescheduleFallback(
  db: SupabaseClient,
  args: { accountId: string; conversationId: string; contactId: string },
): Promise<void> {
  try {
    const { data: members, error } = await db
      .from('profiles')
      .select('user_id')
      .eq('account_id', args.accountId)
      .in('account_role', ['owner', 'admin', 'agent'])
    if (error) {
      console.error('[agenda] notifyRescheduleFallback member lookup failed:', error)
      return
    }
    if (!members || members.length === 0) return

    const rows = members.map((m) => ({
      account_id: args.accountId,
      user_id: m.user_id as string,
      type: 'agenda_reminder_reschedule',
      conversation_id: args.conversationId,
      contact_id: args.contactId,
      actor_user_id: null,
      title: 'Cliente pediu para remarcar',
      body: 'Tocou em "Remarcar" no lembrete de compromisso, e não há agente de IA de agendamento disponível pra assumir.',
    }))

    const { error: insErr } = await db.from('notifications').insert(rows)
    if (insErr) console.error('[agenda] notifyRescheduleFallback insert failed:', insErr)
  } catch (err) {
    console.error('[agenda] notifyRescheduleFallback failed:', err)
  }
}
