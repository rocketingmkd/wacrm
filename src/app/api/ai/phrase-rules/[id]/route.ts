import { NextResponse } from 'next/server'
import { requireWriteFeature, toErrorResponse } from '@/lib/auth/account'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const notFound = () => NextResponse.json({ error: 'Regra não encontrada' }, { status: 404 })

/**
 * PATCH /api/ai/phrase-rules/[id]: turns a rule on or off ({ active }).
 * Admin+. Scoped to the session's account (and by RLS), so an id from
 * another account reads as "not found".
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireWriteFeature('admin', 'aiCopilot')
    const { id } = await params
    if (!UUID_RE.test(id)) return notFound()

    const body = (await request.json().catch(() => null)) as { active?: unknown } | null
    if (typeof body?.active !== 'boolean') {
      return NextResponse.json({ error: 'Informe active como verdadeiro ou falso' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('attribution_phrase_rules')
      .update({ active: body.active })
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id')
      .maybeSingle()
    if (error) {
      console.error('[phrase-rules] update failed:', error.message)
      return NextResponse.json({ error: 'Não foi possível atualizar a regra' }, { status: 500 })
    }
    if (!data) return notFound()
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/phrase-rules/[id]: removes the rule only. Attributions
 * already written stay (they belong to the contacts). Admin+.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireWriteFeature('admin', 'aiCopilot')
    const { id } = await params
    if (!UUID_RE.test(id)) return notFound()

    const { data, error } = await supabase
      .from('attribution_phrase_rules')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id')
      .maybeSingle()
    if (error) {
      console.error('[phrase-rules] delete failed:', error.message)
      return NextResponse.json({ error: 'Não foi possível apagar a regra' }, { status: 500 })
    }
    if (!data) return notFound()
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
