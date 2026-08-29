import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

// GET/PATCH /api/platform/settings
//
// The single-row `platform_settings` table (migration 041) — right
// now just `default_trial_days`, the number of days a brand-new
// signup's trial lasts (applied by handle_new_user). No client-side
// policy exists on this table either — service role only, same
// reasoning as account_billing.

export async function GET() {
  try {
    const ctx = await requirePlatformAdmin()

    const { data, error } = await ctx.admin
      .from('platform_settings')
      .select('default_trial_days, updated_at')
      .eq('id', 1)
      .single()

    if (error) {
      console.error('[platform/settings GET] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 })
    }

    return NextResponse.json({ settings: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requirePlatformAdmin()

    const limit = checkRateLimit(`platform:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as
      | { default_trial_days?: unknown }
      | null
    const raw = Number(body?.default_trial_days)
    if (!Number.isFinite(raw) || raw < 0 || raw > 365) {
      return NextResponse.json(
        { error: 'default_trial_days must be a number between 0 and 365' },
        { status: 400 },
      )
    }
    const days = Math.round(raw)

    const { data, error } = await ctx.admin
      .from('platform_settings')
      .update({ default_trial_days: days, updated_by_user_id: ctx.userId })
      .eq('id', 1)
      .select('default_trial_days, updated_at')
      .single()

    if (error) {
      console.error('[platform/settings PATCH] update error:', error)
      return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
    }

    await ctx.admin.from('platform_audit_log').insert({
      actor_user_id: ctx.userId,
      account_id: null,
      action: 'settings.default_trial_days',
      before: null,
      after: data,
    })

    return NextResponse.json({ settings: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}
