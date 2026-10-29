import { NextResponse } from 'next/server'
import { requireWriteFeature, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { applyPhraseMatches, findPhraseMatches } from '@/lib/tracking/phrase-rules'
import { loadRuleForAccount } from '../rule-lookup'

/**
 * POST /api/ai/phrase-rules/apply  { ruleId }
 *
 * Writes lead_attribution (source of the rule, utm_campaign = label,
 * session_code null, first_seen_at = first matching message) ONLY for
 * contacts that have no row yet. The matches are recomputed here, never
 * taken from the client, and the insert is ON CONFLICT DO NOTHING, so a
 * contact attributed in the meantime is left alone. Service role write;
 * account from the session. agent+, Pro plan.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireWriteFeature('agent', 'aiCopilot')

    const userLimit = checkRateLimit(`phrase-scan-user:${userId}`, RATE_LIMITS.phraseScan)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const acctLimit = checkRateLimit(`phrase-scan:${accountId}`, RATE_LIMITS.phraseScanAccount)
    if (!acctLimit.success) return rateLimitResponse(acctLimit)

    const body = (await request.json().catch(() => null)) as { ruleId?: unknown } | null
    const rule = await loadRuleForAccount(supabase, accountId, body?.ruleId)
    if (!rule) return NextResponse.json({ error: 'Regra não encontrada' }, { status: 404 })

    const admin = supabaseAdmin()
    const { matches, truncated } = await findPhraseMatches(admin, accountId, rule.phrase)
    const written = await applyPhraseMatches(admin, accountId, rule, matches)
    return NextResponse.json({ found: matches.length, written, truncated })
  } catch (err) {
    return toErrorResponse(err)
  }
}
