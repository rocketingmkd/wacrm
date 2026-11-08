// ============================================================
// Contact domain logic: find-or-create, audit attribution and tag
// sync. Used by the public API (v1), the dashboard routes and the
// WhatsApp send/webhook paths, so it lives here rather than in the
// versioned API layer. The API response shape stays in
// `@/lib/api/v1/contacts`.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  findExistingContact,
  findExistingContactByWaUserId,
  isUniqueViolation,
  type ExistingContact,
} from '@/lib/contacts/dedupe';
import { resolveImportTagIds } from '@/lib/contacts/resolve-import-tags';
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';

/** Thrown by the helpers below; routes map `.status`/`.message`. */
export class ContactError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ContactError';
    this.status = status;
  }
}

/**
 * Resolve the audit `user_id` for API-created rows — the SINGLE source
 * of truth used by every public-API write (contacts, messages,
 * broadcasts, resolve-conversation), so the same key's writes are
 * always attributed to the same human. API callers have no logged-in
 * user, so — like the inbound webhook — we attribute writes to the
 * **WhatsApp config owner** (the webhook's own convention). Contacts
 * can be created before WhatsApp is connected, so we fall back to the
 * account owner when there's no config yet.
 */
export async function resolveAuditUserId(
  db: SupabaseClient,
  accountId: string
): Promise<string> {
  const { data: config } = await db
    .from('whatsapp_config')
    .select('user_id')
    .eq('account_id', accountId)
    .maybeSingle();
  const configOwner = config?.user_id as string | undefined;
  if (configOwner) return configOwner;

  const { data: account } = await db
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .maybeSingle();
  const owner = account?.owner_user_id as string | undefined;
  if (!owner) {
    throw new ContactError('Account owner could not be resolved', 500);
  }
  return owner;
}

export interface ContactInput {
  phone: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
}

/** Who a contact is, as far as the caller knows. At least one of `phone`
 *  and `waUserId` is required. */
export interface ContactIdentity {
  phone: string | null;
  /** Business-scoped user id, for senders that message via a username.
   *  Used to find the contact when there is no phone. */
  waUserId?: string | null;
  waUsername?: string | null;
  /** Left empty when unknown. A contact without a name is stored with
   *  `name = null`; the UI falls back to the phone or username. */
  name?: string | null;
  email?: string | null;
  company?: string | null;
}

export interface FindOrCreateContactArgs {
  accountId: string;
  /** Audit `user_id` stamped on a newly created contact. */
  ownerUserId: string;
  contact: ContactIdentity;
  /**
   * When the contact already exists, fill in what this call learned: a
   * changed name, and whichever identity (phone, BSUID, username) the
   * stored row lacks. Never overwrites a stored value with null. Off for
   * callers that only want to resolve the contact.
   */
  backfill: boolean;
}

/**
 * The single place a contact is found or created from a phone and/or a
 * BSUID: the inbound webhook, API and dashboard sends, broadcasts and
 * "start a conversation" all go through here.
 *
 * Lookup uses the shared dedupe helpers (phone first, with the
 * last-8-digit tolerance, then BSUID), so every path agrees on what "the
 * same number" means (issue #212). Two concurrent creators are
 * reconciled by the unique indexes (migrations 022 and 039): the loser
 * gets a 23505 and re-resolves the winning row.
 *
 * Returns the full contact row. Throws `ContactError` when the contact
 * can't be created.
 */
