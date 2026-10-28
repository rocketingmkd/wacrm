import { NextResponse } from 'next/server'
import { requireWriteFeature, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { runRadarScan } from '@/lib/ai/radar'

/**
 * POST /api/ai/radar/scan
 *
 * "Analisar agora": runs the Copiloto radar scan for the caller's
 * account (rule-based bottlenecks + an AI reading of the latest
 * conversations on the account's own provider key). Writes through the
 * service role; the account comes from the session, never from the body.
 * agent+, Pro plan, not available on a billing-locked account.
 */
export async function POST() {
  try {
    const { accountId, userId } = await requireWriteFeature('agent', 'aiCopilot')

    const userLimit = checkRateLimit(`ai-radar-user:${userId}`, RATE_LIMITS.aiCopilot)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const acctLimit = checkRateLimit(`ai-radar:${accountId}`, RATE_LIMITS.aiRadar)
    if (!acctLimit.success) return rateLimitResponse(acctLimit)

    const result = await runRadarScan(supabaseAdmin(), accountId, { triggeredBy: userId })
    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}
