import { NextResponse, after } from 'next/server'
import { requireWrite, toErrorResponse } from '@/lib/auth/account'
import { moveDealStage, dispatchDealStageChanged } from '@/lib/deals/move-stage'

/**
 * Move one deal to another pipeline stage, server-side, and fire the
 * `deal_stage_changed` automation trigger + flow event.
 *
 * Why a route at all: the pipeline board, the deal form and the AI
 * copilot all used to write `deals.stage_id` straight from the browser
 * Supabase client. The automation engine only runs server-side (service
 * role), so a client-only write can never dispatch a trigger. Every
 * stage-change entry point now goes through the shared `moveDealStage`
 * helper — this route for UI-driven moves, `src/lib/ai/kanban-sync.ts`
 * for the AI auto-reply engine.
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

  const result = await moveDealStage({
    db: ctx.supabase,
    dealId: id,
    accountId: ctx.accountId,
    toStageId: stageId,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  if (!result.move) {
    // No-op move — never dispatch. Keeps a re-drop onto the same column,
    // or a form save that didn't touch the stage, from firing a cadence.
    return NextResponse.json({ ok: true, unchanged: true })
  }

  const { move } = result
  after(() => dispatchDealStageChanged(move))

  return NextResponse.json({ ok: true })
}
