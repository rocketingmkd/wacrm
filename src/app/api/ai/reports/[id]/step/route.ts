import { NextResponse } from 'next/server'
import { requireWriteFeature, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { processReportBatch, ReportError } from '@/lib/ai/reports'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Um lote chama a IA várias vezes; deixa folga além do padrão.
export const maxDuration = 120

/**
 * POST /api/ai/reports/[id]/step: processa o próximo lote do relatório e
 * devolve o andamento. A tela chama em sequência até status 'done'.
 * Retomável: se parar, a próxima chamada continua de onde estava.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { accountId, userId } = await requireWriteFeature('agent', 'aiCopilot')
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Relatório não encontrado' }, { status: 404 })

    const userLimit = checkRateLimit(`ai-report-step:${userId}`, RATE_LIMITS.aiCopilot)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const acctLimit = checkRateLimit(`ai-report-step-acct:${accountId}`, RATE_LIMITS.aiCopilotAccount)
    if (!acctLimit.success) return rateLimitResponse(acctLimit)

    return NextResponse.json(await processReportBatch(supabaseAdmin(), accountId, id))
  } catch (err) {
    if (err instanceof ReportError) return NextResponse.json({ error: err.message }, { status: 404 })
    console.error('[reports] step failed:', err)
    return toErrorResponse(err)
  }
}
