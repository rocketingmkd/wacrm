import type { SupabaseClient } from '@supabase/supabase-js'

import { isUniqueViolation } from '@/lib/contacts/dedupe'

/**
 * The single conversation for `(accountId, contactId)`: find it, or
 * create it. Every path that needs a conversation for a contact goes
 * through here (inbound webhook, API and dashboard sends, broadcasts,
 * group messages), so they all resolve to the same row.
 *
 * Lookup is oldest-first with `limit(1)`, never `.single()` or
 * `.maybeSingle()`. Those error on 2 or more rows, and treating that
 * error as "none found" used to insert yet another conversation, so one
 * race snowballed into a wall of duplicate chats (issue #363). Taking
 * the oldest row resolves to the same survivor the dedup migration (036)
 * keeps, so any leftover duplicates converge instead of compounding.
 *
 * Two concurrent creators are reconciled by the unique index from
 * migration 036: the loser gets a 23505 and re-resolves the winning row.
 *
 * A failed lookup is never read as "no conversation". It throws a
 * `ConversationError` with `stage: 'lookup'`, and each caller decides
 * how to surface that (the webhook logs and drops, the send path maps
 * it to a 500).
 */

export type ConversationStage = 'lookup' | 'create';

export class ConversationError extends Error {
  readonly stage: ConversationStage;
  /** The underlying Supabase error, for logging. */
  readonly detail: unknown;

  constructor(stage: ConversationStage, detail: unknown) {
    const reason = (detail as { message?: string } | null)?.message;
    super(`conversation ${stage} failed` + (reason ? `: ${reason}` : ''));
    this.name = 'ConversationError';
    this.stage = stage;
    this.detail = detail;
  }
}

async function findOldest<T>(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  select: string
): Promise<T | null> {
  const { data, error } = await db
    .from('conversations')
    .select(select)
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) throw new ConversationError('lookup', error);
  const rows = (data ?? []) as unknown as T[];
  return rows.length > 0 ? rows[0] : null;
}

/** The contact's conversation, or `null` if it has none. Never creates. */
export async function findConversation<T = { id: string }>(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  select = 'id'
): Promise<T | null> {
  return findOldest<T>(db, accountId, contactId, select);
}

export interface FindOrCreateConversationArgs {
  accountId: string;
  contactId: string;
  /** Audit `user_id` stamped on a newly created conversation. */
  ownerUserId: string;
  /** Columns to return; the row must include `id`. Defaults to `'id'`. */
  select?: string;
}

export async function findOrCreateConversation<T extends { id: string } = { id: string }>(
  db: SupabaseClient,
  args: FindOrCreateConversationArgs
): Promise<{ conversation: T; created: boolean }> {
  const { accountId, contactId, ownerUserId } = args;
  const select = args.select ?? 'id';

  const existing = await findOldest<T>(db, accountId, contactId, select);
  if (existing) return { conversation: existing, created: false };

  const { data: created, error } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      contact_id: contactId,
    })
    .select(select)
    .single();

  if (!error && created) {
    return { conversation: created as unknown as T, created: true };
  }

  if (isUniqueViolation(error)) {
    const raced = await findOldest<T>(db, accountId, contactId, select);
    if (raced) return { conversation: raced, created: false };
  }

  throw new ConversationError('create', error);
}
