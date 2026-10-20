// ============================================================
// Guard rails for the unofficial (Evolution) transport.
//
// The official Cloud API is the default for every send. The Evolution
// session exists only to REOPEN a conversation whose 24h window is
// closed. This module decides whether one such send is allowed and
// throws a typed `SendMessageError` when it is not. It lives apart
// from the send core so the rules are testable on their own.
//
// Rules (plan of 2026-10-15):
//   - text or media only (templates / interactive are Cloud-API-only)
//   - the account's session must be enabled AND connected
//   - the contact must have a phone number (no BSUID-only contacts)
//   - the window must really be closed (otherwise use the official API)
//   - the contact must have written to us before (history), unless the
//     account switched on `allow_cold_open` ("Nova conversa" to a number
//     that never wrote)
//   - at most `max_per_lead` unofficial messages since the lead's last reply
//   - at most `daily_limit` unofficial messages per account per 24h
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { SendMessageError } from '@/lib/whatsapp/send-message';

const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface UnofficialSession {
  instance_name: string;
  status: 'disconnected' | 'connecting' | 'connected';
  enabled: boolean;
  allow_cold_open: boolean;
  max_per_lead: number;
  daily_limit: number;
}

/** Pure part of the decision, so the rules can be unit-tested without a DB. */
export function assertUnofficialSendAllowed(input: {
  messageType: string;
  hasPhone: boolean;
  session: UnofficialSession | null;
  lastCustomerMessageAt: Date | null;
  unofficialSinceLastReply: number;
  unofficialLast24h: number;
  now?: Date;
}): void {
  const now = input.now ?? new Date();
  const { session } = input;

  if (input.messageType !== 'text' && !['image', 'video', 'document', 'audio'].includes(input.messageType)) {
    throw new SendMessageError(
      'unofficial_unsupported_type',
      'Only text and media can be sent through the unofficial session.',
      400
    );
  }
  if (!session || !session.enabled) {
    throw new SendMessageError(
      'unofficial_disabled',
      'The unofficial session is not enabled for this account.',
      409
    );
  }
  if (session.status !== 'connected') {
    throw new SendMessageError(
      'unofficial_not_connected',
      'The unofficial session is not connected. Scan the QR code again in Settings.',
      409
    );
  }
  if (!input.hasPhone) {
    throw new SendMessageError(
      'unofficial_needs_phone',
      'This contact has no phone number, so it cannot be reached through the unofficial session.',
      400
    );
  }
  if (!input.lastCustomerMessageAt && !session.allow_cold_open) {
    throw new SendMessageError(
      'unofficial_no_history',
      'This contact has not written to you before. Enable "open conversations with new numbers" in Settings > WhatsApp > unofficial session to message them.',
      409
    );
  }
  if (
    input.lastCustomerMessageAt &&
    now.getTime() - input.lastCustomerMessageAt.getTime() < WINDOW_MS
  ) {
    throw new SendMessageError(
      'unofficial_window_open',
      'The 24h window is still open, send this through the official API.',
      409
    );
  }
  if (input.unofficialSinceLastReply >= session.max_per_lead) {
    throw new SendMessageError(
      'unofficial_lead_limit',
      `Limit reached: ${session.max_per_lead} unofficial message(s) per lead until they reply.`,
      429
    );
  }
  if (input.unofficialLast24h >= session.daily_limit) {
    throw new SendMessageError(
      'unofficial_daily_limit',
      `Daily limit of ${session.daily_limit} unofficial messages reached for this account.`,
      429
    );
  }
}

/**
 * Load what the rules need and apply them. Returns the session so the
 * caller can build the Evolution transport from its instance name.
 */
export async function resolveUnofficialSend(
  db: SupabaseClient,
  accountId: string,
  params: { conversationId: string; messageType: string; hasPhone: boolean }
): Promise<UnofficialSession> {
  const { data: session } = await db
    .from('whatsapp_unofficial_sessions')
    .select('instance_name, status, enabled, allow_cold_open, max_per_lead, daily_limit')
    .eq('account_id', accountId)
    .maybeSingle<UnofficialSession>();

  const { data: lastCustomer } = await db
    .from('messages')
    .select('created_at')
    .eq('conversation_id', params.conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string }>();
  const lastCustomerMessageAt = lastCustomer ? new Date(lastCustomer.created_at) : null;

  let unofficialSinceLastReply = 0;
  {
    let q = db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', params.conversationId)
      .eq('transport', 'evolution');
    if (lastCustomerMessageAt) q = q.gt('created_at', lastCustomerMessageAt.toISOString());
    const { count } = await q;
    unofficialSinceLastReply = count ?? 0;
  }

  // Account-wide rolling 24h count, via the conversations of this account.
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const { count: dayCount } = await db
    .from('messages')
    .select('id, conversations!inner(account_id)', { count: 'exact', head: true })
    .eq('transport', 'evolution')
    .eq('conversations.account_id', accountId)
    .gt('created_at', since);

  assertUnofficialSendAllowed({
    messageType: params.messageType,
    hasPhone: params.hasPhone,
    session: session ?? null,
    lastCustomerMessageAt,
    unofficialSinceLastReply,
    unofficialLast24h: dayCount ?? 0,
  });

  return session as UnofficialSession;
}
