import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The offline-conversion queue (`conversion_events`), shared by every
 * destination (Meta Conversions API, Google Data Manager API).
 *
 * A destination supplies only what is its own: how a row becomes a
 * request and how it is sent (`QueueSpec.process`). Everything else is
 * the same for both and lives here: picking the due rows, claiming each
 * one so an overlapping run can't send it twice, recording the outcome,
 * backing off after a failure, and counting.
 */

export const MAX_ATTEMPTS = 5

/** Rows read per run. */
const BATCH = 50

/** How long a claimed row stays out of other runs while it is sent. */
const CLAIM_MINUTES = 10

export interface QueuedEvent {
  id: string
  event_name: string
  value: number | null
  currency: string | null
  occurred_at: string
}

/** The columns every destination's rows carry. */
export interface QueueRow extends QueuedEvent {
  account_id: string
  contact_id: string | null
  attempts: number
}

export interface QueueResult {
  processed: number
  sent: number
  skipped: number
  failed: number
}

/** Minutes to wait before retry number `attempts` (2, 4, 8, 16...). */
export function backoffMinutes(attempts: number): number {
  return Math.min(2 ** Math.max(attempts, 1), 240)
}

/** What a destination did with one row. A throw means the send failed. */
export type EventOutcome =
  | {
      kind: 'skipped'
      detail: string
      /** Count this as an attempt. For a request Google validated but did
       *  not import (validate-only mode). */
      countAttempt?: boolean
    }
  | { kind: 'sent'; detail: string | null }

export interface QueueSpec<R extends QueueRow> {
  destination: 'meta' | 'google'
  /** Columns to select from `conversion_events`. */
  columns: string
  /** Prefix for the console lines, e.g. `[conversions]`. */
  logTag: string
  /** Handle one claimed row. Throw to mark it failed and retry later. */
  process(row: R): Promise<EventOutcome>
}

/**
 * Handle the due events of one destination, oldest first. Safe to run
 * concurrently with itself: each row is claimed by moving its
 * `next_attempt_at` forward before it is handled. Never throws.
 */
export async function processQueue<R extends QueueRow>(
  db: SupabaseClient,
  now: Date,
  spec: QueueSpec<R>
): Promise<QueueResult> {
  const result: QueueResult = { processed: 0, sent: 0, skipped: 0, failed: 0 };

  const { data: rows, error } = await db
    .from('conversion_events')
    .select(spec.columns)
    .eq('destination', spec.destination)
    .in('status', ['pending', 'failed'])
    .lt('attempts', MAX_ATTEMPTS)
    .lte('next_attempt_at', now.toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(BATCH);
  if (error || !rows) {
    if (error) console.error(`${spec.logTag} queue read failed:`, error.message);
    return result;
  }

  for (const row of rows as unknown as R[]) {
    result.processed += 1;
    const finish = (patch: Record<string, unknown>) =>
      db.from('conversion_events').update(patch).eq('id', row.id);

    try {
      // Claim the row so an overlapping run does not send it twice.
      await finish({
        next_attempt_at: new Date(now.getTime() + CLAIM_MINUTES * 60_000).toISOString(),
      });

      const outcome = await spec.process(row);

      if (outcome.kind === 'skipped') {
        await finish({
          status: 'skipped',
          detail: outcome.detail,
          ...(outcome.countAttempt ? { attempts: row.attempts + 1 } : {}),
        });
        result.skipped += 1;
      } else {
        await finish({
          status: 'sent',
          sent_at: new Date().toISOString(),
          attempts: row.attempts + 1,
          detail: outcome.detail,
        });
        result.sent += 1;
      }
    } catch (err) {
      const attempts = row.attempts + 1;
      const message = err instanceof Error ? err.message : String(err);
      await finish({
        status: 'failed',
        attempts,
        next_attempt_at: new Date(now.getTime() + backoffMinutes(attempts) * 60_000).toISOString(),
        detail: message.slice(0, 300),
      });
      result.failed += 1;
      console.error(`${spec.logTag} send failed:`, message);
    }
  }
  return result;
}
