import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { maybeAssignRoundRobin } from '@/lib/conversations/round-robin'
import {
  handleTemplateWebhookChange,
  isTemplateWebhookField,
} from '@/lib/whatsapp/template-webhook'

// The `after()` callback in POST runs within this route's max duration.
// Inbound processing can fan out to per-media Meta verification calls, so
// give it headroom beyond the platform default (Vercel clamps this to the
// plan's ceiling). Tune as needed.
export const maxDuration = 60

// Lazy-initialized to avoid build-time crash when env vars are missing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

interface WhatsAppMessage {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: { id: string; mime_type: string; caption?: string }
  video?: { id: string; mime_type: string; caption?: string }
  document?: { id: string; mime_type: string; filename?: string; caption?: string }
  audio?: { id: string; mime_type: string }
  sticker?: { id: string; mime_type: string }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  reaction?: { message_id: string; emoji: string }
  /**
   * Set when the customer taps a button or list row on an interactive
   * message we sent. `button_reply.id` / `list_reply.id` is whatever id
   * we put on the button/row when sending — the Flows engine uses this
   * to advance the per-contact run.
   */
  interactive?: {
    type: 'button_reply' | 'list_reply'
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string; description?: string }
  }
  /**
   * Set when the customer taps a quick-reply button on a template
   * message (e.g. a broadcast/automation dispatch). Distinct from
   * `interactive.button_reply`, which only covers interactive messages
   * sent directly via the Cloud API.
   */
  button?: { text: string; payload: string }
  /** Present when the customer swipe-replies to one of our messages. */
  context?: { id: string }
}

interface WhatsAppWebhookEntry {
  id: string
  changes: Array<{
    value: {
      messaging_product: string
      metadata: {
        display_phone_number: string
        phone_number_id: string
      }
      contacts?: Array<{
        profile: { name: string }
        wa_id: string
      }>
      messages?: WhatsAppMessage[]
      statuses?: Array<{
        id: string
        status: string
        timestamp: string
        recipient_id: string
        /** Only present when status === 'failed' — the actual Meta
         *  rejection reason (e.g. undeliverable, re-engagement window
         *  expired, recipient opted out). Never persisted, only
         *  logged — see handleStatusUpdate. */
        errors?: Array<{
          code: number
          title: string
          message?: string
          error_data?: { details?: string }
        }>
      }>
    }
    field: string
  }>
}

// ============================================================
// Coexistence-specific webhook payload shapes
//
// These arrive on `change.field` values other than the standard
// 'messages'/'statuses' one, each with its OWN `value` shape (not the
// `messaging_product`/`metadata`/`messages`/`statuses` shape above) —
// same reason template-webhook.ts types its own payload separately
// instead of forcing it into WhatsAppWebhookEntry.
// ============================================================

interface SmbMessageEcho {
  from: string
  to: string
  id: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: { id: string; mime_type: string; caption?: string }
  video?: { id: string; mime_type: string; caption?: string }
  document?: { id: string; mime_type: string; filename?: string; caption?: string }
  audio?: { id: string; mime_type: string }
  /** type === 'revoke': a previously-echoed message was deleted in the app. */
  revoke?: { original_message_id: string }
  /** type === 'edit': a previously-echoed message was edited in the app. */
  edit?: { original_message_id: string; message: Record<string, unknown> & { type: string } }
}

interface SmbMessageEchoesValue {
  metadata?: { display_phone_number: string; phone_number_id: string }
  message_echoes?: SmbMessageEcho[]
}

interface SmbAppStateSyncValue {
  metadata?: { display_phone_number: string; phone_number_id: string }
  state_sync?: Array<{
    type: string
    /** Absent full_name/first_name on a 'remove' action. */
    contact?: { full_name?: string; first_name?: string; phone_number: string }
    action: 'add' | 'remove'
  }>
}

interface HistoryMessage {
  from: string
  to: string
  id: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: { id: string; mime_type: string; caption?: string }
  video?: { id: string; mime_type: string; caption?: string }
  document?: { id: string; mime_type: string; filename?: string; caption?: string }
  audio?: { id: string; mime_type: string }
}

interface HistoryValue {
  metadata?: { display_phone_number: string; phone_number_id: string }
  history?: Array<{
    metadata?: { phase?: number; chunk_order?: number; progress?: number }
    threads?: Array<{ id: string; messages: HistoryMessage[] }>
    /** Present instead of `threads` when the customer declined to share
     *  history (code 2593109) or another sync error occurred. */
    errors?: Array<{ code: number; title?: string; message?: string }>
  }>
}

interface AccountUpdateValue {
  event?: string
  waba_info?: { waba_id?: string }
  disconnection_info?: { reason?: string; initiated_by?: string }
}

