import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { validateRange } from '@/lib/reports'

/**
 * GET /api/reports/overview?from=<ISO>&to=<ISO>&tz=<IANA zone>
 *
 * Aggregates for the Relatórios page, computed by the SQL function
 * `report_overview` (migration 067). Admin only: the function checks
 * membership itself and every table read goes through RLS.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const url = new URL(request.url)
    const from = new Date(url.searchParams.get('from') ?? '')
    const to = new Date(url.searchParams.get('to') ?? '')
    const problem = validateRange(from, to)
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })

    // Only a plain IANA zone name reaches the database.
    const tzParam = url.searchParams.get('tz') ?? ''
    const tz = /^[A-Za-z]+(?:[_/+-][A-Za-z0-9_+-]+)*$/.test(tzParam) && tzParam.length <= 64
      ? tzParam
      : 'America/Sao_Paulo'

    const { data, error } = await supabase.rpc('report_overview', {
      p_account: accountId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_tz: tz,
    })
    if (error) {
      console.error('[reports/overview] rpc failed:', error.message)
      return NextResponse.json({ error: 'Não foi possível gerar o relatório.' }, { status: 500 })
    }
    return NextResponse.json(data)
  } catch (err) {
    return toErrorResponse(err)
  }
}
