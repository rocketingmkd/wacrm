import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
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
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await processDueReminders(supabaseAdmin())
  return NextResponse.json(result)
}
