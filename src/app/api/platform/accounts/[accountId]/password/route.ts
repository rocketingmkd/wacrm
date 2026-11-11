import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { resolvePublicOrigin } from '@/lib/http/public-origin'
import { AccountAdminError, resetOwnerPassword } from '@/lib/platform/account-admin'

// POST /api/platform/accounts/[accountId]/password   { mode: 'password' | 'link' }
//
// Staff reset the OWNER's password: either a temporary password (shown
// once in the response, never stored or logged) or a one-off link the
// owner opens to choose their own. Logged as account.password_reset.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const ctx = await requirePlatformAdmin()

    const limit = checkRateLimit(`platform:pwd:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { accountId } = await params
    const body = (await request.json().catch(() => null)) as { mode?: unknown } | null
    const mode = body?.mode
    if (mode !== 'password' && mode !== 'link') {
      return NextResponse.json({ error: 'Modo inválido' }, { status: 400 })
    }

    const result = await resetOwnerPassword(ctx.admin, accountId, mode, {
      siteUrl: resolvePublicOrigin(request),
      actorUserId: ctx.userId,
    })

    return NextResponse.json(
      {
        owner_email: result.ownerEmail,
        password: result.password,
        setup_link: result.setupLink,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    if (err instanceof AccountAdminError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
