import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

// GET /api/platform/webhook-logs?account_id=&outcome=&page=
//
// Staff-facing view of every Rocketing Pay webhook delivery attempt
// (billing_webhook_logs, migration 041) — this is what would have
// made a "payment didn't land" diagnosis fast, the same role
// finance_webhook_logs played for the DSC app.
const PAGE_SIZE = 25
const VALID_OUTCOMES = new Set(['success', 'ignored', 'error'])

export async function GET(request: Request) {
  try {
    const ctx = await requirePlatformAdmin()

    const limit = checkRateLimit(`platform:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const url = new URL(request.url)
    const accountId = url.searchParams.get('account_id')
    const outcomeParam = url.searchParams.get('outcome')
    const outcome = outcomeParam && VALID_OUTCOMES.has(outcomeParam) ? outcomeParam : null
    const q = url.searchParams.get('q')?.trim() ?? ''
    const page = Math.max(0, Number(url.searchParams.get('page')) || 0)

    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    // payload/headers included so staff can inspect exactly what
    // Rocketing Pay sent — the whole point of this page for
    // diagnosing "why didn't this event do what I expected".
    let query = ctx.admin
      .from('billing_webhook_logs')
      .select(
        'id, received_at, account_id, email, event, resolved_status, action, outcome, error_message, external_transaction_id, external_product_id, amount, payload, headers',
        { count: 'exact' },
      )
      .order('received_at', { ascending: false })
      .range(from, to)

    if (accountId) query = query.eq('account_id', accountId)
    if (outcome) query = query.eq('outcome', outcome)
    if (q) query = query.ilike('email', `%${q}%`)

    const { data, error, count } = await query

    if (error) {
      console.error('[platform/webhook-logs GET] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load webhook logs' }, { status: 500 })
    }

    return NextResponse.json({
      logs: data ?? [],
      total_count: count ?? 0,
      page,
      page_size: PAGE_SIZE,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
