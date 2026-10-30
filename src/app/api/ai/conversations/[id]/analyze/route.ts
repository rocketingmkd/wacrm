import { NextResponse } from 'next/server'
import { requireWriteFeature, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { analyzeConversation } from '@/lib/ai/conversation-analysis'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/ai/conversations/[id]/analyze
 *
 * Lê UMA conversa e devolve a ficha (resumo, intenção, resultado, nota,
 * objeções, falhas, próxima ação) e os tempos de resposta. Somente
 * leitura, gasta tokens da chave de API da própria conta. A conversa só
 * vale se for da conta da sessão (conferida pelo RLS antes de ler).
 * agent+, plano Pro (aiCopilot).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId, userId } = await requireWriteFeature('agent', 'aiCopilot')
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 })

    const userLimit = checkRateLimit(`ai-analyze-user:${userId}`, RATE_LIMITS.aiCopilot)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const acctLimit = checkRateLimit(`ai-analyze-acct:${accountId}`, RATE_LIMITS.aiCopilotAccount)
    if (!acctLimit.success) return rateLimitResponse(acctLimit)

    // O cliente da sessão só enxerga conversas da própria conta (RLS).
    const { data: visible } = await supabase.from('conversations').select('id').eq('id', id).maybeSingle()
    if (!visible) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 })

    const result = await analyzeConversation(supabaseAdmin(), accountId, id)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result.value)
  } catch (err) {
    console.error('[analyze] failed:', err)
    return toErrorResponse(err)
  }
}
