import { NextResponse } from 'next/server'
import {
  sendMessageToConversation,
  findOrCreateConversation,
  SendMessageError,
} from '@/lib/whatsapp/send-message'
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder'
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'
import { findOrCreateContact, ContactError } from '@/lib/api/v1/contacts'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import {
  requireWrite,
  toErrorResponse,
  UnauthorizedError,
  ForbiddenError,
  PaymentRequiredError,
} from '@/lib/auth/account'

interface BroadcastResult {
  phone: string
  status: 'sent' | 'failed'
  whatsapp_message_id?: string
  error?: string
}

/**
 * Two input shapes are accepted:
 *
 *   NEW (preferred — supports per-recipient variable substitution AND
 *   carries the contact so the send lands in that contact's inbox
 *   thread):
 *     {
 *       recipients: Array<{ phone: string; contact_id?: string; params: string[] }>,
 *       template_name, template_language
 *     }
 *
 *   LEGACY (all phones receive the same params, no contact_id — kept
 *   so existing callers don't break; the contact is found/created by
 *   phone instead):
 *     {
 *       phone_numbers: string[],
 *       template_params: string[],
 *       template_name, template_language
 *     }
 */
interface NewRecipient {
  phone: string
  /** Resolved client-side (the audience is always a `contacts` row) —
   *  lets each send reuse that contact's conversation instead of
   *  sending "into the void" the way the old raw Meta-API call did. */
  contact_id?: string
  /** Body variable values, one per {{N}}. Legacy field. */
  params?: string[]
  /**
   * Template body with `params` already substituted in — persisted
   * verbatim as `messages.content_text` so the bubble shows real text
   * instead of an empty template card. Optional so legacy callers that
   * predate this field don't break; the send still goes through, it
   * just renders with no body text.
   */
  content_text?: string
  /**
   * Structured per-send values (header text variable, media URL
   * override, URL/COPY_CODE button values). When set, takes
   * precedence over `params` for the body too — see
   * sendMessageToConversation for the merge rules.
   */
  messageParams?: SendTimeParams
}

export async function POST(request: Request) {
  try {
    // requireWrite('agent') = auth + account + role + the billing
    // write-lock in one call. Same rationale as /api/whatsapp/send —
    // a fan-out loop that sends real WhatsApp messages must never
    // start for a billing-locked account.
    const { supabase, accountId, userId } = await requireWrite('agent')

    // Per-user broadcast budget. Note: this limits how often a user
    // can *start* a campaign, not how many messages go out inside
    // one — the fan-out loop below runs without additional gating.
    const limit = checkRateLimit(`broadcast:${userId}`, RATE_LIMITS.broadcast)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const {
      recipients: newRecipients,
      phone_numbers,
      template_name,
      template_language,
      template_params,
    } = body

    // Normalize to a list of {phone, contact_id?, params} regardless
    // of shape.
    let recipients: NewRecipient[]
    if (Array.isArray(newRecipients) && newRecipients.length > 0) {
      recipients = newRecipients
    } else if (Array.isArray(phone_numbers) && phone_numbers.length > 0) {
      const shared: string[] = Array.isArray(template_params)
        ? template_params
        : []
      recipients = phone_numbers.map((phone: string) => ({
        phone,
        params: shared,
      }))
    } else {
      return NextResponse.json(
        {
          error:
            'Provide either `recipients` (preferred) or `phone_numbers` — must be a non-empty array',
        },
        { status: 400 }
      )
    }

    if (!template_name) {
      return NextResponse.json(
        { error: 'template_name is required' },
        { status: 400 }
      )
    }

    const results: BroadcastResult[] = []
    let sentCount = 0
    let failedCount = 0

    for (const recipient of recipients) {
      const sanitized = sanitizePhoneForMeta(recipient.phone)

      if (!isValidE164(sanitized)) {
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: 'Invalid phone number format',
        })
        failedCount++
        continue
      }

      try {
        // Legacy `phone_numbers` callers have no contact_id — find or
        // create the contact by phone, same dedupe the webhook and
        // the public API use, so every broadcast recipient still maps
        // to exactly one contact/conversation.
        const contactId =
          recipient.contact_id ??
          (
            await findOrCreateContact(supabase, accountId, userId, {
              phone: sanitized,
            })
          ).id

        const conversationId = await findOrCreateConversation(
          supabase,
          accountId,
          userId,
          contactId,
        )
        if (!conversationId) {
          throw new Error('Failed to open a conversation for this contact')
        }

        // Delegate to the shared send core (validates, sends to Meta
        // with phone-variant + BSUID retry, persists into `messages`,
        // updates the conversation preview, pauses active flow runs) —
        // the exact same path a manually-typed message takes, so a
        // broadcasted template shows up in the contact's thread too.
        const result = await sendMessageToConversation(supabase, accountId, {
          conversationId,
          messageType: 'template',
          contentText: recipient.content_text,
          templateName: template_name,
          templateLanguage: template_language || 'pt_BR',
          templateMessageParams: recipient.messageParams,
          templateParams: recipient.params ?? [],
        })

        results.push({
          phone: recipient.phone,
          status: 'sent',
          whatsapp_message_id: result.whatsappMessageId,
        })
        sentCount++
      } catch (error) {
        const errorMessage =
          error instanceof SendMessageError || error instanceof ContactError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Unknown error'
        console.error(
          `Failed to send broadcast to ${recipient.phone}:`,
          errorMessage
        )
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: errorMessage,
        })
        failedCount++
      }
    }

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      results,
    })
  } catch (error) {
    if (
      error instanceof UnauthorizedError ||
      error instanceof ForbiddenError ||
      error instanceof PaymentRequiredError
    ) {
      return toErrorResponse(error)
    }
    console.error('Error in WhatsApp broadcast POST:', error)
    return NextResponse.json(
      { error: 'Failed to process broadcast' },
      { status: 500 }
    )
  }
}
