import { requireCronSecret } from '@/lib/auth/cron'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { processDueReminders } from '@/lib/agenda/reminders'

/**
 * Drain due appointment reminders across every account. Meant to be
 * hit on a schedule (same host cron as /api/automations/cron and
 * /api/flows/cron — see run-crons.sh) — requires the shared secret
 * via `x-cron-secret` to match `AUTOMATION_CRON_SECRET`.
 *
 * Unlike the automations cron, there's no per-row claim here: the
 * idempotency guard lives inside processDueReminders (the
 * agenda_reminders UNIQUE(deal_id, kind, scheduled_at) ledger), since
 * a due reminder isn't a pre-existing queued row — it's derived fresh
 * from deals.scheduled_at on every tick.
 */
export async function GET(request: Request) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  const result = await processDueReminders(supabaseAdmin())
  return NextResponse.json(result)
}
