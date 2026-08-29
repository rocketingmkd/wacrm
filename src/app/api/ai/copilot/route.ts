import { NextResponse } from 'next/server'
import { requireRole, requireWrite, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { refreshConversationInsight } from '@/lib/ai/copilot-refresh'
import type { CopilotInsight } from '@/lib/ai/copilot'

/**
 * "Gerente IA" copilot insight for one conversation.
 *
 *   GET  ?conversation_id=…      → the cached insight (no LLM call)
 *   POST { conversation_id, force? } → refresh it (LLM call only when
 *                                      the thread moved, or force=true)
 *
 * agent+ ; RLS scopes the caller to their account, so a conversation
 * from another account reads as "not found".
 */

async function resolveConversationAccount(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  conversationId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .maybeSingle()
  return Boolean(data)
}

function serialize(
  row: {
    insight: CopilotInsight
    generatedAt: string
    msgCountAtGen: number
    model: string | null
  } | null,
) {
  if (!row) return { insight: null }
  return {
    insight: row.insight,
    generated_at: row.generatedAt,
    msg_count_at_gen: row.msgCountAtGen,
    model: row.model,
  }
}

export async function GET(request: Request) {
  try {
    const { supabase } = await requireRole('agent')
    const conversationId =
      new URL(request.url).searchParams.get('conversation_id') ?? ''
    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversation_id is required' },
        { status: 400 },
      )
    }
    if (!(await resolveConversationAccount(supabase, conversationId))) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const { data } = await supabase
      .from('conversation_insights')
      .select('payload, generated_at, msg_count_at_gen, model')
      .eq('conversation_id', conversationId)
      .maybeSingle()

    if (!data) return NextResponse.json({ insight: null })
    return NextResponse.json({
      insight: data.payload as CopilotInsight,
      generated_at: data.generated_at,
      msg_count_at_gen: data.msg_count_at_gen,
      model: data.model,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    // Refreshing calls the LLM and writes conversation_insights — a
    // write. GET above stays on requireRole: reading a cached insight
    // must keep working for a read-only (billing-locked) account.
    const { supabase, accountId, userId } = await requireWrite('agent')

    const userLimit = checkRateLimit(`ai-copilot:${userId}`, RATE_LIMITS.aiCopilot)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const acctLimit = checkRateLimit(
      `ai-copilot-acct:${accountId}`,
      RATE_LIMITS.aiCopilotAccount,
    )
    if (!acctLimit.success) return rateLimitResponse(acctLimit)

    const body = await request.json().catch(() => null)
    const conversationId =
      body && typeof body.conversation_id === 'string' ? body.conversation_id : ''
    const force = Boolean(body?.force)
    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversation_id is required' },
        { status: 400 },
      )
    }
    if (!(await resolveConversationAccount(supabase, conversationId))) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const row = await refreshConversationInsight(supabaseAdmin(), {
      conversationId,
      force,
    })
    return NextResponse.json(serialize(row))
  } catch (err) {
    return toErrorResponse(err)
  }
}
