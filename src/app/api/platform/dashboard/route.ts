import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { BILLING_STATUSES, type BillingStatus } from '@/lib/billing/state'

// GET /api/platform/dashboard
//
// The /platform landing page's numbers: how many accounts in each
// billing status, the most recent signups, and the most recent
// webhook activity — a one-screen "is everything healthy" view,
// same role the admin dashboard plays in the DSC app.
export async function GET() {
  try {
    const ctx = await requirePlatformAdmin()

    const limit = checkRateLimit(`platform:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const [{ data: statusRows, error: statusErr }, { data: recentAccounts }, { data: recentWebhooks }] =
      await Promise.all([
        ctx.admin.from('account_billing').select('status'),
        ctx.admin
          .from('platform_account_overview')
          .select('id, name, owner_email, status, created_at')
          .order('created_at', { ascending: false })
          .limit(5),
        ctx.admin
          .from('billing_webhook_logs')
          .select('id, received_at, event, action, outcome, email')
          .order('received_at', { ascending: false })
          .limit(8),
      ])

    if (statusErr) {
      console.error('[platform/dashboard GET] status fetch error:', statusErr)
      return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 })
    }

    const byStatus = Object.fromEntries(BILLING_STATUSES.map((s) => [s, 0])) as Record<
      BillingStatus,
      number
    >
    for (const row of statusRows ?? []) {
      const s = row.status as BillingStatus
      if (s in byStatus) byStatus[s] += 1
    }
    const totalAccounts = (statusRows ?? []).length

    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { count: webhooks7d } = await ctx.admin
      .from('billing_webhook_logs')
      .select('id', { count: 'exact', head: true })
      .gte('received_at', since7d)
    const { count: webhookErrors7d } = await ctx.admin
      .from('billing_webhook_logs')
      .select('id', { count: 'exact', head: true })
      .eq('outcome', 'error')
      .gte('received_at', since7d)
    const { count: noAccount7d } = await ctx.admin
      .from('billing_webhook_logs')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'no_account')
      .gte('received_at', since7d)

    return NextResponse.json({
      total_accounts: totalAccounts,
      by_status: byStatus,
      recent_accounts: recentAccounts ?? [],
      recent_webhooks: recentWebhooks ?? [],
      webhooks_7d: webhooks7d ?? 0,
      webhook_errors_7d: webhookErrors7d ?? 0,
      no_account_7d: noAccount7d ?? 0,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