// GET - Webhook verification
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('hub.mode')
    const challenge = searchParams.get('hub.challenge')
    const verifyToken = searchParams.get('hub.verify_token')

    if (mode !== 'subscribe' || !challenge || !verifyToken) {
      return NextResponse.json(
        { error: 'Missing verification parameters' },
        { status: 400 }
      )
    }

    // App-level verify token, set once by the operator (env var) and
    // used for the one-time Meta App Dashboard webhook handshake. This
    // is the correct model for how Meta's webhook config actually
    // works — one Callback URL + one Verify Token per app, unrelated to
    // any individual account. Checked first (no DB round-trip) so the
    // handshake succeeds even before any account has connected
    // WhatsApp yet — the per-account fallback below exists only for
    // the manual "each account pastes its own token" flow.
    if (
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN &&
      verifyToken === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
    ) {
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    // Fetch all whatsapp configs to check verify tokens
    const { data: configs, error: configError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('id, verify_token')

    if (configError || !configs) {
      console.error('Error fetching configs for verification:', configError)
      return NextResponse.json(
        { error: 'Verification failed' },
        { status: 403 }
      )
    }

    // Check if any config's verify_token matches. Also collect the
    // matching row so we can opportunistically upgrade its token to
    // GCM if it was still in the legacy CBC format.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let matchedConfig: any = null
    for (const config of configs) {
      if (!config.verify_token) continue
      try {
        if (decrypt(config.verify_token) === verifyToken) {
          matchedConfig = config
          break
        }
      } catch {
        // Malformed / wrong-key token row — skip it and keep checking.
      }
    }

    if (matchedConfig) {
      // Fire-and-forget GCM upgrade. Safe to run on every subscribe
      // since it's a no-op once the column is already GCM.
      if (isLegacyFormat(matchedConfig.verify_token)) {
        void supabaseAdmin()
          .from('whatsapp_config')
          .update({ verify_token: encrypt(verifyToken) })
          .eq('id', matchedConfig.id)
          .then(({ error }: { error: unknown }) => {
            if (error) {
              console.warn(
                '[webhook] verify_token GCM upgrade failed:',
                (error as { message?: string })?.message ?? error,
              )
            }
          })
      }
      // Return challenge as plain text
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    return NextResponse.json(
      { error: 'Verification token mismatch' },
      { status: 403 }
    )
  } catch (error) {
    console.error('Error in webhook GET verification:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST - Receive messages
export async function POST(request: Request) {
  // Read raw body first so we can HMAC-verify the exact bytes Meta
  // signed. request.json() would re-encode and break the signature.
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    // 401 (not 200) — we want Meta's delivery dashboard to show failures
    // loudly if a misconfiguration causes signatures to stop matching,
    // rather than silently eating events.
    console.warn('[webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: { entry?: WhatsAppWebhookEntry[] }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Process AFTER the response so we ack Meta within their ~20s timeout
  // (a slow ack triggers Meta retries + duplicate inserts), while still
  // guaranteeing the work runs to completion.
  //
  // This MUST use `after()` rather than a detached `processWebhook(body)`
  // promise: on serverless platforms (we run on Vercel) the function can
  // be frozen or terminated the moment the response is sent, so a floating
  // promise's DB writes are not guaranteed to finish. That dropped a
  // non-deterministic *subset* of inbound messages — contacts/conversations
  // were created but the message insert never landed, leaving conversations
  // that show in the inbox with an empty thread, and no logs to explain it
  // (see issue #301). `after()` hands the callback to the runtime, which
  // keeps the function alive until it resolves (within the route's
  // maxDuration).
  after(async () => {
    try {
      await processWebhook(body)
    } catch (error) {
      console.error('Error processing webhook:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processWebhook(body: { entry?: WhatsAppWebhookEntry[] }) {
  if (!body.entry) return

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      // Template-lifecycle events (status / quality / components
      // updates from Meta) come in on a different change.field and
      // have a different value shape — route them through the
      // dedicated handler. Skip the messaging branches below so we
      // don't try to read message-shaped fields off a template event.
      if (isTemplateWebhookField(change.field)) {
        await handleTemplateWebhookChange(
          { field: change.field, value: change.value as unknown },
          supabaseAdmin(),
        )
        continue
      }

      // Coexistence-only topics — each has its own value shape (see
      // above), routed before the standard messages/statuses branch
      // below, which assumes the messaging value shape.
      if (change.field === 'smb_message_echoes') {
        await handleMessageEchoes(change.value as unknown as SmbMessageEchoesValue)
        continue
      }
      if (change.field === 'smb_app_state_sync') {
        await handleAppStateSync(change.value as unknown as SmbAppStateSyncValue)
        continue
      }
      if (change.field === 'history') {
        await handleHistorySync(change.value as unknown as HistoryValue)
        continue
      }
      if (change.field === 'account_update') {
        await handleAccountUpdate(change.value as unknown as AccountUpdateValue)
        continue
      }

      const value = change.value

      // Handle status updates
      if (value.statuses) {
        for (const status of value.statuses) {
          await handleStatusUpdate(status)
        }
      }

      // Handle incoming messages
      if (!value.messages || !value.contacts) continue

      const phoneNumberId = value.metadata.phone_number_id

      // Find user's config by phone_number_id. `.single()` returns
      // PGRST116 for both 0 rows AND ≥2 rows — distinguish them so
      // operators see the real cause in logs. ≥2 rows shouldn't happen
      // post-migration 013 (UNIQUE constraint), but a row created
      // before the constraint, or a race, would still surface here.
      const { data: configRows, error: configError } = await supabaseAdmin()
        .from('whatsapp_config')
        .select('*')
        .eq('phone_number_id', phoneNumberId)

      if (configError) {
        console.error(
          'Error fetching whatsapp_config for phone_number_id:',
          phoneNumberId,
          configError
        )
        continue
      }

      if (!configRows || configRows.length === 0) {
        console.error('No config found for phone_number_id:', phoneNumberId)
        continue
      }

      if (configRows.length > 1) {
        console.error(
          `Multiple configs (${configRows.length}) found for phone_number_id:`,
          phoneNumberId,
          '— inbound message dropped. Resolve duplicates so each number maps to a single account.',
          'Account owners:',
          configRows.map((r: { account_id: string; user_id: string }) => `${r.account_id} (admin ${r.user_id})`)
        )
        continue
      }

      const config = configRows[0]

      const decryptedAccessToken = decrypt(config.access_token)

      for (let i = 0; i < value.messages.length; i++) {
        const message = value.messages[i]
        const contact = value.contacts[i] || value.contacts[0]

        await processMessage(
          message,
          contact,
          // Tenancy — drives every contact / conversation lookup
          // and the engines' active-row dispatch.
          config.account_id,
          // Audit / sender-of-record — used as the user_id on row
          // inserts that need it for NOT NULL FK compliance. Always
          // the admin who saved the WhatsApp config.
          config.user_id,
          decryptedAccessToken
        )
      }
    }
  }
}

// ============================================================
// Coexistence handlers
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WhatsAppConfigRow = any

/**
 * Resolve the single whatsapp_config row for a phone_number_id.
 * Same "0 or ≥2 rows is unresolvable" shape as the inline lookup in
 * processWebhook above, factored out because the Coexistence handlers
 * below need it independently of the messages/statuses branch.
 */
async function resolveWhatsAppConfig(
  phoneNumberId: string
): Promise<WhatsAppConfigRow | null> {
  const { data: configRows, error } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('*')
    .eq('phone_number_id', phoneNumberId)

  if (error) {
    console.error(
      '[coexistence] Error fetching whatsapp_config for phone_number_id:',
      phoneNumberId,
      error
    )
    return null
  }
  if (!configRows || configRows.length === 0) {
    console.error('[coexistence] No config found for phone_number_id:', phoneNumberId)
    return null
  }
  if (configRows.length > 1) {
    console.error(
      `[coexistence] Multiple configs (${configRows.length}) found for phone_number_id:`,
      phoneNumberId
    )
    return null
  }
  return configRows[0]
}

const ECHO_ALLOWED_CONTENT_TYPES = new Set(['text', 'image', 'document', 'audio', 'video'])

/**
 * smb_message_echoes — messages the customer sent from their own
 * WhatsApp Business app (or a linked device) after Coexistence
 * onboarding. Mirrored into `messages` as sender_type='agent' with
 * `origin='whatsapp_app'` so the CRM shows the full conversation
 * regardless of which surface a message went out from. `revoke`/`edit`
 * echoes patch a previously-echoed row instead of inserting a new one.
 *
 * Deliberately skips flows/automations/AI-reply/webhook dispatch —
 * those are customer-inbound triggers; this is business-outbound
 * traffic just mirrored for visibility.
 */
async function handleMessageEchoes(value: SmbMessageEchoesValue) {
  const phoneNumberId = value.metadata?.phone_number_id
  const echoes = value.message_echoes
  if (!phoneNumberId || !echoes || echoes.length === 0) return

  const config = await resolveWhatsAppConfig(phoneNumberId)
  if (!config) return
  const accessToken = decrypt(config.access_token)

  for (const echo of echoes) {
    try {
      if (echo.type === 'revoke' && echo.revoke?.original_message_id) {
        const { error } = await supabaseAdmin()
          .from('messages')
          .update({
            content_text: '[mensagem apagada no WhatsApp Business app]',
            media_url: null,
          })
          .eq('message_id', echo.revoke.original_message_id)
        if (error) console.error('[coexistence] echo revoke update failed:', error)
        continue
      }

      if (echo.type === 'edit' && echo.edit?.original_message_id) {
        const { contentText, mediaUrl } = await parseMessageContent(
          echo.edit.message as unknown as WhatsAppMessage,
          accessToken
        )
        const { error } = await supabaseAdmin()
          .from('messages')
          .update({ content_text: contentText, media_url: mediaUrl })
          .eq('message_id', echo.edit.original_message_id)
        if (error) console.error('[coexistence] echo edit update failed:', error)
        continue
      }

      // Name is unknown here (echoes carry no contact profile) — pass
      // '' rather than the phone number so findOrCreateContact's
      // `if (name && name !== existingContact.name)` guard skips the
      // update branch instead of clobbering a real saved name.
      const customerPhone = normalizePhone(echo.to)
      const contactOutcome = await findOrCreateContact(
        config.account_id,
        config.user_id,
        customerPhone,
        ''
      )
      if (!contactOutcome) continue
      const convResult = await findOrCreateConversation(
        config.account_id,
        config.user_id,
        contactOutcome.contact.id
      )
      if (!convResult) continue

      const { contentText, mediaUrl } = await parseMessageContent(
        echo as unknown as WhatsAppMessage,
        accessToken
      )
      const contentType = ECHO_ALLOWED_CONTENT_TYPES.has(echo.type) ? echo.type : 'text'

      const { error: insertError } = await supabaseAdmin().from('messages').insert({
        conversation_id: convResult.conversation.id,
        sender_type: 'agent',
        content_type: contentType,
        content_text: contentText,
        media_url: mediaUrl,
        message_id: echo.id,
        status: 'sent',
        origin: 'whatsapp_app',
        created_at: new Date(parseInt(echo.timestamp, 10) * 1000).toISOString(),
      })
      if (insertError) {
        console.error('[coexistence] echo message insert failed:', insertError)
        continue
      }

      const { error: convError } = await supabaseAdmin()
        .from('conversations')
        .update({
          last_message_text: contentText || `[${echo.type}]`,
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', convResult.conversation.id)
      if (convError) console.error('[coexistence] echo conversation update failed:', convError)
    } catch (err) {
      console.error('[coexistence] failed to process message echo:', err)
    }
  }
}

/**
 * smb_app_state_sync — the customer's contacts as saved in their own
 * WhatsApp Business app, sent once right after Coexistence onboarding
 * (and again on future adds/edits). 'remove' actions are logged, not
 * applied — deleting the CRM contact would cascade-delete its
 * conversation history (see contacts/conversations FKs), which a
 * customer tidying their phone's address book should not trigger.
 */
async function handleAppStateSync(value: SmbAppStateSyncValue) {
  const phoneNumberId = value.metadata?.phone_number_id
  const entries = value.state_sync
  if (!phoneNumberId || !entries || entries.length === 0) return

  const config = await resolveWhatsAppConfig(phoneNumberId)
  if (!config) return

  for (const entry of entries) {
    if (entry.type !== 'contact' || !entry.contact?.phone_number) continue
    try {
      if (entry.action === 'remove') {
        console.info(
          '[coexistence] state_sync removed contact (not deleted in CRM):',
          entry.contact.phone_number
        )
        continue
      }
      const phone = normalizePhone(entry.contact.phone_number)
      const name = entry.contact.full_name || entry.contact.first_name || ''
      await findOrCreateContact(config.account_id, config.user_id, phone, name)
    } catch (err) {
      console.error('[coexistence] failed to process state_sync contact:', err)
    }
  }

  const { error } = await supabaseAdmin()
    .from('whatsapp_config')
    .update({ contacts_synced_at: new Date().toISOString() })
    .eq('id', config.id)
    .is('contacts_synced_at', null)
  if (error) console.error('[coexistence] contacts_synced_at update failed:', error)
}

/**
 * history — up to 180 days of past messages, delivered in chunks
 * across 3 phases after the customer approves sharing chat history in
 * the Embedded Signup popup. Backfilled messages are tagged
 * `origin='history_import'` and deduped by `message_id` (chunks can be
 * redelivered by Meta, and history can overlap live Cloud API traffic
 * received in the meantime). Deliberately does NOT touch
 * conversations.last_message_text/last_message_at — those must keep
 * reflecting real-time traffic, not decades-old backfill.
 */
async function handleHistorySync(value: HistoryValue) {
  const phoneNumberId = value.metadata?.phone_number_id
  const businessPhone = value.metadata?.display_phone_number ?? null
  const chunks = value.history
  if (!phoneNumberId || !chunks || chunks.length === 0) return

  const config = await resolveWhatsAppConfig(phoneNumberId)
  if (!config) return
  const accessToken = decrypt(config.access_token)

  for (const chunk of chunks) {
    if (chunk.errors && chunk.errors.length > 0) {
      const declined = chunk.errors.some((e) => e.code === 2593109)
      console.warn(
        declined
          ? '[coexistence] customer declined to share chat history'
          : '[coexistence] history sync error:',
        chunk.errors
      )
      continue
    }

    for (const thread of chunk.threads ?? []) {
      const customerPhone = normalizePhone(thread.id)
      const contactOutcome = await findOrCreateContact(
        config.account_id,
        config.user_id,
        customerPhone,
        ''
      )
      if (!contactOutcome) continue
      const convResult = await findOrCreateConversation(
        config.account_id,
        config.user_id,
        contactOutcome.contact.id
      )
      if (!convResult) continue

      for (const msg of thread.messages ?? []) {
        try {
          const { data: existingMsg } = await supabaseAdmin()
            .from('messages')
            .select('id')
            .eq('message_id', msg.id)
            .eq('conversation_id', convResult.conversation.id)
            .maybeSingle()
          if (existingMsg) continue

          const { contentText, mediaUrl } = await parseMessageContent(
            msg as unknown as WhatsAppMessage,
            accessToken
          )
          const contentType = ECHO_ALLOWED_CONTENT_TYPES.has(msg.type) ? msg.type : 'text'
          const senderType =
            businessPhone && phonesMatch(msg.from, businessPhone) ? 'agent' : 'customer'

          const { error: insertError } = await supabaseAdmin().from('messages').insert({
            conversation_id: convResult.conversation.id,
            sender_type: senderType,
            content_type: contentType,
            content_text: contentText,
            media_url: mediaUrl,
            message_id: msg.id,
            status: 'delivered',
            origin: 'history_import',
            created_at: new Date(parseInt(msg.timestamp, 10) * 1000).toISOString(),
          })
          if (insertError) {
            console.error('[coexistence] history message insert failed:', insertError)
          }
        } catch (err) {
          console.error('[coexistence] failed to import history message:', err)
        }
      }
    }

    if (chunk.metadata?.progress === 100 || chunk.metadata?.phase === 2) {
      const { error } = await supabaseAdmin()
        .from('whatsapp_config')
        .update({ history_synced_at: new Date().toISOString() })
        .eq('id', config.id)
      if (error) console.error('[coexistence] history_synced_at update failed:', error)
    }
  }
}

/**
 * account_update — Coexistence disconnection/reconnection events.
 * PARTNER_REMOVED / ACCOUNT_OFFBOARDED both mean the customer's number
 * stopped routing through this app (disconnected in the WhatsApp
 * Business app, downgraded, re-registered elsewhere, etc.) —
 * `disconnection_info.reason` explains which. ACCOUNT_RECONNECTED
 * fires when it comes back after such an event.
 */
async function handleAccountUpdate(value: AccountUpdateValue) {
  const wabaId = value.waba_info?.waba_id
  if (!wabaId) return

  const { data: configRows, error } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('id')
    .eq('waba_id', wabaId)

  if (error) {
    console.error('[coexistence] account_update config lookup failed:', error)
    return
  }
  if (!configRows || configRows.length === 0) return

  const ids = configRows.map((r: { id: string }) => r.id)

  if (value.event === 'PARTNER_REMOVED' || value.event === 'ACCOUNT_OFFBOARDED') {
    console.warn(
      '[coexistence] customer disconnected:',
      wabaId,
      value.disconnection_info?.reason,
      value.disconnection_info?.initiated_by
    )
    const { error: updateError } = await supabaseAdmin()
      .from('whatsapp_config')
      .update({ status: 'disconnected' })
      .in('id', ids)
    if (updateError) console.error('[coexistence] account_update disconnect failed:', updateError)
  } else if (value.event === 'ACCOUNT_RECONNECTED') {
    const { error: updateError } = await supabaseAdmin()
      .from('whatsapp_config')
      .update({ status: 'connected' })
      .in('id', ids)
    if (updateError) console.error('[coexistence] account_update reconnect failed:', updateError)
  }
}

// The happy-path status ladder — pending → sent → delivered → read →
// replied. Webhook replays must never regress a recipient back down
// this ladder.
//
// `failed` is NOT on this ladder. It's a terminal side branch that is
// only valid from the early states (pending / sent) — once Meta has
// delivered or the user has read or replied, a later "failed" status
// event is a bug in Meta's pipeline or a spoof attempt and must be
// ignored.
const RECIPIENT_STATUS_LADDER = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
] as const

function ladderLevel(s: string): number {
  const idx = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(s)
  return idx < 0 ? -1 : idx
}

/**
 * Can a recipient transition from `current` to `incoming`?
 *   - Along the ladder, only forward moves are allowed.
 *   - `failed` is accepted only from `pending` or `sent`; it's refused
 *     once the recipient has reached any of the success states.
 */
function isValidStatusTransition(current: string, incoming: string): boolean {
  if (incoming === 'failed') {
    return current === 'pending' || current === 'sent'
  }
  if (current === 'failed') {
    return false // failed is terminal
  }
  const ci = ladderLevel(current)
  const ii = ladderLevel(incoming)
  if (ii < 0) return false // unknown incoming status
  if (ci < 0) return true // unknown current — accept anything on the ladder
  return ii > ci
}

async function handleStatusUpdate(status: {
  id: string
  status: string
  timestamp: string
  recipient_id: string
  errors?: Array<{
    code: number
    title: string
    message?: string
    error_data?: { details?: string }
  }>
}) {
  // Log Meta's actual rejection reason for failed deliveries — the
  // `messages.status` column only has room for the enum value, so
  // without this a "failed" status is a dead end (had to SSH + psql +
  // guess). Log-only, not persisted.
  if (status.status === 'failed' && status.errors?.length) {
    console.error(
      `[webhook] delivery failed for ${status.id} (${status.recipient_id}):`,
      JSON.stringify(status.errors),
    )
  }

  // 1) Mirror onto messages (legacy behavior) — Meta's status values
  //    already match the CHECK constraint on messages.status. No
  //    `.select()`: message_id is NOT unique (migration 009 — Meta ids
  //    repeat across numbers), so this updates 0..N rows and must not
  //    assume a single row.
  const { error: msgErr } = await supabaseAdmin()
    .from('messages')
    .update({ status: status.status })
    .eq('message_id', status.id)

  if (msgErr) {
    console.error('Error updating message status:', msgErr)
  }

  // Webhook fan-out for this status change happens at the END of this
  // handler (after the broadcast mirror below), so a slow subscriber
  // endpoint can't delay the broadcast_recipients update.

  // 2) Mirror onto broadcast_recipients via whatsapp_message_id
  //    (added in migration 003). The aggregate trigger on
  //    broadcast_recipients re-derives the parent broadcast's
  //    sent/delivered/read/failed counts automatically.
  const tsIso = new Date(parseInt(status.timestamp) * 1000).toISOString()

  const { data: recipient, error: recFetchErr } = await supabaseAdmin()
    .from('broadcast_recipients')
    .select('id, status')
    .eq('whatsapp_message_id', status.id)
    .maybeSingle()

  if (recFetchErr) {
    console.error('Error fetching broadcast recipient:', recFetchErr)
  } else if (
    recipient &&
    // Guard transitions — forward-only on the success ladder, and
    // `failed` only from pre-delivered states.
    isValidStatusTransition(recipient.status, status.status)
  ) {
    const update: Record<string, unknown> = { status: status.status }
    if (status.status === 'sent' && !('sent_at' in update)) update.sent_at = tsIso
    if (status.status === 'delivered') update.delivered_at = tsIso
    if (status.status === 'read') update.read_at = tsIso

    const { error: recUpdateErr } = await supabaseAdmin()
      .from('broadcast_recipients')
      .update(update)
      .eq('id', recipient.id)

    if (recUpdateErr) {
      console.error('Error updating broadcast recipient status:', recUpdateErr)
    }
  }

  // 3) Webhook fan-out for messages we store (inbox / API sends).
  //    Runs last so a slow subscriber can't delay the mirrors above.
  //    Bounded to one row (message_id isn't unique) purely to resolve
  //    the owning account for delivery.
  const { data: msgRow } = await supabaseAdmin()
    .from('messages')
    .select('conversation_id, conversations(account_id)')
    .eq('message_id', status.id)
    .limit(1)
    .maybeSingle()

  if (msgRow) {
    const conv = msgRow.conversations as { account_id: string } | null
    const accountId = conv?.account_id
    if (accountId) {
      await dispatchWebhookEvent(
        supabaseAdmin(),
        accountId,
        'message.status_updated',
        {
          whatsapp_message_id: status.id,
          conversation_id: msgRow.conversation_id,
          status: status.status,
        }
      )
    }
  }
}

/**
 * If an inbound message's sender is on a still-unreplied
 * broadcast_recipients row, flip it to `replied` so the reply count
 * advances on the parent broadcast.
 *
 * Runs on a best-effort basis — failures here must not break the
 * main inbound-message flow, so errors are swallowed with a log.
 */
async function flagBroadcastReplyIfAny(accountId: string, contactId: string) {
  try {
    // Most recent outbound broadcast in this account that hasn't
    // been replied to yet. Account-scoped so a shared inbox reply
    // marks the broadcast as replied regardless of which teammate
    // sent it.
    const { data: recs, error } = await supabaseAdmin()
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1)

    if (error || !recs || recs.length === 0) return

    const row = recs[0]
    const { error: updErr } = await supabaseAdmin()
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', row.id)

    if (updErr) {
      console.error('Error marking broadcast recipient replied:', updErr)
    }
  } catch (err) {
    console.error('flagBroadcastReplyIfAny failed:', err)
  }
}

/**
 * Resolve a Meta-side message_id into the matching internal UUID, scoped
 * to one conversation. Returns null when we never received the parent
 * (e.g. a swipe-reply to a message older than this CRM install).
 */
async function lookupInternalIdByMetaId(
  metaId: string,
  conversationId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('message_id', metaId)
    .eq('conversation_id', conversationId)
    .maybeSingle()
  if (error) {
    console.error('[webhook] lookupInternalIdByMetaId failed:', error.message)
    return null
  }
  return data?.id ?? null
}

/**
 * Persist an inbound reaction. WhatsApp reactions are not new messages —
 * they're per-(target, actor) state. We upsert / delete on
 * `message_reactions`, never write a row into `messages`.
 *
 * Best-effort: a missing parent (we never received it) is logged and
 * skipped so the webhook still acks 200 to Meta.
 */
async function handleReaction(
  message: WhatsAppMessage,
  conversationId: string,
  contactId: string
) {
  const reaction = message.reaction
  if (!reaction?.message_id) return

  const targetInternalId = await lookupInternalIdByMetaId(
    reaction.message_id,
    conversationId
  )
  if (!targetInternalId) {
    console.warn(
      '[webhook] reaction target message not found; skipping',
      reaction.message_id
    )
    return
  }

  // Empty emoji = removal (per Meta's Cloud API spec).
  if (!reaction.emoji) {
    const { error: delError } = await supabaseAdmin()
      .from('message_reactions')
      .delete()
      .eq('message_id', targetInternalId)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId)
    if (delError) {
      console.error('[webhook] reaction delete failed:', delError.message)
    }
    return
  }

  const { error: upsertError } = await supabaseAdmin()
    .from('message_reactions')
    .upsert(
      {
        message_id: targetInternalId,
        conversation_id: conversationId,
        actor_type: 'customer',
        actor_id: contactId,
        emoji: reaction.emoji,
      },
      { onConflict: 'message_id,actor_type,actor_id' }
    )
  if (upsertError) {
    console.error('[webhook] reaction upsert failed:', upsertError.message)
  }
}

async function processMessage(
  message: WhatsAppMessage,
  contact: { profile: { name: string }; wa_id: string },
  // Tenancy. Resolved from the matched whatsapp_config row; every
  // contact / conversation / message row created downstream is
  // stamped with this so any member of the account can see it.
  accountId: string,
  // Sender-of-record for inserts that need a NOT NULL user_id FK
  // (contacts, conversations). Always the admin who saved the
  // WhatsApp config; the choice is arbitrary post-017 but stable.
  configOwnerUserId: string,
  accessToken: string
) {
  const senderPhone = normalizePhone(message.from)
  const contactName = contact.profile.name

  // Find or create contact
  const contactOutcome = await findOrCreateContact(
    accountId,
    configOwnerUserId,
    senderPhone,
    contactName
  )
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  // Find or create conversation
  const convResult = await findOrCreateConversation(
    accountId,
    configOwnerUserId,
    contactRecord.id
  )
  if (!convResult) return
  const conversation = convResult.conversation

  // Emit conversation.created as soon as the thread is opened — BEFORE
  // the reaction short-circuit below — so a conversation first opened by
  // a reaction still fires the event, and a subscriber always sees the
  // thread open before its first message.received.
  if (convResult.created) {
    await dispatchWebhookEvent(supabaseAdmin(), accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
    })
    // Auto-assign to the next agent in line, if the account has
    // round-robin turned on. Only ever runs on a brand-new
    // conversation — an existing one keeps whoever (if anyone) it's
    // already assigned to.
    await maybeAssignRoundRobin(supabaseAdmin(), accountId, conversation.id)
  }

  // Reactions short-circuit here — they aren't messages. We never insert
  // into `messages`, never bump unread_count, never update last_message_text.
  // Done before parseMessageContent so the media-URL fetch is skipped.
  if (message.type === 'reaction') {
    await handleReaction(message, conversation.id, contactRecord.id)
    return
  }

  // Parse message content based on type
  const { contentText, mediaUrl, mediaType, interactiveReplyId } =
    await parseMessageContent(message, accessToken)

  // Resolve swipe-reply context if present. A missing parent is fine —
  // we just store NULL and the UI renders the message without a quote.
  let replyToInternalId: string | null = null
  if (message.context?.id) {
    replyToInternalId = await lookupInternalIdByMetaId(
      message.context.id,
      conversation.id
    )
    if (!replyToInternalId) {
      console.warn(
        '[webhook] reply context parent not found:',
        message.context.id
      )
    }
  }

  // Insert message — field names MUST match the messages table schema
  // (see supabase/migrations/001_initial_schema.sql):
  //   conversation_id, sender_type, content_type, content_text,
  //   media_url, template_name, message_id, status, created_at
  // `mediaType` is intentionally unused — the schema has no media_type
  // column; the MIME type is only used to construct the proxy URL during
  // parseMessageContent. Silence the unused-var warning:
  void mediaType

  // The messages.content_type CHECK constraint (widened in migration 010
  // to add 'interactive' for button/list taps) allows:
  //   text, image, document, audio, video, location, template, interactive
  // Map incoming WhatsApp types that aren't in that list to the closest
  // allowed value so the INSERT doesn't fail with a constraint error.
  const ALLOWED_CONTENT_TYPES = new Set([
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive',
  ])
  const contentType = ALLOWED_CONTENT_TYPES.has(message.type)
    ? message.type
    : message.type === 'sticker'
      ? 'image'   // stickers are images
      : 'text'    // reaction, unknown → text fallback

  // Determine whether this is the contact's very first inbound message
  // BEFORE we insert, so the count is accurate. Covers the case where
  // the contact row already exists (manual add / CSV import) but they've
  // never messaged us before — which new_contact_created wouldn't catch.
  const { count: priorCustomerMsgCount } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  const { error: msgError } = await supabaseAdmin().from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'customer',
    content_type: contentType,
    content_text: contentText,
    media_url: mediaUrl,
    message_id: message.id,
    status: 'delivered',
    created_at: new Date(parseInt(message.timestamp) * 1000).toISOString(),
    reply_to_message_id: replyToInternalId,
    // Only populated for content_type='interactive'. Migration 010 added
    // the column; null for every other content_type so existing inserts
    // behave identically.
    interactive_reply_id: interactiveReplyId,
  })

  if (msgError) {
    console.error('Error inserting message:', msgError)
    return
  }

  // Update conversation
  const { error: convError } = await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: contentText || `[${message.type}]`,
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)

  if (convError) {
    console.error('Error updating conversation:', convError)
  }

  // If this contact was a recent broadcast recipient, flag the reply
  // so the broadcast's `replied_count` advances (via the aggregate
  // trigger installed in migration 003).
  await flagBroadcastReplyIfAny(accountId, contactRecord.id)

  // ============================================================
  // Flow runner dispatch.
  //
  // If the runner consumes the message (it either advanced an active
  // run or started a new one), we suppress the `new_message_received`
  // + `keyword_match` automation triggers for this inbound. Customer
  // is navigating the bot menu, not sending a fresh trigger word
  // that should fork into automations.
  //
  // The relationship-level triggers (`new_contact_created`,
  // `first_inbound_message`) still fire even when consumed — those
  // are about WHO is messaging, not what they said.
  //
  // Awaited (not fire-and-forget) because we need the `consumed`
  // result before deciding whether to dispatch automations. The
  // runner has its own try/catch and never throws. Accounts with
  // no active flows take the runner's early-exit "no_match" path
  // basically for free (one indexed SELECT for the active run).
  // ============================================================
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message:
      interactiveReplyId
        ? {
            kind: 'interactive_reply',
            reply_id: interactiveReplyId,
            reply_title: contentText ?? '',
            meta_message_id: message.id,
          }
        : {
            kind: 'text',
            text: contentText ?? message.text?.body ?? '',
            meta_message_id: message.id,
          },
    isFirstInboundMessage,
  })
  const flowConsumed = flowResult.consumed

  // Fire any automations that react to this webhook event. All dispatches
  // run here (not earlier) so the contact, conversation, and inbound
  // message all exist before any step — including send_message — runs.
  // Fire-and-forget: a slow or failing automation must not block the
  // webhook's 200 OK response to Meta.
  const inboundText = contentText ?? message.text?.body ?? ''
  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
    | 'interactive_reply'
  )[] = []
  // Content-level triggers are suppressed when a flow consumed the
  // message — see the comment block above.
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match')
    // Interactive tap → fire the interactive_reply trigger too (only
    // meaningful when a button/list reply actually arrived). Enables
    // automation-only chained menus; when a Flow owns the menu it will
    // have consumed the reply and this is skipped.
    if (interactiveReplyId) {
      automationTriggers.push('interactive_reply')
    }
  }
  // new_contact_created fires only when the webhook just auto-created the
  // contact row. first_inbound_message fires whenever this is the contact's
  // first-ever customer-sent message — a superset that also catches
  // manually-imported contacts sending for the first time. We dispatch both
  // so users can pick whichever semantic they want; an automation that
  // listens to only one trigger runs only when that trigger matches.
  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')
  for (const triggerType of automationTriggers) {
    runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: contactRecord.id,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
        // Only set on interactive taps; drives the interactive_reply
        // trigger's exact-id match.
        interactive_reply_id: interactiveReplyId ?? undefined,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err))
  }

  // AI auto-reply. Runs only for plain-text inbound the deterministic
  // flow runner did NOT consume (flows win over the LLM), and only when
  // the account has enabled it. Awaited inside `after()` (same reason as
  // the webhook dispatch below); `dispatchInboundToAiReply` owns its
  // eligibility gates + try/catch and never throws.
  if (!flowConsumed && !interactiveReplyId && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId,
      conversationId: conversation.id,
      contactId: contactRecord.id,
      configOwnerUserId,
    })
  }

  // message.received webhook (public API). Awaited — not fire-and-forget
  // — because we're inside the route's `after()` block, which only keeps
  // the function alive for promises it can see; a detached promise could
  // be frozen before it delivers. `dispatchWebhookEvent` early-exits
  // when the account has no matching endpoint and never throws.
  // (conversation.created is emitted earlier, right after the thread is
  // opened.)
  await dispatchWebhookEvent(supabaseAdmin(), accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactRecord.id,
    whatsapp_message_id: message.id,
    content_type: contentType,
    text: contentText,
  })
}

