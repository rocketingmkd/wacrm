import { NextResponse } from 'next/server'
import { requireWriteFeature, toErrorResponse } from '@/lib/auth/account'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * PATCH /api/ai/radar/[id]
 *
 * Marks one radar insight as resolved by the caller. RLS (migration 077)
 * limits the UPDATE to the caller's own account, so an id from another
 * account reads as "not found".
 */
export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, userId } = await requireWriteFeature('agent', 'aiCopilot')
    const { id } = await params
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Alerta não encontrado' }, { status: 404 })
    }

    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('copilot_insights')
      .update({ resolved_at: now, resolved_by: userId, updated_at: now })
      .eq('id', id)
      .is('resolved_at', null)
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('[radar] resolve failed:', error.message)
      return NextResponse.json({ error: 'Não foi possível resolver o alerta' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Alerta não encontrado' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
