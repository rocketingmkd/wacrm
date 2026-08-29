// ============================================================
// Pure billing-state helpers — no I/O, `now` always injected so
// tests are deterministic. Mirrors the SQL logic in
// account_write_locked() (supabase/migrations/041_platform_billing.sql)
// so the client-side banner/gating agrees with what RLS actually
// enforces server-side. The server (RLS) is the real gate; this file
// only drives cosmetics (banner text, disabled buttons) — see
// src/hooks/use-auth.tsx and src/hooks/use-can.ts.
// ============================================================

export const BILLING_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'expired',
  'canceled',
] as const;

export type BillingStatus = (typeof BILLING_STATUSES)[number];

export function isBillingStatus(value: unknown): value is BillingStatus {
  return (
    typeof value === 'string' &&
    (BILLING_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Shape needed from `account_billing` to derive UI state. A subset of
 * the table's columns — callers select only what they need.
 */
export interface BillingSummary {
  status: BillingStatus;
  trial_ends_at: string | null;
  current_period_end: string | null;
  past_due_since: string | null;
}

/**
 * True iff the account may not write. Kept in lockstep with
 * account_write_locked() in the migration:
 *   - status is 'expired' or 'canceled' → always locked
 *   - status is 'trialing' AND trial_ends_at has passed → locked
 *   - anything else (active, past_due, trialing-not-yet-expired) → not locked
 *
 * `billing` is `null` when the account_billing row hasn't loaded yet
 * or doesn't exist — fails OPEN (not locked), matching the SQL
 * function's COALESCE(..., FALSE). A missing/unloaded row must never
 * read as "locked" and flash a false-positive banner.
 */
export function isWriteLocked(
  billing: BillingSummary | null,
  now: Date = new Date(),
): boolean {
  if (!billing) return false;
  if (billing.status === 'expired' || billing.status === 'canceled') return true;
  if (billing.status === 'trialing' && billing.trial_ends_at) {
    return new Date(billing.trial_ends_at).getTime() <= now.getTime();
  }
  return false;
}

/** Whole days remaining until `iso`, rounded up. Negative once passed. */
function daysUntil(iso: string, now: Date): number {
  const diffMs = new Date(iso).getTime() - now.getTime();
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

/**
 * Days left in the trial, or `null` when not applicable (not
 * trialing, or no trial_ends_at set yet).
 */
export function trialDaysRemaining(
  billing: BillingSummary | null,
  now: Date = new Date(),
): number | null {
  if (!billing || billing.status !== 'trialing' || !billing.trial_ends_at) {
    return null;
  }
  return daysUntil(billing.trial_ends_at, now);
}

/** How many days out a trial-ending warning starts showing. */
const TRIAL_WARNING_WINDOW_DAYS = 3;

export type BillingWarningKind = 'trial_ending' | 'past_due' | 'locked';

export interface BillingWarning {
  kind: BillingWarningKind;
  /** Populated for 'trial_ending' (days left) and 'past_due' (days overdue, if known). */
  days?: number;
}

/**
 * What (if anything) the banner should show. Returns `null` for a
 * healthy account (active, or trialing with time to spare) — the
 * banner renders nothing in that case.
 */
export function billingWarning(
  billing: BillingSummary | null,
  now: Date = new Date(),
): BillingWarning | null {
  if (!billing) return null;

  if (isWriteLocked(billing, now)) {
    return { kind: 'locked' };
  }

  if (billing.status === 'past_due') {
    const days = billing.past_due_since
      ? Math.max(0, -daysUntil(billing.past_due_since, now))
      : undefined;
    return { kind: 'past_due', days };
  }

  if (billing.status === 'trialing' && billing.trial_ends_at) {
    const days = daysUntil(billing.trial_ends_at, now);
    if (days <= TRIAL_WARNING_WINDOW_DAYS) {
      return { kind: 'trial_ending', days: Math.max(0, days) };
    }
  }

  return null;
}
