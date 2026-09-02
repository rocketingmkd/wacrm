import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireWrite,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/ai/kanban
 *
 * Any member may read the account's AI-to-Kanban binding so the
 * settings screen can render it. Returns `{ configured: false }` when
 * nothing is set up yet.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data, error } = await supabase
      .from('ai_kanban_config')
      .select('pipeline_id, stage_ia_id, stage_human_id, stage_done_id, enabled')
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[ai/kanban GET] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load kanban config' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ configured: false })

    return NextResponse.json({
      configured: true,
      pipeline_id: data.pipeline_id,
      stage_ia_id: data.stage_ia_id,
      stage_human_id: data.stage_human_id,
      stage_done_id: data.stage_done_id,
      enabled: data.enabled,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/kanban  (admin+)
 *
 * Upsert the binding. Validates that the pipeline and every stage
 * referenced belong to the caller's account (the RLS-scoped client
 * only returns rows the account can see) and that each stage is a
 * stage OF the chosen pipeline.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireWrite('admin')

    const limit = checkRateLimit(`ai-kanban:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const pipelineId = typeof body.pipeline_id === 'string' ? body.pipeline_id : ''
    if (!pipelineId) return bad('pipeline_id is required')

    const stageIaId =
      typeof body.stage_ia_id === 'string' && body.stage_ia_id ? body.stage_ia_id : null
    const stageHumanId =
      typeof body.stage_human_id === 'string' && body.stage_human_id
        ? body.stage_human_id
        : null
    const stageDoneId =
      typeof body.stage_done_id === 'string' && body.stage_done_id
        ? body.stage_done_id
        : null
    const enabled = body.enabled === undefined ? true : body.enabled === true

    // Pipeline must be visible to this account.
    const { data: pipeline, error: plErr } = await supabase
      .from('pipelines')
      .select('id')
      .eq('id', pipelineId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (plErr) {
      console.error('[ai/kanban POST] pipeline check error:', plErr)
      return NextResponse.json({ error: 'Failed to validate pipeline' }, { status: 500 })
    }
    if (!pipeline) return bad('pipeline not found in this account')

    // Every referenced stage must belong to that pipeline.
    const stageIds = [stageIaId, stageHumanId, stageDoneId].filter(
      (s): s is string => Boolean(s),
    )
    if (stageIds.length > 0) {
      const { data: stages, error: stErr } = await supabase
        .from('pipeline_stages')
        .select('id')
        .eq('pipeline_id', pipelineId)
        .in('id', stageIds)
      if (stErr) {
        console.error('[ai/kanban POST] stage check error:', stErr)
        return NextResponse.json({ error: 'Failed to validate stages' }, { status: 500 })
      }
      const found = new Set((stages ?? []).map((s) => s.id as string))
      if (stageIds.some((s) => !found.has(s))) {
        return bad('one or more stages do not belong to the chosen pipeline')
      }
    }

    const row = {
      account_id: accountId,
      pipeline_id: pipelineId,
      stage_ia_id: stageIaId,
      stage_human_id: stageHumanId,
      stage_done_id: stageDoneId,
      enabled,
    }

    const { data: existing } = await supabase
      .from('ai_kanban_config')
      .select('account_id')
      .eq('account_id', accountId)
      .maybeSingle()

    if (existing) {
      const { error: upErr } = await supabase
        .from('ai_kanban_config')
        .update(row)
        .eq('account_id', accountId)
      if (upErr) {
        console.error('[ai/kanban POST] update error:', upErr)
        return NextResponse.json({ error: 'Failed to save kanban config' }, { status: 500 })
      }
    } else {
      const { error: insErr } = await supabase
        .from('ai_kanban_config')
        .insert({ ...row, created_by: userId })
      if (insErr) {
        console.error('[ai/kanban POST] insert error:', insErr)
        return NextResponse.json({ error: 'Failed to save kanban config' }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/kanban  (admin+)
 *
 * Removes the binding — the AI auto-reply engine stops touching the
 * pipeline entirely. Deals themselves are untouched.
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireWrite('admin')
    const { error } = await supabase
      .from('ai_kanban_config')
      .delete()
      .eq('account_id', accountId)
    if (error) {
      console.error('[ai/kanban DELETE] error:', error)
      return NextResponse.json({ error: 'Failed to delete kanban config' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
