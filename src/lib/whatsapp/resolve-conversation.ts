// ============================================================
// Resolve (or create) the conversation for a phone number.
//
// The dashboard composer always has a `conversation_id` in hand. The
// public API doesn't — an external automation knows a *phone number*,
// not an internal UUID. This helper bridges that: given an E.164
// phone, it finds-or-creates the contact and its conversation so the
// shared `sendMessageToConversation` core can run unchanged.
//
// It deliberately reuses the exact find-or-create logic the inbound
// webhook uses (the `findExistingContact` dedupe helper, the
// one-conversation-per-(account, contact) convention, the
// account_id-tenancy / user_id-audit split) so a contact created via
// the API is indistinguishable from one created by an inbound message.
//
// Audit user: created rows need a NOT NULL `user_id`. As with the
// webhook (where there's no logged-in human either), we attribute
// them to the WhatsApp config owner — a stable account-level default.
// ============================================================

import { ConversationError, findOrCreateConversation } from '@/lib/conversations/find-or-create';
import type { SupabaseClient } from '@supabase/supabase-js';

import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { SendMessageError } from '@/lib/whatsapp/send-message';
import { resolveAuditUserId, ContactError, findOrCreateContactRecord } from '@/lib/contacts/service';

export interface ResolvedConversation {
  conversationId: string;
  contactId: string;
  /** True if this call created the contact (vs matched an existing one). */
  contactCreated: boolean;
}

/**
 * Find or create the contact + conversation for `phone` within
 * `accountId`. Throws `SendMessageError` (shared with the send core,
 * so the route maps one error family) on a bad phone, a missing
 * WhatsApp config, or a DB failure.
 */
export async function resolveConversationByPhone(
  db: SupabaseClient,
  accountId: string,
  phone: string,
  name?: string | null
): Promise<ResolvedConversation> {
  const sanitized = sanitizePhoneForMeta(phone);
  if (!isValidE164(sanitized)) {
    throw new SendMessageError(
      'bad_request',
      "'to' must be a valid phone number in E.164 format (e.g. +14155550123)",
      400
    );
  }

  // Fail fast (and create nothing) when the account has no WhatsApp
  // connected — the same error the send would raise anyway.
  const { data: config } = await db
    .from('whatsapp_config')
    .select('id')
    .eq('account_id', accountId)
    .maybeSingle();
  if (!config) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp não configurado. Configure a integração do WhatsApp primeiro.',
      400
    );
  }

  // Audit user for created rows = the single account-wide default used
  // by every public-API write (see resolveAuditUserId), so a contact
  // created here is attributed identically to one created via
  // POST /api/v1/contacts. resolveAuditUserId throws ContactError only
  // if the owner can't be resolved — remap it to the send error family
  // the callers already handle.
  let ownerUserId: string;
  try {
    ownerUserId = await resolveAuditUserId(db, accountId);
  } catch (err) {
    if (err instanceof ContactError) {
      throw new SendMessageError('db_error', err.message, err.status);
    }
    throw err;
  }

  // ---- contact -------------------------------------------------
  let contactId: string;
  let contactCreated: boolean;
  try {
    const { contact, created } = await findOrCreateContactRecord(db, {
      accountId,
      ownerUserId,
      contact: { phone: sanitized, name },
      backfill: true,
    });
    contactId = contact.id;
    contactCreated = created;
  } catch (err) {
    if (err instanceof ContactError) {
      throw new SendMessageError('db_error', 'Não foi possível criar o contato', 500);
    }
    throw err;
  }

  // ---- conversation -------------------------------------------
  // One conversation per (account, contact) — same convention as the
  // webhook. Order oldest-first and take one row rather than
  // `.maybeSingle()`, which errors on ≥2 rows: if duplicates predate the
  // unique index (migration 036), we resolve to the canonical survivor
  // instead of falling through and creating yet another (issue #363).
  const conversationId = await findOrCreateConversationRow(
    db,
    accountId,
    contactId,
    ownerUserId
  );

  return { conversationId, contactId, contactCreated };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The conversation of a WhatsApp GROUP, by its id. A group has no phone to
 * resolve by, so the public API addresses it with `conversation_id`. It
 * only accepts groups: reaching a 1:1 contact stays tied to its phone
 * number (and to the Cloud API rules), never to a guessed conversation id.
 */
export async function resolveGroupConversation(
  db: SupabaseClient,
  accountId: string,
  conversationId: string
): Promise<ResolvedConversation> {
  if (!UUID_RE.test(conversationId)) {
    throw new SendMessageError('bad_request', "'conversation_id' must be a conversation id", 400);
  }
  const { data: conversation } = await db
    .from('conversations')
    .select('id, contact_id, contact:contacts(is_group)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!conversation) {
    throw new SendMessageError('not_found', 'Conversa não encontrada', 404);
  }
  const contact = conversation.contact as { is_group?: boolean } | { is_group?: boolean }[] | null;
  const isGroup = Array.isArray(contact) ? contact[0]?.is_group : contact?.is_group;
  if (!isGroup) {
    throw new SendMessageError(
      'bad_request',
      "'conversation_id' only works for WhatsApp groups; use 'to' (a phone number) for a contact",
      400
    );
  }
  return { conversationId: conversation.id, contactId: conversation.contact_id, contactCreated: false };
}

/** The conversation for `(accountId, contactId)`, as the send pipeline's
 *  `SendMessageError` on failure. */
async function findOrCreateConversationRow(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  ownerUserId: string
): Promise<string> {
  try {
    const { conversation } = await findOrCreateConversation(db, {
      accountId,
      contactId,
      ownerUserId,
    });
    return conversation.id;
  } catch (err) {
    if (err instanceof ConversationError) {
      console.error(`[resolve-conversation] conversation ${err.stage} error:`, err.detail);
      throw new SendMessageError(
        'db_error',
        err.stage === 'lookup'
          ? 'Não foi possível localizar a conversa'
          : 'Não foi possível criar a conversa',
        500
      );
    }
    throw err;
  }
}
