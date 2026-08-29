import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { isBillingStatus, type BillingStatus } from '@/lib/billing/state'
import { isPlan } from '@/lib/billing/plan'

// PATCH /api/platform/accounts/[accountId]/billing
//
// The one mutating endpoint /platform exposes over account_billing —
// account_billing itself has NO write policy for authenticated/anon
// (supabase/migrations/041_platform_billing.sql), so this route (via
// the service-role client from requirePlatformAdmin()) is the only
// way a human can change it outside of the Rocketing Pay webhook.
//
// Every write is a discriminated union on `action`, hand-validated
// (this repo has no zod dependency — see other /api routes for the
// same convention) and logged to platform_audit_log with a full
// before/after snapshot.

interface AccountBillingRow {
  status: BillingStatus
  plan: string | null
  trial_ends_at: string | null
  current_period_end: string | null
  external_customer_email: string | null
  notes: string | null
}

type Body =
  | { action: 'extend_trial'; days: number }
  | { action: 'set_trial'; days: number }
  | { action: 'set_status'; status: BillingStatus; notes: string }
  | { action: 'set_plan'; plan: string | null }
  | { action: 'link_email'; email: string }

function clampDays(n: unknown): number | null {
  const num = Number(n)
  if (!Number.isFinite(num)) return null
  return Math.max(1, Math.min(365, Math.round(num)))
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const ctx = await requirePlatformAdmin()

    const limit = checkRateLimit(`platform:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { accountId } = await params
    const body = (await request.json().catch(() => null)) as Body | null
    if (!body || typeof body !== 'object' || !('action' in body)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { data: current, error: currentErr } = await ctx.admin
      .from('account_billing')
      .select('status, plan, trial_ends_at, current_period_end, external_customer_email, notes')
      .eq('account_id', accountId)
      .maybeSingle<AccountBillingRow>()

    if (currentErr) {
      console.error('[platform/accounts/:id/billing PATCH] load error:', currentErr)
      return NextResponse.json({ error: 'Failed to load billing row' }, { status: 500 })
    }
    if (!current) {
      return NextResponse.json({ error: 'Account has no billing row' }, { status: 404 })
    }

    const patch: Record<string, unknown> = { updated_by_user_id: ctx.userId }
    const now = new Date()

    switch (body.action) {
      case 'extend_trial': {
        const days = clampDays(body.days)
        if (days === null) {
          return NextResponse.json({ error: 'days must be a number between 1 and 365' }, { status: 400 })
        }
        // Extends from the LATER of now or the current trial_ends_at —
        // "extend" on an already-future date should add on top of it,
        // not reset the clock to today + N.
        const base =
          current.trial_ends_at && new Date(current.trial_ends_at).getTime() > now.getTime()
            ? new Date(current.trial_ends_at)
            : now
        patch.trial_ends_at = new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
        patch.status = 'trialing'
        break
      }
      case 'set_trial': {
        const days = clampDays(body.days)
        if (days === null) {
          return NextResponse.json({ error: 'days must be a number between 1 and 365' }, { status: 400 })
        }
        patch.trial_ends_at = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
        patch.status = 'trialing'
        break
      }
      case 'set_status': {
        if (!isBillingStatus(body.status)) {
          return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
        }
        if (typeof body.notes !== 'string' || !body.notes.trim()) {
          return NextResponse.json(
            { error: 'A note is required when forcing a status change' },
            { status: 400 },
          )
        }
        patch.status = body.status
        patch.notes = body.notes.trim()
        break
      }
      case 'set_plan': {
        if (body.plan !== null && !isPlan(body.plan)) {
          return NextResponse.json(
            { error: "plan must be 'starter', 'pro', or null" },
            { status: 400 },
          )
        }
        patch.plan = body.plan
        break
      }
      case 'link_email': {
        if (typeof body.email !== 'string' || !body.email.includes('@')) {
          return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
        }
        patch.external_customer_email = body.email.toLowerCase().trim()
        break
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }

    const { data: updated, error: updateErr } = await ctx.admin
      .from('account_billing')
      .update(patch)
      .eq('account_id', accountId)
      .select(
        'status, plan, trial_ends_at, current_period_end, external_customer_email, notes',
      )
      .single()

    if (updateErr) {
      console.error('[platform/accounts/:id/billing PATCH] update error:', updateErr)
      return NextResponse.json({ error: 'Failed to update billing' }, { status: 500 })
    }

    await ctx.admin.from('platform_audit_log').insert({
      actor_user_id: ctx.userId,
      account_id: accountId,
      action: `billing.${body.action}`,
      before: current,
      after: updated,
    })

    return NextResponse.json({ billing: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}