async function parseMessageContent(
  message: WhatsAppMessage,
  accessToken: string
): Promise<{
  contentText: string | null
  mediaUrl: string | null
  mediaType: string | null
  /**
   * For interactive button / list replies: the stable id of the tapped
   * option (whatever we put on the button when sending). Used by the
   * Flows engine to advance the per-contact run; persisted to
   * `messages.interactive_reply_id` so the inbox bubble can render the
   * tap with the right affordance. Null for everything else.
   */
  interactiveReplyId: string | null
}> {
  // getMediaUrl signature is (mediaId, accessToken) — earlier code had
  // the args swapped, so every verification hit an invalid Meta URL and
  // fell through to the catch block, leaving mediaUrl as null. That's
  // why images showed up as empty bubbles in the inbox.
  const verifyAndBuildUrl = async (
    mediaId: string
  ): Promise<string | null> => {
    try {
      await getMediaUrl({ mediaId, accessToken })
      return `/api/whatsapp/media/${mediaId}`
    } catch (error) {
      console.error(
        `Failed to verify media ${mediaId} with Meta:`,
        error instanceof Error ? error.message : error
      )
      return null
    }
  }

  // Default shape — each case overrides only the fields it cares about.
  // Keeps the new `interactiveReplyId` field DRY across every return site.
  const empty = {
    contentText: null,
    mediaUrl: null,
    mediaType: null,
    interactiveReplyId: null,
  }

  switch (message.type) {
    case 'text':
      return { ...empty, contentText: message.text?.body || null }

    case 'image':
      if (message.image?.id) {
        return {
          ...empty,
          contentText: message.image.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.image.id),
          mediaType: message.image.mime_type,
        }
      }
      return empty

    case 'video':
      if (message.video?.id) {
        return {
          ...empty,
          contentText: message.video.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.video.id),
          mediaType: message.video.mime_type,
        }
      }
      return empty

    case 'document':
      if (message.document?.id) {
        return {
          ...empty,
          contentText:
            message.document.caption || message.document.filename || null,
          mediaUrl: await verifyAndBuildUrl(message.document.id),
          mediaType: message.document.mime_type,
        }
      }
      return empty

    case 'audio':
      if (message.audio?.id) {
        return {
          ...empty,
          mediaUrl: await verifyAndBuildUrl(message.audio.id),
          mediaType: message.audio.mime_type,
        }
      }
      return empty

    case 'sticker':
      // Stickers are images under the hood. Treat them as such so the
      // MessageBubble renders the <img>. The caller maps the DB
      // content_type to 'image' for the CHECK constraint.
      if (message.sticker?.id) {
        return {
          ...empty,
          mediaUrl: await verifyAndBuildUrl(message.sticker.id),
          mediaType: message.sticker.mime_type,
        }
      }
      return empty

    case 'location':
      if (message.location) {
        const loc = message.location
        const locationText = [loc.name, loc.address, `${loc.latitude},${loc.longitude}`]
          .filter(Boolean)
          .join(' - ')
        return { ...empty, contentText: locationText }
      }
      return empty

    case 'reaction':
      return { ...empty, contentText: message.reaction?.emoji || null }

    case 'interactive': {
      // The customer tapped a reply button or a list row on a message
      // we previously sent. Meta delivers `interactive.button_reply` for
      // 3-button messages and `interactive.list_reply` for list messages.
      // Use the human-readable title as contentText so the inbox bubble
      // renders the tap legibly ("Existing customer"), and stash the
      // stable id separately so the Flows engine can route on it.
      const reply =
        message.interactive?.button_reply ?? message.interactive?.list_reply
      if (reply?.id) {
        return {
          ...empty,
          contentText: reply.title || reply.id,
          interactiveReplyId: reply.id,
        }
      }
      return { ...empty, contentText: '[Interactive reply]' }
    }

    case 'button':
      // Quick-reply button tap on a template message (broadcast/automation
      // dispatch). Use payload as the stable id — same role interactive's
      // reply.id plays — so the Flows engine can route on it.
      if (message.button) {
        return {
          ...empty,
          contentText: message.button.text || message.button.payload || null,
          interactiveReplyId: message.button.payload || null,
        }
      }
      return empty

    default:
      return {
        ...empty,
        contentText: `[Unsupported message type: ${message.type}]`,
      }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContactRow = any

