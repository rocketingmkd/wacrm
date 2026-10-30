import { NextResponse } from 'next/server'
import { requireRole, requireWrite, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { parseRuleInput } from '@/lib/tracking/phrase-rules'

const RULE_COLUMNS = 'id, phrase, source, label, active, created_at'
const MAX_RULES = 50

/**
 * GET /api/tracking/phrase-rules: as regras "Origem por frase" da conta
 * (Google Ads pela frase do site). RLS escopa a conta. Admin.
 */
export async function GET() {
  try {
    const { supabase } = await requireRole('admin')
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
 * POST /api/tracking/phrase-rules { phrase, label }: cria uma regra. O
 * WhatsApp não repassa a UTM do Google Ads, então a regra é sempre
 * Google, mesmo que o corpo diga outra origem. A conta vem da sessão,
 * nunca do corpo. Admin (o RLS também exige).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireWrite('admin')
    const limit = checkRateLimit(`admin:phraseRule:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const parsed = parseRuleInput({ ...(raw ?? {}), source: 'google' })
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
