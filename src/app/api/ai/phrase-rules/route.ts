import { NextResponse } from 'next/server'
import { requireFeature, requireWriteFeature, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { parseRuleInput } from '@/lib/tracking/phrase-rules'

const RULE_COLUMNS = 'id, phrase, source, label, active, created_at'
const MAX_RULES = 50

/**
 * GET /api/ai/phrase-rules: the account's "Origem por frase" rules.
 * RLS scopes the read to the account. agent+, Pro plan (aiCopilot).
 */
export async function GET() {
  try {
    const { supabase } = await requireFeature('agent', 'aiCopilot')
    const { data, error } = await supabase
      .from('attribution_phrase_rules')
      .select(RULE_COLUMNS)
      .order('created_at', { ascending: false })
    if (error) {
      console.error('[phrase-rules] list failed:', error.message)
      return NextResponse.json({ error: 'Não foi possível carregar as regras' }, { status: 500 })
    }
    return NextResponse.json({ rules: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/phrase-rules: creates a rule. The account comes from the
 * session, never from the body. Admin+ (also enforced by RLS).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireWriteFeature('admin', 'aiCopilot')
    const limit = checkRateLimit(`admin:phraseRule:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const parsed = parseRuleInput(await request.json().catch(() => null))
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const { count } = await supabase
      .from('attribution_phrase_rules')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    if ((count ?? 0) >= MAX_RULES) {
      return NextResponse.json({ error: `Limite de ${MAX_RULES} regras por conta.` }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('attribution_phrase_rules')
      .insert({ account_id: accountId, ...parsed.value })
      .select(RULE_COLUMNS)
      .single()
    if (error) {
      console.error('[phrase-rules] create failed:', error.message)
      return NextResponse.json({ error: 'Não foi possível criar a regra' }, { status: 500 })
    }
    return NextResponse.json({ rule: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
