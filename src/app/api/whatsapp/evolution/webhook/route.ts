import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { fetchGroupSubject } from '@/lib/whatsapp/evolution-api'
import {
  isValidWebhookSecret,
  parseGroupJoins,
  parseGroupUpsert,
  storeGroupJoined,
  storeGroupMessage,
} from '@/lib/whatsapp/evolution-group-inbound'

/**
 * POST /api/whatsapp/evolution/webhook
 *
 * Inbound events from the account's Evolution (unofficial) session. Today
 * it only stores WhatsApp group messages (migration 070): every group of
 * the paired number lands in the inbox on its own. 1:1 chats are
 * acknowledged and dropped, since they keep arriving through the official
 * webhook.
 *
 * Auth: Evolution sends the per-instance secret in `x-evolution-secret`
 * (registered when the session is activated, derived from
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

  const db = supabaseAdmin()
  const { data: session } = await db
    .from('whatsapp_unofficial_sessions')
    .select('account_id, enabled, phone')
    .eq('instance_name', instance)
    .maybeSingle<{ account_id: string; enabled: boolean; phone: string | null }>()
  if (!session?.enabled) return NextResponse.json({ ok: true, ignored: 'session-off' })

  const messages = parseGroupUpsert(body)
  const joins = parseGroupJoins(body, session.phone)
  if (messages.length === 0 && joins.length === 0) return NextResponse.json({ ok: true, stored: 0 })

  // The webhook payload carries no group subject; ask Evolution (only
  // when a group is first seen).
  const getGroupName = (groupJid: string) =>
    fetchGroupSubject({ instanceName: instance, groupJid }).catch((err) => {
      console.warn('[evolution-webhook] group subject lookup failed:', err instanceof Error ? err.message : err)
      return null
    })

  for (const join of joins) {
    try {
      await storeGroupJoined(db, session.account_id, join, getGroupName)
    } catch (err) {
      console.error('[evolution-webhook] failed to store group join:', err)
    }
  }

  let stored = 0
  for (const msg of messages) {
    try {
      if ((await storeGroupMessage(db, session.account_id, msg, getGroupName)) === 'stored') stored += 1
    } catch (err) {
      console.error('[evolution-webhook] failed to store group message:', err)
    }
  }
  return NextResponse.json({ ok: true, stored })
}
