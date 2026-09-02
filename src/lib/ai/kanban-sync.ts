import type { SupabaseClient } from '@supabase/supabase-js'
import { moveDealStage, dispatchDealStageChanged } from '@/lib/deals/move-stage'

/**
 * Keeps a pipeline card in step with who is handling the conversation:
 *
 *   - the AI sends a reply        → card moves to the "AI" stage
 *                                   (creating the deal if there isn't one)
 *   - the AI hands off to a human → card moves to the "human" stage
 *
 * The human-takeover-by-a-person case is handled in SQL instead (trigger
 * `on_conversation_human_takeover`, migration 051) so it covers every
 * assignment entry point at once.
 *
 * Everything here is best-effort and never throws — it runs fire-and-
 * forget from the auto-reply engine, whose contract is that a failure
 * must not affect the webhook's 200 to Meta. A no-op for any account
 * that hasn't filled in `ai_kanban_config`.
 */

interface KanbanConfig {
  accountId: string
  pipelineId: string
  stageIaId: string | null
  stageHumanId: string | null
  stageDoneId: string | null
  enabled: boolean
}

export async function loadKanbanConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<KanbanConfig | null> {
  const { data, error } = await db
    .from('ai_kanban_config')
    .select('pipeline_id, stage_ia_id, stage_human_id, stage_done_id, enabled')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) {
    console.error('[ai kanban] loadKanbanConfig failed:', error)
    return null
  }
  if (!data) return null
  return {
    accountId,
    pipelineId: data.pipeline_id as string,
    stageIaId: (data.stage_ia_id as string | null) ?? null,
    stageHumanId: (data.stage_human_id as string | null) ?? null,
    stageDoneId: (data.stage_done_id as string | null) ?? null,
    enabled: Boolean(data.enabled),
  }
}

interface OpenDeal {
  id: string
  stage_id: string
}

/** The open deal for this conversation's contact in the configured
 *  pipeline. Prefers one already linked to this exact conversation,
 *  then falls back to any open deal the contact has in that pipeline
 *  (matches the "one card per contact per funnel" model the inbox's
 *  own pipeline menu uses). */
async function findOpenFunnelDeal(
  db: SupabaseClient,
  cfg: KanbanConfig,
  conversationId: string,
  contactId: string,
): Promise<OpenDeal | null> {
  const byConversation = await db
    .from('deals')
    .select('id, stage_id')
    .eq('account_id', cfg.accountId)
    .eq('pipeline_id', cfg.pipelineId)
    .eq('status', 'open')
    .eq('conversation_id', conversationId)
    .limit(1)
    .maybeSingle()
  if (byConversation.data) return byConversation.data as OpenDeal

  const byContact = await db
    .from('deals')
    .select('id, stage_id')
    .eq('account_id', cfg.accountId)
    .eq('pipeline_id', cfg.pipelineId)
    .eq('status', 'open')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (byContact.data as OpenDeal | null) ?? null
}

async function createFunnelDeal(
  db: SupabaseClient,
  cfg: KanbanConfig,
  args: { conversationId: string; contactId: string; ownerUserId: string },
): Promise<void> {
  const [{ data: contact }, { data: acct }] = await Promise.all([
    db
      .from('contacts')
      .select('name, phone, wa_username')
      .eq('id', args.contactId)
      .maybeSingle(),
    db
      .from('accounts')
      .select('default_currency')
      .eq('id', cfg.accountId)
      .maybeSingle(),
  ])

  const title =
    contact?.name || contact?.phone || contact?.wa_username || 'Lead'

  const { error } = await db.from('deals').insert({
    account_id: cfg.accountId,
    user_id: args.ownerUserId,
    pipeline_id: cfg.pipelineId,
    // Land it straight in the AI stage — a brand-new card just appears
    // in that column. (An existing card visibly *moves*, and that move
    // fires deal_stage_changed; a fresh insert does not.)
    stage_id: cfg.stageIaId,
    contact_id: args.contactId,
    conversation_id: args.conversationId,
    title,
    value: 0,
    currency: acct?.default_currency ?? 'USD',
    status: 'open',
  })
  if (error) console.error('[ai kanban] createFunnelDeal failed:', error)
}

/**
 * Called after the AI sends a customer-facing reply. Ensures the
 * contact has a card in the configured pipeline and that it sits in the
 * "AI" stage. Idempotent — a no-op when the card is already there.
 */
export async function syncDealToAiStage(args: {
  db: SupabaseClient
  accountId: string
  conversationId: string
  contactId: string
  /** `deals.user_id` for a card this may have to create — the account's
   *  WhatsApp config owner, mirroring how the automation engine stamps
   *  automation-created deals. */
  ownerUserId: string
}): Promise<void> {
  try {
    const cfg = await loadKanbanConfig(args.db, args.accountId)
    if (!cfg || !cfg.enabled || !cfg.stageIaId) return

    const deal = await findOpenFunnelDeal(
      args.db,
      cfg,
      args.conversationId,
      args.contactId,
    )

    if (!deal) {
      await createFunnelDeal(args.db, cfg, {
        conversationId: args.conversationId,
        contactId: args.contactId,
        ownerUserId: args.ownerUserId,
      })
      return
    }

    if (deal.stage_id === cfg.stageIaId) return

    const result = await moveDealStage({
      db: args.db,
      dealId: deal.id,
      accountId: args.accountId,
      toStageId: cfg.stageIaId,
    })
    if (result.ok && result.move) void dispatchDealStageChanged(result.move)
  } catch (err) {
    console.error('[ai kanban] syncDealToAiStage failed:', err)
  }
}

/**
 * Called when the AI engine hands a thread to a human WITHOUT assigning
 * it to a specific queue (no `handoffAgentId`). The assign-to-a-queue
 * path is covered by the `on_conversation_human_takeover` DB trigger
 * instead, so this only has to handle the unassigned case.
 */
export async function moveFunnelDealToHumanStage(args: {
  db: SupabaseClient
  accountId: string
  conversationId: string
  contactId: string
}): Promise<void> {
  try {
    const cfg = await loadKanbanConfig(args.db, args.accountId)
    if (!cfg || !cfg.enabled || !cfg.stageHumanId) return

    const deal = await findOpenFunnelDeal(
      args.db,
      cfg,
      args.conversationId,
      args.contactId,
    )
    if (!deal || deal.stage_id === cfg.stageHumanId) return

    const result = await moveDealStage({
      db: args.db,
      dealId: deal.id,
      accountId: args.accountId,
      toStageId: cfg.stageHumanId,
    })
    if (result.ok && result.move) void dispatchDealStageChanged(result.move)
  } catch (err) {
    console.error('[ai kanban] moveFunnelDealToHumanStage failed:', err)
  }
}
