import { NextResponse, after } from 'next/server'
import { verifyRocketingPayToken } from '@/lib/billing/webhook-auth'
import { processBillingWebhook } from '@/lib/billing/process-webhook'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

// POST /api/billing/webhook
//
// Receives billing events from Rocketing Pay (rocketingpay.com.br —
// the user's own checkout platform, already handling real recurring
// billing for the "Dinheiro Sob Controle" app). Verifies a static
// Bearer token (ROCKETING_PAY_WEBHOOK_TOKEN — DIFFERENT from the
// WhatsApp webhook's HMAC signature scheme, since Rocketing Pay signs
// nothing, it just presents a shared secret), then activates/updates
// the matching account's billing state. Never creates an account —
// the customer signs up in the CRM first; this only upgrades/adjusts
// an existing one, matched by e-mail.
//
// Route shape mirrors src/app/api/whatsapp/webhook/route.ts: verify
// against the RAW body, respond 200 immediately, do the real work in
// `after()` so a slow DB round trip never risks Rocketing Pay's own
// delivery timeout/retry behavior.
export const maxDuration = 30

export async function POST(request: Request) {
  // Per-IP limit BEFORE auth — otherwise billing_webhook_logs itself
  // becomes the thing an attacker floods. Rate-limited requests are
  // dropped without a log insert (same as an auth failure would be
  // logged, this is a layer below that).
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const limit = checkRateLimit(`billing-webhook:${ip}`, RATE_LIMITS.billingWebhook)
  if (!limit.success) {
    return rateLimitResponse(limit)
  }

  const raw = await request.text()

  if (!verifyRocketingPayToken(request.headers.get('authorization'))) {
    // 401 (not 200) so a misconfigured token is loud in Rocketing
    // Pay's own delivery dashboard, mirroring the WhatsApp webhook's
    // reasoning for rejecting invalid signatures visibly.
    console.warn('[billing-webhook] rejected request with invalid/missing token')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const headers = request.headers
  after(async () => {
    try {
      await processBillingWebhook(supabaseAdmin(), payload, headers)
    } catch (err) {
      console.error('[billing-webhook] processing failed:', err)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}
