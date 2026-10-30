import { NextResponse } from 'next/server'
import { requireFeature, requireWriteFeature, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { createReport, parseReportParams, previewReport, ReportError } from '@/lib/ai/reports'

const COLUMNS =
  'id, mode, keyword, source_filter, date_from, date_to, status, total, processed, error, model, created_at, finished_at'

/** GET /api/ai/reports: os 20 relatórios mais recentes da conta. RLS escopa a conta. */
export async function GET() {
  try {
    const { supabase } = await requireFeature('agent', 'aiCopilot')
    const { data, error } = await supabase
      .from('copilot_reports')
      .select(COLUMNS)
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) {
      console.error('[reports] list failed:', error.message)
      return NextResponse.json({ error: 'Não foi possível carregar os relatórios' }, { status: 500 })
    }
    return NextResponse.json({ reports: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/reports  { mode, keyword?, source?, dateFrom?, dateTo?, preview? }
 *
 * preview=true: só conta as conversas e estima os tokens, sem gravar nada.
 * Sem preview: cria o relatório (status pending); quem processa é
 * POST /api/ai/reports/[id]/step. A conta vem da sessão, nunca do corpo.
 */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireWriteFeature('agent', 'aiCopilot')
    const userLimit = checkRateLimit(`ai-report-create:${userId}`, RATE_LIMITS.phraseScan)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const acctLimit = checkRateLimit(`ai-report-create-acct:${accountId}`, RATE_LIMITS.phraseScanAccount)
    if (!acctLimit.success) return rateLimitResponse(acctLimit)

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const parsed = parseReportParams(body)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const db = supabaseAdmin()
    if (body?.preview === true) {
      return NextResponse.json(await previewReport(db, accountId, parsed.value))
    }
    return NextResponse.json(await createReport(db, accountId, userId, parsed.value), { status: 201 })
  } catch (err) {
    if (err instanceof ReportError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('[reports] create failed:', err)
    return toErrorResponse(err)
  }
}
