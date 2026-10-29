import { NextResponse } from 'next/server'
import { requireWriteFeature, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { findPhraseMatches } from '@/lib/tracking/phrase-rules'
import { loadRuleForAccount } from '../rule-lookup'

const SAMPLE_SIZE = 10

/**
 * POST /api/ai/phrase-rules/preview  { ruleId }
 *
 * Dry run: counts the contacts WITHOUT lead_attribution whose customer
 * messages contain the rule's phrase, and returns a sample. Writes
 * nothing. The account comes from the session, never from the body.
 * agent+, Pro plan.
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

    const { matches, truncated } = await findPhraseMatches(supabaseAdmin(), accountId, rule.phrase)
    return NextResponse.json({
      count: matches.length,
      truncated,
      sample: matches.slice(0, SAMPLE_SIZE).map((m) => ({
        name: m.name,
        phone: m.phone,
        excerpt: m.excerpt,
        matchedAt: m.matchedAt,
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
