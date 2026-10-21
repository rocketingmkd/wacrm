// ============================================================
// DELETE /api/account/api-keys/[id] — revoke a key, or delete it for good
// with `?permanent=1`.
//
// Permanent delete removes the row: the key stops working at once (the
// auth lookup finds nothing) and disappears from the roster. Use it to
// tidy up; revoke keeps the audit trail. Admin+, enforced here and by the
// `api_keys_delete` RLS policy.
//
// Soft revoke: sets `revoked_at` rather than deleting the row, so
// the key's name/prefix stay visible in the roster as an audit
// trail ("this key existed and was turned off") and so the auth
// path's liveness check (`findActiveKeyByHash` filters revoked
// rows) starts rejecting it immediately. Admin+, enforced here and
// by the `api_keys_update` RLS policy.
//
// Revocation is effective on the next request: once `revoked_at` is
// set, `findActiveKeyByHash` returns null and the key 401s.
// ============================================================

import { NextResponse } from 'next/server';

import { requireWrite, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireWrite('admin');

    const limit = checkRateLimit(
      `admin:apiKeyRevoke:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    // Permanent delete: works on an active, revoked or expired key.
    if (new URL(request.url).searchParams.get('permanent') === '1') {
      const { data: removed, error: deleteError } = await ctx.supabase
        .from('api_keys')
        .delete()
        .eq('id', id)
        .eq('account_id', ctx.accountId)
        .select('id')
        .maybeSingle();

      if (deleteError) {
        console.error('[DELETE /api/account/api-keys/[id]] delete error:', deleteError);
        return NextResponse.json(
          { error: 'Failed to delete API key' },
          { status: 500 }
        );
      }
      if (!removed) {
        return NextResponse.json({ error: 'API key not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    }

    // Scope the update by account_id as well as id so an admin can
    // never revoke another account's key by guessing a UUID. (RLS
    // already enforces this; the explicit filter is belt-and-braces
    // and makes the "0 rows updated → 404" path precise.)
    const { data, error } = await ctx.supabase
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[DELETE /api/account/api-keys/[id]] error:', error);
      return NextResponse.json(
        { error: 'Failed to revoke API key' },
        { status: 500 }
      );
    }
    if (!data) {
      // Either no such key in this account, or it was already revoked.
      return NextResponse.json(
        { error: 'API key not found or already revoked' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
