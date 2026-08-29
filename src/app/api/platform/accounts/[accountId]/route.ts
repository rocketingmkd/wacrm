import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

// GET /api/platform/accounts/[accountId]
//
// One account's full billing picture for the /platform detail page:
// the overview row, its recent webhook deliveries, and the staff
// audit trail of manual changes made to it.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const ctx = await requirePlatformAdmin()

    const limit = checkRateLimit(`platform:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { accountId } = await params

    const { data: account, error: accountErr } = await ctx.admin
      .from('platform_account_overview')
      .select('*')
      .eq('id', accountId)
      .maybeSingle()

    if (accountErr) {
      console.error('[platform/accounts/:id GET] account fetch error:', accountErr)
      return NextResponse.json({ error: 'Failed to load account' }, { status: 500 })
    }
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const [{ data: webhookLogs }, { data: auditLog }] = await Promise.all([
      ctx.admin
        .from('billing_webhook_logs')
        .select(
          'id, received_at, event, resolved_status, action, outcome, error_message, amount, external_transaction_id',
        )
        .eq('account_id', accountId)
        .order('received_at', { ascending: false })
        .limit(50),
      ctx.admin
        .from('platform_audit_log')
        .select('id, actor_user_id, action, before, after, created_at')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(50),
    ])

    return NextResponse.json({
      account,
      webhook_logs: webhookLogs ?? [],
      audit_log: auditLog ?? [],
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