interface ContactOutcome {
  contact: ContactRow
  /** True when this call created the row; drives new_contact_created
   *  automation dispatch in processMessage. */
  wasCreated: boolean
}

async function findOrCreateContact(
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string
): Promise<ContactOutcome | null> {
  // Find an existing contact for this account by phone. The shared
  // helper pre-filters in SQL by the last-8-digit suffix (so we don't
  // pull every contact on every inbound message) then applies the
  // strict `phonesMatch` in JS on the small candidate set. The same
  // helper backs the manual contact form and CSV import, so all three
  // paths agree on what "same number" means (issue #212).
  const existingContact = await findExistingContact(
    supabaseAdmin(),
    accountId,
    phone,
  )

  if (existingContact) {
    // Update name if it changed
    if (name && name !== existingContact.name) {
      await supabaseAdmin()
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existingContact.id)
    }
    return { contact: existingContact, wasCreated: false }
  }

  // Create new contact. account_id is the tenancy column;
  // user_id is the NOT NULL FK audit column (no inbound message
  // has a single "user who created" it — we attribute to the
  // WhatsApp config owner as a stable default).
  const { data: newContact, error: createError } = await supabaseAdmin()
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone,
      name: name || phone,
    })
    .select()
    .single()

  if (createError) {
    // Lost a race: a concurrent inbound delivery (or another path)
    // created this contact between our lookup and insert, and the
    // unique index (migration 022) rejected the duplicate. Re-resolve
    // the existing row instead of dropping the message.
    if (isUniqueViolation(createError)) {
      const raced = await findExistingContact(supabaseAdmin(), accountId, phone)
      if (raced) return { contact: raced, wasCreated: false }
    }
    console.error('Error creating contact:', createError)
    return null
  }

  return { contact: newContact, wasCreated: true }
}

