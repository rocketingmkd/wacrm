import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { validateRange } from '@/lib/reports'
import { attachConversationIds } from '@/lib/tracking/report'

/**
 * GET /api/reports/attribution?from=<ISO>&to=<ISO>&tz=<IANA zone>
 *
 * Leads, deals and revenue per ad source and campaign, computed by the
 * SQL function `attribution_report` (migration 068). Admin only.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const url = new URL(request.url)
    const from = new Date(url.searchParams.get('from') ?? '')
    const to = new Date(url.searchParams.get('to') ?? '')
    const problem = validateRange(from, to)
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })

    const tzParam = url.searchParams.get('tz') ?? ''
    const tz = /^[A-Za-z]+(?:[_/+-][A-Za-z0-9_+-]+)*$/.test(tzParam) && tzParam.length <= 64
      ? tzParam
      : 'America/Sao_Paulo'

    const { data, error } = await supabase.rpc('attribution_report', {
      p_account: accountId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_tz: tz,
    })
    if (error) {
      console.error('[reports/attribution] rpc failed:', error.message)
      return NextResponse.json({ error: 'Não foi possível gerar o relatório.' }, { status: 500 })
    }

    // A função SQL devolve o contato, não a conversa. Anexa a conversa mais
    // recente de cada lead recente para o botão "Abrir conversa". Se esta
    // leitura falhar, o relatório continua valendo, só sem o botão.
    const report = data as { recent?: { contact_id: string }[] } | null
    if (report?.recent?.length) {
      const contactIds = [...new Set(report.recent.map((r) => r.contact_id))]
      const { data: convs, error: convError } = await supabase
        .from('conversations')
        .select('id, contact_id, last_message_at')
        .eq('account_id', accountId)
        .in('contact_id', contactIds)
      if (convError) {
        console.error('[reports/attribution] conversation lookup failed:', convError.message)
      } else {
        report.recent = attachConversationIds(report.recent, convs ?? [])
      }
    }
    return NextResponse.json(report)
  } catch (err) {
    return toErrorResponse(err)
  }
}
