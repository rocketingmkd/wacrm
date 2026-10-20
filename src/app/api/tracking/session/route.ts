import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { cleanSessionParams, hasSignal, isValidSessionCode } from '@/lib/tracking/attribution'

/**
 * POST /api/tracking/session: public beacon sent by the landing page
 * script when a visitor clicks a WhatsApp link. No session; the account's
 * public key identifies the tenant and the rate limit bounds abuse.
 *
 * The script sends the body as text/plain (a "simple" request, so the
 * browser skips the CORS preflight and sendBeacon works), so the JSON is
 * parsed from the raw text.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return request.headers.get('x-real-ip')?.trim() ?? 'unknown'
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(request: Request) {
  const limit = checkRateLimit(`tracking-session:${clientIp(request)}`, RATE_LIMITS.trackingSession)
  if (!limit.success) return new NextResponse(null, { status: 429, headers: CORS })

  let raw: Record<string, unknown>
  try {
    const text = await request.text()
    if (text.length > 8000) return new NextResponse(null, { status: 413, headers: CORS })
    raw = JSON.parse(text)
  } catch {
    return new NextResponse(null, { status: 400, headers: CORS })
  }

  const key = typeof raw.key === 'string' ? raw.key : ''
  const code = raw.code
  if (key.length < 16 || key.length > 64 || !isValidSessionCode(code)) {
    return new NextResponse(null, { status: 400, headers: CORS })
  }

  const params = cleanSessionParams(raw)
  // A visit with no campaign data has nothing to attribute.
  if (!hasSignal(params)) return new NextResponse(null, { status: 204, headers: CORS })

  const db = supabaseAdmin()
  const { data: settings } = await db
    .from('tracking_settings')
    .select('account_id')
    .eq('public_key', key)
    .maybeSingle()
  if (!settings) return new NextResponse(null, { status: 404, headers: CORS })

  const { error } = await db.from('tracking_sessions').upsert(
    { account_id: settings.account_id, code, ...params },
    { onConflict: 'code', ignoreDuplicates: true },
  )
  if (error) {
    console.error('[tracking/session] insert failed:', error.message)
    return new NextResponse(null, { status: 500, headers: CORS })
  }
  return new NextResponse(null, { status: 204, headers: CORS })
}
