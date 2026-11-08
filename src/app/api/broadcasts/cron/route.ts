import { requireCronSecret } from '@/lib/auth/cron';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { processDueBroadcasts } from '@/lib/broadcasts/cron';

/**
 * Drain due scheduled broadcasts across every account. Meant to be hit
 * on a schedule (same host cron as /api/automations/cron,
 * /api/flows/cron and /api/agenda/reminders/cron — see run-crons.sh)
 * — requires the shared secret via `x-cron-secret` to match
 * `AUTOMATION_CRON_SECRET`.
 */
export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const result = await processDueBroadcasts(supabaseAdmin());
  return NextResponse.json(result);
}
