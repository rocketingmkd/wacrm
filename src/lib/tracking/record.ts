import type { SupabaseClient } from '@supabase/supabase-js'
import {
  cleanSessionParams,
  extractSessionCode,
  fromReferral,
  fromSession,
  hasSignal,
  isCtwaReferral,
} from './attribution'
import { loadActiveRules, pickRule } from './phrase-rules'

type RecordArgs = {
  db: SupabaseClient
  accountId: string
  contactId: string
  conversationId: string
  referral: unknown
  messageText: string | null | undefined
  /** When the customer sent the message; defaults to now. */
  seenAt?: string
}

/**
 * Stores the first known origin of a contact. Called from the WhatsApp
 * webhook on every inbound message that carries a Click to WhatsApp
 * referral or a landing page code. First touch wins: a contact that
 * already has a row is left alone. Never throws, so tracking can't break
 * message handling.
 */
export async function recordLeadAttribution(
  args: RecordArgs & {
    /** True only for the first message of a brand-new conversation. When
     *  the referral / code path finds nothing, the account's phrase
     *  rules (Copiloto "Origem por frase") get one try. */
    isNewConversation?: boolean
  },
): Promise<'recorded' | 'already' | 'none' | 'error'> {
  const outcome = await recordFromReferralOrCode(args)
  if (outcome !== 'none' || !args.isNewConversation) return outcome
  return recordFromPhraseRule(args)
}

/**
 * Phrase rules: the message of a new conversation that neither carries a
 * CTWA referral nor a tracking code is checked against the account's
 * active rules (one indexed query per NEW conversation, never per
 * message). First touch wins, never overwrites, never throws.
 */
async function recordFromPhraseRule(
  args: RecordArgs,
): Promise<'recorded' | 'none' | 'error'> {
  const { db, accountId, contactId, conversationId, messageText, seenAt } = args
  try {
    if (!messageText || !messageText.trim()) return 'none'
    const rules = await loadActiveRules(db, accountId)
    const rule = pickRule(rules, messageText)
    if (!rule) return 'none'

    const { error } = await db.from('lead_attribution').upsert(
      {
        account_id: accountId,
        contact_id: contactId,
        conversation_id: conversationId,
        source: rule.source,
        utm_campaign: rule.label,
        session_code: null,
        first_seen_at: seenAt ?? new Date().toISOString(),
      },
      { onConflict: 'account_id,contact_id', ignoreDuplicates: true },
    )
    if (error) {
      console.error('[tracking] could not store phrase attribution:', error.message)
      return 'error'
    }
    return 'recorded'
  } catch (err) {
    console.error('[tracking] phrase attribution failed:', err)
    return 'error'
  }
}

async function recordFromReferralOrCode(args: RecordArgs): Promise<'recorded' | 'already' | 'none' | 'error'> {
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
