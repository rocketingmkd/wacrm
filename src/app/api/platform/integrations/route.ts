import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { toErrorResponse } from '@/lib/auth/account'
import { PRODUCT_PLAN_MAP } from '@/lib/billing/rocketing-pay'

// GET /api/platform/integrations
//
// Health check for the Rocketing Pay billing webhook — is the shared
// secret configured, has a delivery landed recently, and how the last
// 7 days broke down (success/error/ignored/no_account). Deliberately
// never returns the token value itself, only whether it's set.
export async function GET() {
  try {
    const ctx = await requirePlatformAdmin()

    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: last } = await ctx.admin
      .from('billing_webhook_logs')
      .select('received_at')
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data: recent7d } = await ctx.admin
      .from('billing_webhook_logs')
      .select('outcome, action')
      .gte('received_at', since7d)

    const outcomes = { success: 0, ignored: 0, error: 0 }
    let noAccount = 0
    for (const row of recent7d ?? []) {
      const outcome = row.outcome as keyof typeof outcomes
      if (outcome in outcomes) outcomes[outcome] += 1
      if (row.action === 'no_account') noAccount += 1
    }

    return NextResponse.json({
      rocketing_pay: {
        webhook_path: '/api/billing/webhook',
        token_configured: Boolean(process.env.ROCKETING_PAY_WEBHOOK_TOKEN),
        last_delivery_at: last?.received_at ?? null,
        last_7d: { ...outcomes, no_account: noAccount },
      },
      product_plan_map: {
        configured_products: Object.keys(PRODUCT_PLAN_MAP).length,
        entries: PRODUCT_PLAN_MAP,
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
