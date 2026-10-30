import { NextResponse } from 'next/server'
import { requireFeature, toErrorResponse } from '@/lib/auth/account'
import { buildReportHtml, type ReportHtmlRow } from '@/lib/ai/report-html'
import type { ConversationAnalysis, ConversationMetrics, Narrative, ReportAggregate } from '@/lib/ai/reports'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ItemRow {
  conversation_id: string
  status: string
  metrics: ConversationMetrics
  analysis: ConversationAnalysis | null
  conversation: unknown
}

interface ReportRow {
  id: string
  mode: 'full' | 'keyword'
  keyword: string | null
  source_filter: string | null
  date_from: string | null
  date_to: string | null
  status: string
  model: string | null
  result: { aggregate: ReportAggregate; narrative: Narrative | null } | null
  created_at: string
  finished_at: string | null
}

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

/**
 * GET /api/ai/reports/[id]/download?format=html|json
 *
 * html: relatório com a identidade da Rocketing. json: as fichas por
 * conversa (base para um agente de follow up). Só relatórios concluídos.
 * Lê pela sessão: o RLS garante que é da conta de quem pediu.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requireFeature('agent', 'aiCopilot')
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Relatório não encontrado' }, { status: 404 })
    const query = new URL(request.url).searchParams
    const format = query.get('format') === 'json' ? 'json' : 'html'
    const disposition = query.get('inline') === '1' && format === 'html' ? 'inline' : 'attachment'

    const { data: rep } = await supabase
      .from('copilot_reports')
      .select('id, mode, keyword, source_filter, date_from, date_to, status, model, result, created_at, finished_at')
      .eq('id', id)
      .maybeSingle()
    const report = rep as ReportRow | null
    if (!report) return NextResponse.json({ error: 'Relatório não encontrado' }, { status: 404 })
    if (report.status !== 'done' || !report.result) {
      return NextResponse.json({ error: 'O relatório ainda não terminou.' }, { status: 409 })
    }

    const items: ItemRow[] = []
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('copilot_report_items')
        .select('conversation_id, status, metrics, analysis, conversation:conversations(contact:contacts(name, phone))')
        .eq('report_id', id)
        .range(from, from + PAGE - 1)
      if (error) return NextResponse.json({ error: 'Não foi possível montar o relatório' }, { status: 500 })
      const page = (data ?? []) as unknown as ItemRow[]
      items.push(...page)
      if (page.length < PAGE) break
    }

    const rows: ReportHtmlRow[] = items.map((it) => {
      const conv = one(it.conversation as { contact: unknown } | { contact: unknown }[] | null)
      const contact = one(conv?.contact as { name: string | null; phone: string | null } | { name: string | null; phone: string | null }[] | null)
      const a = it.status === 'done' ? it.analysis : null
      return {
        conversationId: it.conversation_id,
        name: contact?.name ?? null,
        phone: contact?.phone ?? null,
        source: it.metrics?.source ?? 'sem_origem',
        campaign: it.metrics?.campaign ?? null,
        outcome: a?.outcome ?? null,
        quality: a?.quality ?? null,
        firstResponseMin: it.metrics?.firstResponseMin ?? null,
        unanswered: Boolean(it.metrics?.unanswered),
        summary: a?.summary ?? '',
        nextAction: a?.nextAction ?? '',
      }
    })

    const stamp = (report.finished_at ?? report.created_at).slice(0, 10)
    const name = `relatorio-atendimento-${report.mode === 'keyword' ? 'palavra-chave' : 'completo'}-${stamp}`

    if (format === 'json') {
      const body = {
        generatedAt: report.finished_at,
        mode: report.mode,
        keyword: report.keyword,
        sourceFilter: report.source_filter,
        dateFrom: report.date_from,
        dateTo: report.date_to,
        model: report.model,
        aggregate: report.result.aggregate,
        narrative: report.result.narrative,
        conversations: items.map((it, i) => ({
          conversationId: it.conversation_id,
          contact: { name: rows[i].name, phone: rows[i].phone },
          status: it.status,
          metrics: it.metrics,
          analysis: it.status === 'done' ? it.analysis : null,
        })),
      }
      return new NextResponse(JSON.stringify(body, null, 2), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${name}.json"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    const html = buildReportHtml({
      mode: report.mode,
      keyword: report.keyword,
      sourceFilter: report.source_filter,
      dateFrom: report.date_from,
      dateTo: report.date_to,
      createdAt: report.created_at,
      finishedAt: report.finished_at,
      model: report.model,
      aggregate: report.result.aggregate,
      narrative: report.result.narrative,
      rows,
    })
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `${disposition}; filename="${name}.html"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
