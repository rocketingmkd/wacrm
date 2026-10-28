import { NextResponse } from 'next/server'
import { requireFeature, toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/ai/radar
 *
 * Copiloto IA radar for the caller's account: the open insights
 * (bottleneck / quality / opportunity), the 30 most recently resolved
 * ones, and the last scan run. Read-only; RLS scopes everything to the
 * account. agent+, Pro plan (aiCopilot).
 */

const INSIGHT_COLUMNS =
  'id, kind, severity, title, description, evidence, created_at, updated_at, resolved_at, ' +
  'conversation:conversations(id, status, last_message_at, contact:contacts(id, name, phone, avatar_url, is_group))'

export async function GET() {
  try {
    const { supabase } = await requireFeature('agent', 'aiCopilot')

    const [open, resolved, run] = await Promise.all([
      supabase
        .from('copilot_insights')
        .select(INSIGHT_COLUMNS)
        .is('resolved_at', null)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('copilot_insights')
        .select(INSIGHT_COLUMNS)
        .not('resolved_at', 'is', null)
        .order('resolved_at', { ascending: false })
        .limit(30),
      supabase
        .from('copilot_scan_runs')
        .select(
          'created_at, ai_status, ai_error, conversations_analyzed, insights_created, insights_resolved',
        )
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    if (open.error || resolved.error) {
      console.error('[radar] list failed:', open.error ?? resolved.error)
      return NextResponse.json(
        { error: 'Não foi possível carregar o radar' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      open: open.data ?? [],
      resolved: resolved.data ?? [],
      lastRun: run.data ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
