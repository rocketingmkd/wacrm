import type { SupabaseClient } from '@supabase/supabase-js';
import { accountHasFeature, type PlanFeatures } from './plan';

// ============================================================
// Server-side plan feature check. Mirrors src/lib/billing/write-lock.ts:
// a thin DB read handed to the pure decision function
// (accountHasFeature), so the same fail-open policy on a lookup
// error applies here too — a transient DB hiccup must never lock a
// paying Pro customer out of a feature they're entitled to.
// ============================================================

export async function checkAccountFeature(
  db: SupabaseClient,
  accountId: string,
  feature: keyof PlanFeatures,
): Promise<boolean> {
  const { data, error } = await db
    .from('account_billing')
    .select('status, plan')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) {
    console.error('[feature-gate] account_billing lookup failed:', error);
    return true;
  }

  return accountHasFeature(data, feature);
}