export async function findOrCreateContactRecord(
  db: SupabaseClient,
  args: FindOrCreateContactArgs
): Promise<{ contact: ExistingContact; created: boolean }> {
  const { accountId, ownerUserId, backfill } = args;
  const { phone, email, company } = args.contact;
  const waUserId = args.contact.waUserId ?? null;
  const waUsername = args.contact.waUsername ?? null;
  const name = args.contact.name || null;

  if (!phone && !waUserId) {
    throw new ContactError('A contact needs a phone number or a WhatsApp user id', 400);
  }

  const find = () =>
    phone
      ? findExistingContact(db, accountId, phone)
      : findExistingContactByWaUserId(db, accountId, waUserId as string);

  const existing = await find();
  if (existing) {
    if (backfill) {
      const patch: Record<string, unknown> = {};
      if (name && name !== existing.name) patch.name = name;
      if (phone && !existing.phone) patch.phone = phone;
      if (waUserId && !existing.wa_user_id) patch.wa_user_id = waUserId;
      if (waUsername && existing.wa_username !== waUsername) patch.wa_username = waUsername;
      if (Object.keys(patch).length > 0) {
        patch.updated_at = new Date().toISOString();
        await db.from('contacts').update(patch).eq('id', existing.id);
      }
    }
    return { contact: existing, created: false };
  }

  const { data: created, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      phone,
      wa_user_id: waUserId,
      wa_username: waUsername,
      name,
      email: email ?? null,
      company: company ?? null,
    })
    .select('*')
    .single();

  if (!error && created) {
    return { contact: created as ExistingContact, created: true };
  }

  // Lost a race against a concurrent create: the unique index rejected
  // the duplicate. Re-resolve to the winner instead of failing.
  if (isUniqueViolation(error)) {
    const raced = await find();
    if (raced) return { contact: raced, created: false };
  }

  console.error('[contacts] create error:', error);
  throw new ContactError('Failed to create contact', 500);
}

/**
 * Find (by fuzzy phone match) or create a contact in `accountId` from a
 * phone number the caller typed or an API client sent. Returns the
 * contact id and whether it was created. An existing contact is left
 * as it is.
 */
export async function findOrCreateContact(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  input: ContactInput
): Promise<{ id: string; created: boolean }> {
  const sanitized = sanitizePhoneForMeta(input.phone);
  if (!isValidE164(sanitized)) {
    throw new ContactError(
      "'phone' must be a valid phone number in E.164 format (e.g. +14155550123)",
      400
    );
  }

  const { contact, created } = await findOrCreateContactRecord(db, {
    accountId,
    ownerUserId: auditUserId,
    contact: {
      phone: sanitized,
      name: input.name,
      email: input.email,
      company: input.company,
    },
    backfill: false,
  });
  return { id: contact.id, created };
}

/**
 * Replace a contact's tags to exactly match `tagNames` (case-
 * insensitive; missing tags are created). A no-op when `tagNames` is
 * undefined — pass `[]` to clear all tags. Reuses `resolveImportTagIds`
 * so API and CSV-import tag handling stay consistent.
 */
export async function setContactTags(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  contactId: string,
  tagNames: string[]
): Promise<void> {
  const { tagIdByKey } = await resolveImportTagIds(db, {
    accountId,
    userId: auditUserId,
    tagNames,
    canCreateTags: true,
  });
  const desired = new Set(tagIdByKey.values());

  // Diff against the current joins rather than delete-all-then-insert:
  // a diff only touches tags that actually change, so a mid-operation
  // failure can never wipe tags that were meant to stay. Every write
  // is error-checked and surfaced as a ContactError (→ 500) instead of
  // being swallowed behind a misleading 200.
  const { data: current, error: readErr } = await db
    .from('contact_tags')
    .select('tag_id')
    .eq('contact_id', contactId);
  if (readErr) {
    throw new ContactError('Failed to read contact tags', 500);
  }
  const existing = new Set(
    (current ?? []).map((r) => r.tag_id as string)
  );

  const toAdd = [...desired].filter((id) => !existing.has(id));
  const toRemove = [...existing].filter((id) => !desired.has(id));

  if (toRemove.length > 0) {
    const { error } = await db
      .from('contact_tags')
      .delete()
      .eq('contact_id', contactId)
      .in('tag_id', toRemove);
    if (error) throw new ContactError('Failed to update contact tags', 500);
  }
  if (toAdd.length > 0) {
    for (const tagId of toAdd) {
      try {
        await addContactTagAndDispatch({
          db,
          accountId,
          contactId,
          tagId,
        });
      } catch (error) {
        console.error('[api/v1/contacts] tag add failed:', error);
        throw new ContactError('Failed to update contact tags', 500);
      }
    }
  }
}
