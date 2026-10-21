// ============================================================
// Inbound WhatsApp group messages, delivered by the Evolution webhook.
//
// The official Cloud API never delivers group traffic, so groups reach the
// CRM through the Evolution session. Every group of the paired number
// shows up on its own, like in WhatsApp itself: the first message creates
// the group's contact + conversation. A group is NOT a lead:
// this path stores the message and bumps the conversation, and
// deliberately skips flows, automations, AI auto-reply, CSAT, lead
// attribution and the public message.received webhook, so nothing can
// answer inside a group on its own.
//
// Pure helpers (secret, parser) are separate from the DB handler so they
// can be unit-tested without Supabase.
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { resolveAuditUserId } from '@/lib/api/v1/contacts';

// ---- webhook secret -------------------------------------------------

/**
 * Per-instance shared secret, derived from ENCRYPTION_KEY so it needs no
 * new env var and no column. Sent by Evolution as a custom header.
 */
export function webhookSecretFor(instanceName: string): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('ENCRYPTION_KEY is not set');
  return createHmac('sha256', key).update(`evolution-webhook:${instanceName}`).digest('hex');
}

export function isValidWebhookSecret(instanceName: string, provided: string | null): boolean {
  if (!provided) return false;
  let expected: string;
  try {
    expected = webhookSecretFor(instanceName);
  } catch {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---- payload parsing ------------------------------------------------

export interface ParsedGroupMessage {
  instance: string;
  groupJid: string;
  messageId: string;
  fromMe: boolean;
  senderName: string | null;
  senderPhone: string | null;
  contentType: 'text' | 'image' | 'document' | 'audio' | 'video';
  /** Text, or a caption / placeholder for media. */
  text: string;
  timestamp: Date;
}

type EvolutionMessage = Record<string, unknown> & {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  imageMessage?: { caption?: string };
  videoMessage?: { caption?: string };
  documentMessage?: { caption?: string; fileName?: string };
  documentWithCaptionMessage?: { message?: { documentMessage?: { caption?: string; fileName?: string } } };
  audioMessage?: unknown;
  stickerMessage?: unknown;
  contactMessage?: { displayName?: string };
  locationMessage?: unknown;
};

interface EvolutionUpsertData {
  key?: { remoteJid?: string; fromMe?: boolean; id?: string; participant?: string; participantAlt?: string };
  pushName?: string;
  message?: EvolutionMessage;
  messageTimestamp?: number | string | { low?: number };
}

function phoneFromJid(jid: string | undefined): string | null {
  if (!jid || !jid.endsWith('@s.whatsapp.net')) return null;
  const digits = jid.split('@')[0].replace(/\D/g, '');
  return digits || null;
}

function toDate(ts: EvolutionUpsertData['messageTimestamp']): Date {
  const n = typeof ts === 'object' && ts !== null ? Number(ts.low) : Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

function extractContent(
  message: EvolutionMessage | undefined,
): { contentType: ParsedGroupMessage['contentType']; text: string } | null {
  if (!message) return null;
  if (typeof message.conversation === 'string' && message.conversation) {
    return { contentType: 'text', text: message.conversation };
  }
  const extended = message.extendedTextMessage?.text;
  if (extended) return { contentType: 'text', text: extended };
  // Media bodies are not downloaded yet: keep the caption, or a marker,
  // as plain text so the thread reads correctly.
  if (message.imageMessage) {
    return { contentType: 'text', text: message.imageMessage.caption || '[imagem]' };
  }
  if (message.videoMessage) {
    return { contentType: 'text', text: message.videoMessage.caption || '[vídeo]' };
  }
  const doc = message.documentMessage ?? message.documentWithCaptionMessage?.message?.documentMessage;
  if (doc) {
    return { contentType: 'text', text: doc.caption || (doc.fileName ? `[documento] ${doc.fileName}` : '[documento]') };
  }
  if (message.audioMessage) return { contentType: 'text', text: '[áudio]' };
  if (message.stickerMessage) return { contentType: 'text', text: '[figurinha]' };
  if (message.locationMessage) return { contentType: 'text', text: '[localização]' };
  if (message.contactMessage) {
    return { contentType: 'text', text: `[contato] ${message.contactMessage.displayName ?? ''}`.trim() };
  }
  // reactions, protocol/edit messages, polls...: nothing to show
  return null;
}

/**
 * Turn an Evolution `messages.upsert` webhook body into a group message,
 * or null when it is not one we store (not a group, a reaction, a
 * protocol message, malformed...).
 */
export function parseGroupUpsert(body: unknown): ParsedGroupMessage[] {
  if (!body || typeof body !== 'object') return [];
  const root = body as { event?: string; instance?: string; data?: unknown };
  const event = (root.event ?? '').toLowerCase().replace(/_/g, '.');
  if (event !== 'messages.upsert' || !root.instance) return [];

  const items = Array.isArray(root.data) ? root.data : [root.data];
  const out: ParsedGroupMessage[] = [];
  for (const item of items) {
    const data = item as EvolutionUpsertData | undefined;
    const key = data?.key;
    if (!key?.id || !key.remoteJid?.endsWith('@g.us')) continue;
    const content = extractContent(data?.message);
    if (!content) continue;

    const fromMe = key.fromMe === true;
    // In newer Baileys a group participant can be a LID; the phone then
    // travels in participantAlt.
    const senderPhone = fromMe
      ? null
      : phoneFromJid(key.participant) ?? phoneFromJid(key.participantAlt);
    out.push({
      instance: root.instance,
      groupJid: key.remoteJid,
      messageId: key.id,
      fromMe,
      senderName: fromMe ? null : data?.pushName?.trim() || null,
      senderPhone,
      contentType: content.contentType,
      text: content.text,
      timestamp: toDate(data?.messageTimestamp),
    });
  }
  return out;
}

// ---- storing --------------------------------------------------------

/** Looks up a group's subject; null when unknown. Never throws. */
export type GroupNameLookup = (groupJid: string) => Promise<string | null>;

export type GroupStoreResult = 'stored' | 'duplicate';

/** Placeholder name until Evolution tells us the real group subject. */
const fallbackGroupName = (groupJid: string) => `Grupo ${groupJid.split('@')[0]}`;
const isFallbackName = (name: string | null | undefined) => !name || /^Grupo \d{10,}$/.test(name);

async function findOrCreateGroupContact(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  groupJid: string,
  getGroupName: GroupNameLookup,
): Promise<string> {
  const find = async () => {
    const { data } = await db
      .from('contacts')
      .select('id, name')
      .eq('account_id', accountId)
      .eq('group_jid', groupJid)
      .maybeSingle<{ id: string; name: string | null }>();
    return data;
  };

  const existing = await find();
  if (existing) {
    // A group created before its subject was known (lookup failed) gets
    // its real name on a later message.
    if (isFallbackName(existing.name)) {
      const name = await getGroupName(groupJid);
      if (name && name !== existing.name) {
        await db
          .from('contacts')
          .update({ name, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      }
    }
    return existing.id;
  }

  const name = (await getGroupName(groupJid)) ?? fallbackGroupName(groupJid);
  const { data: created, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      // Numeric part of the JID: unique per group, never a real number.
      phone: groupJid.split('@')[0],
      name,
      is_group: true,
      group_jid: groupJid,
    })
    .select('id')
    .single<{ id: string }>();
  if (created) return created.id;
  if (isUniqueViolation(error)) {
    const raced = await find();
    if (raced) return raced.id;
  }
  throw new Error(`group contact create failed: ${JSON.stringify(error)}`);
}

async function findOrCreateGroupConversation(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  contactId: string,
): Promise<{ id: string; unread_count: number | null }> {
  const find = async () => {
    const { data } = await db
      .from('conversations')
      .select('id, unread_count')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .limit(1);
    return data?.[0] as { id: string; unread_count: number | null } | undefined;
  };

  const existing = await find();
  if (existing) return existing;

  const { data: created, error } = await db
    .from('conversations')
    .insert({ account_id: accountId, user_id: ownerUserId, contact_id: contactId })
    .select('id, unread_count')
    .single<{ id: string; unread_count: number | null }>();
  if (created) return created;
  if (isUniqueViolation(error)) {
    const raced = await find();
    if (raced) return raced;
  }
  throw new Error(`group conversation create failed: ${JSON.stringify(error)}`);
}

/**
 * Store one group message for `accountId`, creating the group's contact
 * and conversation on first sight. Skipped when this message id is
 * already in the conversation (Evolution retries, and the echo of a
 * message the CRM itself sent).
 */
export async function storeGroupMessage(
  db: SupabaseClient,
  accountId: string,
  msg: ParsedGroupMessage,
  getGroupName: GroupNameLookup = async () => null,
): Promise<GroupStoreResult> {
  const ownerUserId = await resolveAuditUserId(db, accountId);
  const contactId = await findOrCreateGroupContact(db, accountId, ownerUserId, msg.groupJid, getGroupName);
  const conversation = await findOrCreateGroupConversation(db, accountId, ownerUserId, contactId);

  const { data: dup } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversation.id)
    .eq('message_id', msg.messageId)
    .limit(1);
  if (dup && dup.length > 0) return 'duplicate';

  const { error: insertError } = await db.from('messages').insert({
    conversation_id: conversation.id,
    sender_type: msg.fromMe ? 'agent' : 'customer',
    content_type: msg.contentType,
    content_text: msg.text,
    message_id: msg.messageId,
    status: msg.fromMe ? 'sent' : 'delivered',
    origin: msg.fromMe ? 'whatsapp_app' : 'evolution',
    // `transport` stays at its default on purpose: it means "which path
    // SENT an outbound message", and the unofficial guard rails count
    // every transport='evolution' row toward the daily send limit.
    sender_name: msg.senderName,
    sender_phone: msg.senderPhone,
    created_at: msg.timestamp.toISOString(),
  });
  if (insertError) throw new Error(`group message insert failed: ${JSON.stringify(insertError)}`);

  const preview = msg.fromMe || !msg.senderName ? msg.text : `${msg.senderName}: ${msg.text}`;
  const { error: convError } = await db
    .from('conversations')
    .update({
      last_message_text: preview,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(msg.fromMe ? {} : { unread_count: (conversation.unread_count ?? 0) + 1 }),
    })
    .eq('id', conversation.id);
  if (convError) console.error('[evolution-groups] conversation update failed:', convError);

  return 'stored';
}
