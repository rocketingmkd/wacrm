// ============================================================
// POST /api/v1/groups — create a WhatsApp group (scope: messages:send)
//
// Creates the group through the account's unofficial (Evolution) session,
// with the paired number as owner and the given participants, and registers
// it in the CRM as a group conversation. The group exists even if WhatsApp
// refuses to add someone (privacy settings): the answer says who was added,
// who was not and carries the invite link to send by hand.
//
// Body:
//   {
//     "subject": "Rocketing e Voo Fitness",        // required, max 100
//     "description": "Grupo de atendimento",        // optional, max 500
//     "participants": ["+55 15 99617-0494", ...]    // 1 to 10 phone numbers
//   }
//
// Response (201):
//   { "data": { "conversation_id", "group_jid", "subject",
//               "added": ["5515..."], "not_added": ["55..."],
//               "verified": true, "invite_link": "https://chat.whatsapp.com/..." } }
//
// It reuses the `messages:send` scope: creating a group is a messaging
// action on the same unofficial session, and it spares existing keys from
// being recreated.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { createWhatsAppGroup } from '@/lib/whatsapp/create-group';
import { SendMessageError } from '@/lib/whatsapp/send-message';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const result = await createWhatsAppGroup(ctx.supabase, ctx.accountId, {
      subject: typeof body.subject === 'string' ? body.subject : '',
      description: typeof body.description === 'string' ? body.description : null,
      participants: Array.isArray(body.participants)
        ? body.participants.filter((p): p is string => typeof p === 'string')
        : [],
    });

    return ok(
      {
        conversation_id: result.conversationId,
        group_jid: result.groupJid,
        subject: result.subject,
        added: result.added,
        not_added: result.notAdded,
        verified: result.verified,
        invite_link: result.inviteLink,
      },
      201
    );
  } catch (err) {
    if (err instanceof SendMessageError) {
      return fail(err.code, err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}
