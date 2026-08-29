import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// Server-side write-lock check for the code paths RLS alone cannot
// cover: service-role engines (automations, flows, broadcasts) that
// dispatch WhatsApp sends on a delinquent account's behalf, and the
// public API's key-scope gate (requireApiKey runs on a service-role
// client, which bypasses RLS by design — see src/lib/auth/api-context.ts).
//
// This calls the SAME `account_write_locked()` SQL function that
// `is_account_member()` uses for RLS (supabase/migrations/
// 041_platform_billing.sql), so the TS-side check and the DB-side
// enforcement can never disagree.
//
// IMPORTANT — deploy-ordering safety net: if this app build ships
// before migration 041 has been applied (or the migration rolls
// back), the RPC call fails with "function does not exist"
// (Postgres 42883) or PostgREST's schema-cache equivalent (PGRST202).
// That must NOT be interpreted as "locked" — it would brick every
// write in production the moment a mis-ordered deploy happens. Fail
// OPEN on any error, same policy as account_write_locked() itself
// failing open on a missing account_billing row.
// ============================================================

const FAIL_OPEN_ERROR_CODES = new Set(['42883', '42P01', 'PGRST202', 'PGRST100']);

export async function isAccountWriteLocked(
  db: SupabaseClient,
  accountId: string,
): Promise<boolean> {
  const { data, error } = await db.rpc('account_write_locked', {
    target_account_id: accountId,
  });

  if (error) {
    if (!FAIL_OPEN_ERROR_CODES.has(error.code ?? '')) {
      // An unexpected error (not "function/relation missing") is
      // logged loudly — it may be a real outage, not a deploy-order
      // race — but still fails open. A false "locked" for every
      // account on a transient DB error is worse than a brief window
      // where a genuinely locked account can still write once.
      console.error('[write-lock] account_write_locked RPC failed:', error);
    }
    return false;
  }

  return data === true;
}
