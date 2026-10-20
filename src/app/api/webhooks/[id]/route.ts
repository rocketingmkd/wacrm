import { NextResponse } from 'next/server'
import { requireWriteFeature, toErrorResponse } from '@/lib/auth/account'
import { normalizeEvents } from '@/lib/webhooks/events'
import {
  WEBHOOK_PUBLIC_COLUMNS,
  normalizeWebhookUrl,
  serializeWebhookEndpoint,
} from '@/lib/webhooks/endpoints'

/**
 * PATCH  { url?, events?, is_active? } update an endpoint
 * DELETE remove an endpoint
 *
 * Account scoped: an id from another account matches nothing (404).
 * Re-enabling an endpoint clears its failure streak so one stale
 * failure doesn't switch it off again right away.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireWriteFeature('admin', 'apiAccess')
    const { id } = await params

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 })
    }

    const updates: Record<string, unknown> = {}

    if ('url' in body) {
      const url = normalizeWebhookUrl(body.url)
      if (!url) {
        return NextResponse.json(
          { error: 'Informe uma URL válida começando com https://' },
          { status: 400 },
        )
      }
      updates.url = url
    }
    if ('events' in body) {
      const events = normalizeEvents(body.events)
      if (!events) {
        return NextResponse.json({ error: 'Escolha pelo menos um evento.' }, { status: 400 })
      }
      updates.events = events
    }
    if ('is_active' in body) {
      if (typeof body.is_active !== 'boolean') {
        return NextResponse.json({ error: 'is_active deve ser verdadeiro ou falso.' }, { status: 400 })
      }
      updates.is_active = body.is_active
      if (body.is_active) updates.failure_count = 0
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nada para atualizar.' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('webhook_endpoints')
      .update(updates)
      .eq('id', id)
      .eq('account_id', accountId)
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .maybeSingle()
    if (error) {
      console.error('[webhooks] update failed:', error.message)
      return NextResponse.json({ error: 'Não foi possível atualizar o webhook.' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Webhook não encontrado.' }, { status: 404 })

    return NextResponse.json({ webhook: serializeWebhookEndpoint(data as Record<string, unknown>) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireWriteFeature('admin', 'apiAccess')
    const { id } = await params

    const { data, error } = await supabase
      .from('webhook_endpoints')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id')
    if (error) {
      console.error('[webhooks] delete failed:', error.message)
      return NextResponse.json({ error: 'Não foi possível excluir o webhook.' }, { status: 500 })
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Webhook não encontrado.' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
