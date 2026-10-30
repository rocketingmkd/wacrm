import { NextResponse } from 'next/server'
import { requireFeature, requireWriteFeature, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Ctx = { params: Promise<{ id: string }> }

/** GET /api/ai/reports/[id]: andamento e, pronto, o resultado agregado. */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { supabase } = await requireFeature('agent', 'aiCopilot')
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Relatório não encontrado' }, { status: 404 })
    const { data, error } = await supabase
      .from('copilot_reports')
      .select(
        'id, mode, keyword, source_filter, date_from, date_to, status, total, processed, error, model, result, created_at, finished_at',
      )
      .eq('id', id)
      .maybeSingle()
    if (error) return NextResponse.json({ error: 'Não foi possível carregar o relatório' }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Relatório não encontrado' }, { status: 404 })
    return NextResponse.json({ report: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** PATCH /api/ai/reports/[id] { action: 'cancel' }: interrompe um relatório em andamento. */
export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { accountId } = await requireWriteFeature('agent', 'aiCopilot')
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Relatório não encontrado' }, { status: 404 })
    const body = (await request.json().catch(() => null)) as { action?: unknown } | null
    if (body?.action !== 'cancel') return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })

    const { data, error } = await supabaseAdmin()
      .from('copilot_reports')
      .update({ status: 'cancelled', finished_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', accountId)
      .in('status', ['pending', 'running'])
      .select('id')
      .maybeSingle()
    if (error) return NextResponse.json({ error: 'Não foi possível cancelar' }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Relatório não está em andamento' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
