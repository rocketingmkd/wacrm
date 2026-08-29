// ============================================================
// Platform admin context — for the /platform routes (Rocketing
// staff only, cross-tenant). Mirrors the shape of getCurrentAccount /
// requireRole in ./account.ts so every /platform route reads the
// same way as every other route in the app:
//
//   try {
//     const ctx = await requirePlatformAdmin();
//     // ctx.admin — service-role client, filter explicitly by account_id
//   } catch (err) {
//     return toErrorResponse(err);
//   }
//
// Why a SQL function AND a service-role client, for different jobs:
//   - Identity check (`is_platform_admin()`, called via the caller's
//     own session client): platform_admins has RLS on with ZERO
//     policies (supabase/migrations/041_platform_billing.sql) — an
//     RLS-scoped client reading it directly always sees no rows. The
//     SECURITY DEFINER function is the only way to answer "is this
//     caller staff?" using the caller's own session.
//   - Cross-tenant reads/writes: the service-role client
//     (supabaseAdmin(), reused from src/lib/flows/admin-client.ts —
//     not a 5th duplicate). Every query through it MUST be filtered
//     explicitly by account_id, the same discipline api-context.ts
//     already documents for the public API's key auth path. Adding
//     `OR is_platform_admin()` to every tenant RLS policy was
//     considered and rejected — that's a huge, risky diff across ~60
//     policies for a surface only staff ever touch.
// ============================================================

import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { UnauthorizedError, ForbiddenError } from './account';

export interface PlatformContext {
  /** Caller's SSR client — identity only (already used to resolve is_platform_admin()). */
  supabase: Awaited<ReturnType<typeof createClient>>;
  /** Service-role client — every cross-tenant read/write goes through this, filtered by account_id. */
  admin: ReturnType<typeof supabaseAdmin>;
  userId: string;
  email: string | null;
}

/**
 * Non-throwing check — for a server component that wants to decide
 * whether to render a "Plataforma" affordance rather than hard-fail.
 * Returns `false` on any error (no session, RPC failure, etc.) —
 * fails closed, unlike the billing write-lock's fail-open policy.
 * Being wrong about "is this person staff" in the open direction is
 * a real privilege leak; being wrong about "is this account locked"
 * in the open direction just means one extra write goes through.
 */
export async function isCurrentUserPlatformAdmin(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

    const { data, error } = await supabase.rpc('is_platform_admin');
    if (error) {
      console.error('[platform] is_platform_admin RPC failed:', error);
      return false;
    }
    return data === true;
  } catch (err) {
    // Next.js's own control-flow signals — redirect/notFound (digest
    // starting with `NEXT_`) and the "this route needs dynamic
    // rendering because it read cookies()" detector (digest exactly
    // `DYNAMIC_SERVER_USAGE`, thrown during `next build`'s static-
    // generation attempt for every authed route, not just this one)
    // — are thrown as errors with a `digest` field. Swallowing one
    // here would break the framework mechanism that marks the route
    // dynamic (it relies on the error propagating), not just add log
    // noise — rethrow it untouched. Only genuine failures (RPC/
    // network) get caught below.
    if (
      err &&
      typeof err === 'object' &&
      'digest' in err &&
      typeof err.digest === 'string' &&
      (err.digest.startsWith('NEXT_') || err.digest === 'DYNAMIC_SERVER_USAGE')
    ) {
      throw err;
    }
    console.error('[platform] isCurrentUserPlatformAdmin threw:', err);
    return false;
  }
}

/**
 * Resolve the caller's platform-admin context. Throws
 * `UnauthorizedError` with no Supabase session, `ForbiddenError` when
 * the caller is authenticated but not staff.
 */
export async function requirePlatformAdmin(): Promise<PlatformContext> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    throw new UnauthorizedError();
  }

  const { data: isAdmin, error } = await supabase.rpc('is_platform_admin');
  if (error) {
    console.error('[platform] is_platform_admin RPC failed:', error);
    throw new ForbiddenError('Could not verify platform admin status');
  }
  if (!isAdmin) {
    throw new ForbiddenError('Not a platform administrator');
  }

  return {
    supabase,
    admin: supabaseAdmin(),
    userId: user.id,
    email: user.email ?? null,
  };
}
