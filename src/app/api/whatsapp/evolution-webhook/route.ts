import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import {
  isValidWebhookSecret,
  parseGroupUpsert,
  storeGroupMessage,
} from '@/lib/whatsapp/evolution-group-inbound'

/**
 * POST /api/whatsapp/evolution-webhook
 *
 * Inbound events from the account's Evolution (unofficial) session. Today
 * it only stores messages of the WhatsApp groups the admin chose to follow
 * (migration 070); anything else (1:1 chats, groups not followed) is
 * acknowledged and dropped, since 1:1 traffic keeps arriving through the
 * official webhook.
 *
 * Auth: Evolution sends the per-instance secret in `x-evolution-secret`
 * (registered by /api/whatsapp/unofficial/groups, derived from
 * ENCRYPTION_KEY). A bad secret is a 401; every other outcome is a 200 so
 * Evolution never retries a message we deliberately ignored.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const instance = (body as { instance?: string } | null)?.instance
  if (!instance) return NextResponse.json({ ok: true, ignored: 'no-instance' })

  if (!isValidWebhookSecret(instance, request.headers.get('x-evolution-secret'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const messages = parseGroupUpsert(body)
  if (messages.length === 0) return NextResponse.json({ ok: true, stored: 0 })

  const db = supabaseAdmin()
  const { data: session } = await db
    .from('whatsapp_unofficial_sessions')
    .select('account_id, enabled')
    .eq('instance_name', instance)
    .maybeSingle<{ account_id: string; enabled: boolean }>()
  if (!session?.enabled) return NextResponse.json({ ok: true, ignored: 'session-off' })

  let stored = 0
  for (const msg of messages) {
    try {
      if ((await storeGroupMessage(db, session.account_id, msg)) === 'stored') stored += 1
    } catch (err) {
      console.error('[evolution-webhook] failed to store group message:', err)
    }
  }
  return NextResponse.json({ ok: true, stored })
}
