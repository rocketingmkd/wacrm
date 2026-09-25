import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, MessageTemplate } from '@/types';
import { engineSendTemplate } from '@/lib/automations/meta-send';
import { findOrCreateConversation } from '@/lib/whatsapp/send-message';
import {
  resolveVariables,
  fetchCustomValueIndex,
  type VariableMapping,
} from '@/lib/whatsapp/broadcast-variables';

/**
 * Drains due `broadcasts` (status = 'scheduled', scheduled_at <= now)
 * across every account — the server half of the wizard's "Agendar
 * envio" button (src/components/broadcasts/step4-schedule-send.tsx).
 *
 * The dashboard wizard already resolved the audience and inserted
 * `broadcast_recipients` (status 'pending') at scheduling time — see
 * `scheduleBroadcast` in src/hooks/use-broadcast-sending.ts — so this
 * only has to walk pending recipients and send, mirroring the client
 * send loop but via `engineSendTemplate` (service-role, no cookies),
 * the same primitive the agenda-reminder and automation engines use.
 *
 * Meant to be hit on a schedule (same host cron as
 * /api/automations/cron, /api/flows/cron, /api/agenda/reminders/cron
 * — see run-crons.sh) — requires the shared secret via `x-cron-secret`
 * to match `AUTOMATION_CRON_SECRET`.
 */

const SEND_BATCH_SIZE = 10;
const SEND_BATCH_DELAY_MS = 1000;
/** Cap on how many due broadcasts one tick claims — keeps a single
 *  request bounded even if several accounts scheduled sends for the
 *  same minute. Any broadcast left over is picked up on the next tick. */
const MAX_BROADCASTS_PER_TICK = 10;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ProcessBroadcastsResult {
  /** Broadcasts claimed and fully processed this tick. */
  processed: number;
  sent: number;
  failed: number;
}

interface DueBroadcastRow {
  id: string;
  account_id: string;
  user_id: string;
  template_name: string;
  template_language: string;
  template_variables: Record<string, VariableMapping> | null;
}

export async function processDueBroadcasts(
  db: SupabaseClient,
): Promise<ProcessBroadcastsResult> {
  const { data: due, error } = await db
    .from('broadcasts')
    .select('id, account_id, user_id, template_name, template_language, template_variables')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(MAX_BROADCASTS_PER_TICK);

  if (error) {
    console.error('[broadcasts-cron] due lookup failed:', error.message);
    return { processed: 0, sent: 0, failed: 0 };
  }
  if (!due || due.length === 0) return { processed: 0, sent: 0, failed: 0 };

  let processed = 0;
  let sentTotal = 0;
  let failedTotal = 0;

  for (const row of due as DueBroadcastRow[]) {
    const result = await processOneBroadcast(db, row);
    if (result) {
      processed++;
      sentTotal += result.sent;
      failedTotal += result.failed;
    }
  }

  return { processed, sent: sentTotal, failed: failedTotal };
}

async function processOneBroadcast(
  db: SupabaseClient,
  row: DueBroadcastRow,
): Promise<{ sent: number; failed: number } | null> {
  // Atomic claim — the host cron already runs under `flock` so ticks
  // never overlap, but this two-step UPDATE is cheap insurance against
  // a manual re-run or a future change to the schedule.
  const { data: claimed } = await db
    .from('broadcasts')
    .update({ status: 'sending' })
    .eq('id', row.id)
    .eq('status', 'scheduled')
    .select('id')
    .maybeSingle();
  if (!claimed) return null;

  const { data: template, error: templateErr } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', row.account_id)
    .eq('name', row.template_name)
    .eq('language', row.template_language)
    .maybeSingle();

  if (templateErr || !template) {
    console.error(
      `[broadcasts-cron] template ${row.template_name} (${row.template_language}) not found for broadcast ${row.id}`,
    );
    await db.from('broadcasts').update({ status: 'failed' }).eq('id', row.id);
    return { sent: 0, failed: 0 };
  }

  const { data: recipients, error: recipientsErr } = await db
    .from('broadcast_recipients')
    .select('id, contact_id')
    .eq('broadcast_id', row.id)
    .eq('status', 'pending');

  if (recipientsErr) {
    console.error('[broadcasts-cron] recipients lookup failed:', recipientsErr.message);
    await db.from('broadcasts').update({ status: 'failed' }).eq('id', row.id);
    return { sent: 0, failed: 0 };
  }
  if (!recipients || recipients.length === 0) {
    // Nothing pending — either already fully processed by a prior
    // partial run, or the recipient insert genuinely produced zero
    // rows. Either way there's nothing left to send.
    await db.from('broadcasts').update({ status: 'sent' }).eq('id', row.id);
    return { sent: 0, failed: 0 };
  }

  // Embedded `select('*, contact:contacts(*)')` infers as an array on
  // the untyped service-role client (no generated Database generic),
  // unlike the dashboard's typed client — fetch contacts separately
  // instead of fighting that inference.
  const contactIds = [...new Set(recipients.map((r) => r.contact_id as string))];
  const { data: contactRows } = await db.from('contacts').select('*').in('id', contactIds);
  const contactsById = new Map((contactRows ?? []).map((c) => [c.id, c as Contact]));

  const customValueIndex = await fetchCustomValueIndex(db, contactIds);
  const variables = (row.template_variables ?? {}) as Record<string, VariableMapping>;

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
    const batch = recipients.slice(i, i + SEND_BATCH_SIZE);

    for (const recipient of batch) {
      const contact = contactsById.get(recipient.contact_id as string) ?? null;
      if (!contact?.phone) {
        failed++;
        await db
          .from('broadcast_recipients')
          .update({ status: 'failed', error_message: 'No phone number on contact' })
          .eq('id', recipient.id);
        continue;
      }

      try {
        const conversationId = await findOrCreateConversation(
          db,
          row.account_id,
          row.user_id,
          contact.id,
        );
        if (!conversationId) {
          throw new Error('Failed to open a conversation for this contact');
        }

        const params = resolveVariables(variables, contact, customValueIndex.get(contact.id));

        const { whatsapp_message_id } = await engineSendTemplate({
          accountId: row.account_id,
          userId: row.user_id,
          conversationId,
          contactId: contact.id,
          templateName: row.template_name,
          language: row.template_language,
          template: template as MessageTemplate,
          messageParams: { body: params },
        });

        sent++;
        await db
          .from('broadcast_recipients')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            whatsapp_message_id,
            error_message: null,
          })
          .eq('id', recipient.id);
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[broadcasts-cron] send failed for recipient ${recipient.id}:`, message);
        await db
          .from('broadcast_recipients')
          .update({ status: 'failed', error_message: message })
          .eq('id', recipient.id);
      }
    }

    if (i + SEND_BATCH_SIZE < recipients.length) {
      await sleep(SEND_BATCH_DELAY_MS);
    }
  }

  const finalStatus = failed === recipients.length ? 'failed' : 'sent';
  await db.from('broadcasts').update({ status: finalStatus }).eq('id', row.id);

  return { sent, failed };
}
