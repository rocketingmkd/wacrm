import { requireCronSecret } from '@/lib/auth/cron'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
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
  const denied = requireCronSecret(request)
  if (denied) return denied

  const db = supabaseAdmin()
  const result = await processConversionQueue(db)
  const google = await processGoogleQueue(db)
  return NextResponse.json({ ...result, google })
}
