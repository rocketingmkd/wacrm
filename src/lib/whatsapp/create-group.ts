// ============================================================
// Create a WhatsApp group through the unofficial (Evolution) session and
// register it in the CRM.
//
// Used by POST /api/v1/groups. The group is created with the paired number
// as owner plus the participants asked for. WhatsApp adds whoever it can:
// a person whose privacy settings block being added by someone who is not
// in their contacts is simply missing from the result, and the group STILL
// exists. The caller gets back who was added, who was not and the invite
// link, so a person left out can be sent the link by hand.
//
// The group then enters the inbox like any other: a contact marked
// `is_group` plus its conversation (migration 070), with the first line
// "Grupo criado pela Rocketing".
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { createGroup, fetchInviteLink } from '@/lib/whatsapp/evolution-api';
import { storeGroupJoined } from '@/lib/whatsapp/evolution-group-inbound';
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import { SendMessageError } from '@/lib/whatsapp/send-message';
import { resolveGroupSend } from '@/lib/whatsapp/unofficial-guard';

export const MAX_GROUP_PARTICIPANTS = 10;
export const MAX_SUBJECT_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 500;

export interface CreateGroupParams {
  subject: string;
  description?: string | null;
  /** Phone numbers with country code, any formatting. */
  participants: string[];
}

export interface CreateGroupResult {
  conversationId: string;
  groupJid: string;
  subject: string;
  /** Requested numbers WhatsApp confirmed in the group (digits only). */
  added: string[];
  /** Requested numbers it did NOT add: send them the invite link. */
  notAdded: string[];
  /** False when WhatsApp's answer could not be matched to the numbers. */
  verified: boolean;
  inviteLink: string | null;
}

/** Digits of a participant JID or number: "5515999990000@s.whatsapp.net" → "5515999990000". */
const digitsOf = (v: string) => sanitizePhoneForMeta(String(v).split('@')[0]);

export async function createWhatsAppGroup(
  db: SupabaseClient,
  accountId: string,
  params: CreateGroupParams
): Promise<CreateGroupResult> {
  const subject = String(params.subject ?? '').trim();
  if (!subject) {
    throw new SendMessageError('bad_request', "'subject' is required", 400);
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    throw new SendMessageError(
      'bad_request',
      `'subject' must be at most ${MAX_SUBJECT_LENGTH} characters`,
      400
    );
  }
  const description = String(params.description ?? '').trim();
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new SendMessageError(
      'bad_request',
      `'description' must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
      400
    );
  }

  if (!Array.isArray(params.participants) || params.participants.length === 0) {
    throw new SendMessageError('bad_request', "'participants' needs at least one phone number", 400);
  }
  const requested: string[] = [];
  for (const raw of params.participants) {
    const digits = sanitizePhoneForMeta(String(raw ?? ''));
    if (!isValidE164(digits)) {
      throw new SendMessageError(
        'bad_request',
        `Invalid phone number in 'participants': "${String(raw).slice(0, 30)}"`,
        400
      );
    }
    if (!requested.includes(digits)) requested.push(digits);
  }
  if (requested.length > MAX_GROUP_PARTICIPANTS) {
    throw new SendMessageError(
      'bad_request',
      `At most ${MAX_GROUP_PARTICIPANTS} participants per group`,
      400
    );
  }

  // Same precondition as sending to a group: the unofficial session is on and paired.
  const session = await resolveGroupSend(db, accountId);

  let created;
  try {
    created = await createGroup({
      instanceName: session.instance_name,
      subject,
      description: description || undefined,
      participants: requested,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Evolution error';
    console.error('[create-group] Evolution create failed:', message);
    throw new SendMessageError('unofficial_error', `Erro da sessão não oficial: ${message}`, 502);
  }

  // Which of the requested numbers are really in the group? WhatsApp may
  // answer with @lid ids that cannot be matched to a phone: then we say so
  // instead of guessing.
  const inGroup = new Set(created.participants.map(digitsOf).filter(Boolean));
  const matchable = inGroup.size > 0 && [...inGroup].some((d) => /^[1-9]\d{9,14}$/.test(d));
  const added = matchable ? requested.filter((d) => inGroup.has(d)) : [];
  const notAdded = matchable ? requested.filter((d) => !inGroup.has(d)) : [];

  let inviteLink: string | null = null;
  try {
    inviteLink = await fetchInviteLink({ instanceName: session.instance_name, groupJid: created.id });
  } catch (err) {
    console.warn('[create-group] invite link lookup failed:', err instanceof Error ? err.message : err);
  }

  // Register the group in the CRM (the Evolution webhook may report the same
  // group a moment later: the find-or-create there is idempotent).
  const conversationId = await storeGroupJoined(
    db,
    accountId,
    { instance: session.instance_name, groupJid: created.id, subject: created.subject },
    async () => created.subject,
    'Grupo criado pela Rocketing'
  );

  return {
    conversationId,
    groupJid: created.id,
    subject: created.subject,
    added,
    notAdded,
    verified: matchable,
    inviteLink,
  };
}
