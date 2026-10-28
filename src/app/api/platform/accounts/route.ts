import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { isBillingStatus } from '@/lib/billing/state'
import {
  CreateAccountError,
  createAccountWithOwner,
  validateCreateAccountInput,
} from '@/lib/platform/create-account'

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
      return NextResponse.json({ error: 'Não foi possível carregar as contas' }, { status: 500 })
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

// POST /api/platform/accounts   { companyName, ownerEmail, ownerName?, trialDays? }
//
// "Nova conta": creates the owner's login (the signup trigger provisions
// the account, profile and trial), renames the account and returns a
// one-off link for the OWNER to set their own password. No password is
// generated or returned. Staff only; the action lands in
// platform_audit_log.
export async function POST(request: Request) {
  try {
    const ctx = await requirePlatformAdmin()

    const limit = checkRateLimit(`platform:create:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const input = validateCreateAccountInput(body)

    // Public base URL for the link: the trusted env value first (the
    // request origin behind Traefik is the container's bind address).
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin

    const result = await createAccountWithOwner(ctx.admin, input, {
      siteUrl,
      actorUserId: ctx.userId,
    })

    return NextResponse.json(
      {
        account_id: result.accountId,
        owner_email: result.ownerEmail,
        setup_link: result.setupLink,
      },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof CreateAccountError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
