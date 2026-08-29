import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { generateWebhookToken } from '@/lib/billing/webhook-token'

// POST /api/platform/integrations/webhook-token
//
// Generates (or rotates) the Rocketing Pay webhook's auth token.
// Upserts platform_webhook_tokens by `integration` — generating a new
// one immediately invalidates whatever was configured before (there
// is only ever one live token per integration), matching what staff
// asked for: "teria que gerar outra se for fazer outra integração".
//
// The plaintext is returned in THIS response only. It is never
// stored, logged, or retrievable again — platform_webhook_tokens only
// ever holds the hash. If it's lost, the only recovery is generating
// a new one (and reconfiguring Rocketing Pay with it).
export async function POST() {
  try {
    const ctx = await requirePlatformAdmin()

    const limit = checkRateLimit(`platform:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const generated = generateWebhookToken()

    const { error } = await ctx.admin.from('platform_webhook_tokens').upsert(
      {
        integration: 'rocketing_pay',
        token_hash: generated.hash,
        token_prefix: generated.prefix,
        generated_at: new Date().toISOString(),
        generated_by_user_id: ctx.userId,
      },
      { onConflict: 'integration' },
    )

    if (error) {
      console.error('[platform/integrations/webhook-token POST] upsert error:', error)
      return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 })
    }

    await ctx.admin.from('platform_audit_log').insert({
      actor_user_id: ctx.userId,
      account_id: null,
      action: 'integrations.rocketing_pay_token_rotated',
      before: null,
      after: { token_prefix: generated.prefix },
    })

    return NextResponse.json({
      token: generated.plaintext,
      prefix: generated.prefix,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
