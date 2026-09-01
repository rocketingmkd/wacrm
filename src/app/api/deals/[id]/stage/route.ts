import { NextResponse, after } from 'next/server'
import { requireWrite, toErrorResponse } from '@/lib/auth/account'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchEventToFlows } from '@/lib/flows/engine'

/**
 * Move one deal to another pipeline stage, server-side, and fire the
 * `deal_stage_changed` automation trigger.
 *
 * Why a route at all: the pipeline board, the deal form and the AI
 * copilot all used to write `deals.stage_id` straight from the browser
 * Supabase client. The automation engine only runs server-side (service
 * role), so a client-only write can never dispatch a trigger. Every
 * stage-change entry point now goes through here.
 *
 * The write itself uses the caller's RLS-scoped client — same tenancy
 * and `deals` write policy the direct update had. `requireWrite` adds
 * the billing-lock 402. The trigger dispatch runs in `after()` so a
 * slow automation never blocks the drag-and-drop response.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let ctx
  try {
    ctx = await requireWrite('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  const stageId = body?.stage_id
  if (typeof stageId !== 'string' || !stageId) {
    return NextResponse.json({ error: 'stage_id is required' }, { status: 400 })
  }

  const { data: deal, error: readErr } = await ctx.supabase
    .from('deals')
    .select('id, account_id, pipeline_id, stage_id, contact_id')
    .eq('id', id)
    .maybeSingle()
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 })
  }
  if (!deal) {
    // RLS-filtered out, or genuinely gone — same 404 either way.
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const fromStageId = deal.stage_id as string
  if (fromStageId === stageId) {
    // No-op move — never dispatch. Keeps a re-drop onto the same column,
    // or a form save that didn't touch the stage, from firing a cadence.
    return NextResponse.json({ ok: true, unchanged: true })
  }

  const { error: updErr } = await ctx.supabase
    .from('deals')
    .update({ stage_id: stageId })
    .eq('id', id)
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  after(async () => {
    // A deal with no contact has no one to message — skip the dispatch
    // rather than queue a cadence whose Send steps would all fail.
    if (!deal.contact_id) return
    await runAutomationsForTrigger({
      accountId: deal.account_id as string,
      triggerType: 'deal_stage_changed',
      contactId: deal.contact_id as string,
      context: {
        deal_id: id,
        pipeline_id: deal.pipeline_id as string,
        stage_id: stageId,
        from_stage_id: fromStageId,
        cadence_started_at: new Date().toISOString(),
      },
    }).catch((err) =>
      console.error('[deals/stage] automation dispatch failed:', err),
    )
    // No forced exclusivity with the automation dispatch above — see
    // the same note at the tag_added dispatch site in
    // src/lib/contacts/tag-events.ts.
    await dispatchEventToFlows({
      accountId: deal.account_id as string,
      contactId: deal.contact_id as string,
      event: {
        type: 'deal_stage_changed',
        deal_id: id,
        pipeline_id: deal.pipeline_id as string,
        stage_id: stageId,
        from_stage_id: fromStageId,
      },
    }).catch((err) =>
      console.error('[deals/stage] flow dispatch failed:', err),
    )
  })

  return NextResponse.json({ ok: true })
}
