import type { SupabaseClient } from '@supabase/supabase-js'
import {
  cleanSessionParams,
  extractSessionCode,
  fromReferral,
  fromSession,
  hasSignal,
  isCtwaReferral,
} from './attribution'

/**
 * Stores the first known origin of a contact. Called from the WhatsApp
 * webhook on every inbound message that carries a Click to WhatsApp
 * referral or a landing page code. First touch wins: a contact that
 * already has a row is left alone. Never throws, so tracking can't break
 * message handling.
 */
export async function recordLeadAttribution(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
  conversationId: string
  referral: unknown
  messageText: string | null | undefined
  /** When the customer sent the message; defaults to now. */
  seenAt?: string
}): Promise<'recorded' | 'already' | 'none' | 'error'> {
  const { db, accountId, contactId, conversationId, referral, messageText, seenAt } = args
  try {
    const code = isCtwaReferral(referral) ? null : extractSessionCode(messageText)
    if (!isCtwaReferral(referral) && !code) return 'none'

    const { data: existing } = await db
      .from('lead_attribution')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .maybeSingle()
    if (existing) return 'already'

    let fields: Record<string, unknown> | null = null
    if (isCtwaReferral(referral)) {
      fields = fromReferral(referral)
    } else if (code) {
      const { data: session } = await db
        .from('tracking_sessions')
        .select(
          'utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, fbclid, fbc, fbp, landing_url, referrer',
        )
        .eq('account_id', accountId)
        .eq('code', code)
        .maybeSingle()
      if (!session) return 'none'
      const params = cleanSessionParams(session as Record<string, unknown>)
      if (!hasSignal(params)) return 'none'
      fields = fromSession(code, params)
    }
    if (!fields) return 'none'

    const { error } = await db.from('lead_attribution').upsert(
      {
        account_id: accountId,
        contact_id: contactId,
        conversation_id: conversationId,
        first_seen_at: seenAt ?? new Date().toISOString(),
        ...fields,
      },
      { onConflict: 'account_id,contact_id', ignoreDuplicates: true },
    )
    if (error) {
      console.error('[tracking] could not store attribution:', error.message)
      return 'error'
    }
    return 'recorded'
  } catch (err) {
    console.error('[tracking] attribution failed:', err)
    return 'error'
  }
}
