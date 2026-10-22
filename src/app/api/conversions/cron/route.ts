import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { processConversionQueue } from '@/lib/tracking/conversions'
import { processGoogleQueue } from '@/lib/google-ads/conversions'

/**
 * Sends the queued deal conversions to Meta's Conversions API.
 *
 * Same auth as the other crons (AUTOMATION_CRON_SECRET in the
 * x-cron-secret header, compared in constant time). Called every minute
 * from run-crons.sh; failed rows retry with backoff on their own.
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

  const db = supabaseAdmin()
  const result = await processConversionQueue(db)
  const google = await processGoogleQueue(db)
  return NextResponse.json({ ...result, google })
}
