import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-side deal stage move, shared by every entry point that needs
 * the `deal_stage_changed` automation + flow triggers to fire:
 *   - PATCH /api/deals/[id]/stage  (drag-and-drop, deal form, copilot)
 *   - the AI auto-reply engine's pipeline sync (src/lib/ai/kanban-sync.ts)
 *
 * The DB write and the trigger fan-out are two calls on purpose:
 * `moveDealStage` does the write and returns a descriptor; the caller
 * then decides how to run `dispatchDealStageChanged` — the HTTP route
 * defers it to `after()` so a slow automation never blocks the drag
 * response, the AI engine fires it best-effort with `void`.
 */

export interface DealStageMove {
  dealId: string
  accountId: string
  pipelineId: string
  contactId: string | null
  fromStageId: string
  toStageId: string
}

type MoveResult =
  | { ok: true; move: DealStageMove | null }
  | { ok: false; status: number; error: string }

/**
 * Move one deal to `toStageId`, scoped to `accountId`. `move` is null
 * when the deal was already in that stage (no write, nothing to
 * dispatch). Never throws — DB errors come back as `{ ok: false }`.
 */
export async function moveDealStage(args: {
  db: SupabaseClient
  dealId: string
  accountId: string
  toStageId: string
}): Promise<MoveResult> {
  const { db, dealId, accountId, toStageId } = args

  const { data: deal, error: readErr } = await db
    .from('deals')
    .select('id, account_id, pipeline_id, stage_id, contact_id')
    .eq('id', dealId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (readErr) return { ok: false, status: 500, error: readErr.message }
  if (!deal) return { ok: false, status: 404, error: 'Not found' }

  const fromStageId = deal.stage_id as string
  if (fromStageId === toStageId) return { ok: true, move: null }

  const { error: updErr } = await db
    .from('deals')
    .update({ stage_id: toStageId })
    .eq('id', dealId)
    .eq('account_id', accountId)
  if (updErr) return { ok: false, status: 500, error: updErr.message }

  return {
    ok: true,
    move: {
      dealId,
      accountId,
      pipelineId: deal.pipeline_id as string,
      contactId: (deal.contact_id as string | null) ?? null,
      fromStageId,
      toStageId,
    },
  }
}

/**
 * Fire the `deal_stage_changed` automation trigger and flow event for a
 * completed move. Mirrors what PATCH /api/deals/[id]/stage used to do
 * inline. Best-effort: each dispatch swallows and logs its own error, a
 * deal with no contact is skipped (no one to message).
 *
 * The automations/flows engines are imported lazily to keep this module
 * out of their static import graph — both engines import back into the
 * AI auto-reply path, which imports this file.
 */
export async function dispatchDealStageChanged(move: DealStageMove): Promise<void> {
  if (!move.contactId) return

  const [{ runAutomationsForTrigger }, { dispatchEventToFlows }] = await Promise.all([
    import('@/lib/automations/engine'),
    import('@/lib/flows/engine'),
  ])

  await runAutomationsForTrigger({
    accountId: move.accountId,
    triggerType: 'deal_stage_changed',
    contactId: move.contactId,
    context: {
      deal_id: move.dealId,
      pipeline_id: move.pipelineId,
      stage_id: move.toStageId,
      from_stage_id: move.fromStageId,
      cadence_started_at: new Date().toISOString(),
    },
  }).catch((err) =>
    console.error('[deals/move-stage] automation dispatch failed:', err),
  )

  await dispatchEventToFlows({
    accountId: move.accountId,
    contactId: move.contactId,
    event: {
      type: 'deal_stage_changed',
      deal_id: move.dealId,
      pipeline_id: move.pipelineId,
      stage_id: move.toStageId,
      from_stage_id: move.fromStageId,
    },
  }).catch((err) =>
    console.error('[deals/move-stage] flow dispatch failed:', err),
  )
}
