import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { planPrice, summarizeSubscriptions } from '@/lib/platform/overview'

// GET /api/platform/subscriptions
//
// Every account's billing line for the "Assinaturas" page: plan, status,
// next charge, last payment, plus the headline numbers (estimated MRR,
// active / trial / past due). Reads `platform_account_overview` and
// `account_billing` through the service-role client (staff only).
export async function GET() {
  try {
    const ctx = await requirePlatformAdmin()

    const limit = checkRateLimit(`platform:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const [{ data: overview, error: overviewErr }, { data: payments }] = await Promise.all([
      ctx.admin
        .from('platform_account_overview')
        .select('id, name, owner_email, status, plan, trial_ends_at, current_period_end, past_due_since, created_at')
        .order('created_at', { ascending: false })
        .limit(1000),
      ctx.admin
        .from('account_billing')
        .select('account_id, last_payment_at, last_payment_amount, last_payment_method'),
    ])

    if (overviewErr) {
      console.error('[platform/subscriptions GET] overview error:', overviewErr)
      return NextResponse.json({ error: 'Não foi possível carregar as assinaturas' }, { status: 500 })
    }

    const paymentByAccount = new Map(
      (payments ?? []).map((p: { account_id: string }) => [p.account_id, p]),
    )

    const rows = (overview ?? []).map((a: Record<string, unknown>) => {
      const pay = paymentByAccount.get(a.id as string) as
        | {
            last_payment_at: string | null
            last_payment_amount: number | null
            last_payment_method: string | null
          }
        | undefined
      return {
        ...a,
        list_price: planPrice(a.plan as string | null),
        last_payment_at: pay?.last_payment_at ?? null,
        last_payment_amount: pay?.last_payment_amount ?? null,
        last_payment_method: pay?.last_payment_method ?? null,
      }
    })

    return NextResponse.json({
      summary: summarizeSubscriptions(
        rows as unknown as { status: string | null; plan: string | null }[],
      ),
      rows,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
