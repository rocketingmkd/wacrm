import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { isBillingStatus } from '@/lib/billing/state'

// GET /api/platform/accounts?q=&status=&page=
//
// Lists every account for staff, reading `platform_account_overview`
// (supabase/migrations/041_platform_billing.sql) via the service-role
// client — this view has no grant for anon/authenticated, so only
// requirePlatformAdmin()'s ctx.admin can read it at all.
//
// Pagination/search mirrors the established dashboard pattern (see
// src/app/(dashboard)/contacts/page.tsx): PAGE_SIZE=25, `.range()`
// with an exact count, search via `.or(...ilike...)`.
const PAGE_SIZE = 25

export async function GET(request: Request) {
  try {
    const ctx = await requirePlatformAdmin()

    const limit = checkRateLimit(`platform:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const url = new URL(request.url)
    const q = url.searchParams.get('q')?.trim() ?? ''
    const statusParam = url.searchParams.get('status')
    const status = isBillingStatus(statusParam) ? statusParam : null
    const page = Math.max(0, Number(url.searchParams.get('page')) || 0)

    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    let query = ctx.admin
      .from('platform_account_overview')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (status) {
      query = query.eq('status', status)
    }
    if (q) {
      const like = `%${q}%`
      query = query.or(`name.ilike.${like},owner_email.ilike.${like},owner_name.ilike.${like}`)
    }

    const { data, error, count } = await query

    if (error) {
      console.error('[platform/accounts GET] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load accounts' }, { status: 500 })
    }

    return NextResponse.json({
      accounts: data ?? [],
      total_count: count ?? 0,
      page,
      page_size: PAGE_SIZE,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