async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
) {
  // Look for an existing conversation in this account, oldest-first.
  //
  // We deliberately do NOT use `.single()` here. `.single()` errors on
  // *both* 0 rows and ≥2 rows, and the old code treated any error as
  // "none found" and inserted a new row. So once two conversations
  // existed for a contact (from a race — Meta retries a delivery, or a
  // batch fans out to concurrent runs), every subsequent inbound
  // message errored on the lookup and created yet another conversation,
  // snowballing into a wall of duplicate chats (issue #363).
  //
  // Ordering oldest-first and taking one row makes the lookup resolve to
  // the same canonical survivor the dedup migration (036) keeps, so any
  // pre-existing duplicates converge instead of compounding.
  const { data: existingRows, error: findError } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)

  if (findError) {
    console.error('Error finding conversation:', findError)
    return null
  }

  if (existingRows && existingRows.length > 0) {
    return { conversation: existingRows[0], created: false }
  }

  // Create new conversation. Same tenancy + audit split as
  // findOrCreateContact above.
  const { data: newConv, error: createError } = await supabaseAdmin()
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      contact_id: contactId,
    })
    .select()
    .single()

  if (createError) {
    // Lost a race: a concurrent inbound delivery created the
    // conversation between our lookup and insert, and the unique index
    // (migration 036) rejected the duplicate. Re-resolve the winning
    // row instead of dropping the message — mirrors findOrCreateContact.
    if (isUniqueViolation(createError)) {
      const { data: raced } = await supabaseAdmin()
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1)
      if (raced && raced.length > 0) {
        return { conversation: raced[0], created: false }
      }
    }
    console.error('Error creating conversation:', createError)
    return null
  }

  return { conversation: newConv, created: true }
}
