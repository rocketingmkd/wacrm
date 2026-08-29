import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { verifyStoredWebhookToken } from '@/lib/billing/webhook-token-store'
import { processBillingWebhook } from '@/lib/billing/process-webhook'

// POST /api/platform/integrations/test-webhook
//
// Fires a synthetic, Rocketing-Pay-shaped event through the SAME
// auth check + processing pipeline the real /api/billing/webhook
// route uses (verifyStoredWebhookToken → processBillingWebhook) —
// this is an internal call, not an HTTP round trip to the public
// route, so it exercises the real auth/parsing/logging code without
// depending on this server reaching its own public URL. Body carries
// the plaintext token the staff member currently has in hand (right
// after generating it — see the /platform/integrations "Gerar chave"
// flow); it is never persisted here.
//
// Deliberately harmless: the synthetic email never matches a real
// account, so this always resolves to action='no_account',
// outcome='ignored' — proves the pipeline end-to-end (and shows up
// immediately in /platform/webhooks) without mutating any customer's
// billing state.
export async function POST(request: Request) {
  try {
    const ctx = await requirePlatformAdmin()

    const limit = checkRateLimit(`platform:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as { token?: unknown } | null
    if (!body || typeof body.token !== 'string' || !body.token) {
      return NextResponse.json({ error: 'token is required' }, { status: 400 })
    }

    const authorized = await verifyStoredWebhookToken('rocketing_pay', `Bearer ${body.token}`)
    if (!authorized) {
      return NextResponse.json(
        { error: 'Token inválido — gere uma chave nova e tente de novo.' },
        { status: 401 },
      )
    }

    const testId = `test-${Date.now()}`
    const payload = {
      event: 'trial',
      produto_id: 0,
      trial_days: 7,
      data: {
        status_pagamento: 'approved',
        comprador: {
          email: 'webhook-test@rocketing.ia',
          nome: 'Evento de teste (painel)',
        },
        transacao_id: testId,
        valor: 0,
      },
    }

    const headers = new Headers({
      authorization: `Bearer ${body.token}`,
      'content-type': 'application/json',
      'x-platform-test': 'true',
    })

    await processBillingWebhook(ctx.admin, payload, headers)

    const { data: logRow } = await ctx.admin
      .from('billing_webhook_logs')
      .select('id, action, outcome, resolved_status, received_at')
      .eq('external_transaction_id', testId)
      .maybeSingle()

    return NextResponse.json({
      sent: payload,
      result: logRow ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
