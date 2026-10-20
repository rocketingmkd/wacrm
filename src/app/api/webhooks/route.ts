import { NextResponse } from 'next/server'
import { requireRole, requireWriteFeature, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import { normalizeEvents } from '@/lib/webhooks/events'
import {
  WEBHOOK_PUBLIC_COLUMNS,
  generateWebhookSecret,
  normalizeWebhookUrl,
  serializeWebhookEndpoint,
} from '@/lib/webhooks/endpoints'

/**
 * Dashboard counterpart of /api/v1/webhooks (which authenticates with an
 * API key). Session based, admin only, same validation and the same
 * "secret is shown exactly once" rule.
 *
 *   GET   list the account's endpoints (never the secret)
 *   POST  { url, events[] } create one, returns the plaintext secret once
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { data, error } = await supabase
      .from('webhook_endpoints')
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
    if (error) {
      console.error('[webhooks] list failed:', error.message)
      return NextResponse.json({ error: 'Não foi possível listar os webhooks.' }, { status: 500 })
    }
    return NextResponse.json({
      webhooks: (data ?? []).map((r) => serializeWebhookEndpoint(r as Record<string, unknown>)),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireWriteFeature('admin', 'apiAccess')

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 })
    }

    const url = normalizeWebhookUrl(body.url)
    if (!url) {
      return NextResponse.json(
        { error: 'Informe uma URL válida começando com https://' },
        { status: 400 },
      )
    }
    const events = normalizeEvents(body.events)
    if (!events) {
      return NextResponse.json(
        { error: 'Escolha pelo menos um evento.' },
        { status: 400 },
      )
    }

    const secret = generateWebhookSecret()
    const { data: created, error } = await supabase
      .from('webhook_endpoints')
      .insert({
        account_id: accountId,
        created_by: userId,
        url,
        secret: encrypt(secret),
        events,
      })
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .single()
    if (error || !created) {
      console.error('[webhooks] create failed:', error?.message)
      return NextResponse.json({ error: 'Não foi possível criar o webhook.' }, { status: 500 })
    }

    return NextResponse.json(
      { webhook: serializeWebhookEndpoint(created as Record<string, unknown>), secret },
      { status: 201 },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
