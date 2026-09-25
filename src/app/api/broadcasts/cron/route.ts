import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { processDueBroadcasts } from '@/lib/broadcasts/cron';

/**
 * Drain due scheduled broadcasts across every account. Meant to be hit
 * on a schedule (same host cron as /api/automations/cron,
 * /api/flows/cron and /api/agenda/reminders/cron — see run-crons.sh)
 * — requires the shared secret via `x-cron-secret` to match
 * `AUTOMATION_CRON_SECRET`.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret') ?? '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await processDueBroadcasts(supabaseAdmin());
  return NextResponse.json(result);
}
