// ============================================================
// Server-side account context — for API routes and server
// components. Reads the caller's profile + account in one round
// trip and verifies role on demand.
//
// IMPORTANT: this module is server-only. It imports the Supabase
// SSR client (`@/lib/supabase/server`), which reads `next/headers`
// cookies. Importing it from a client component will fail at
// build time with the standard Next.js "You're importing a
// component that needs `next/headers`" error — that's the
// boundary check; we don't need the `server-only` package.
//
// Calling convention
// ------------------
// API routes don't need to redo `supabase.auth.getUser()` — they
// receive a fully-loaded context from `requireRole`:
//
//   try {
//     const ctx = await requireRole("admin");
//     // ctx.supabase — the SSR client (RLS scoped to this user)
//     // ctx.userId  — auth.uid()
//     // ctx.accountId / ctx.role / ctx.account
//   } catch (err) {
//     return errorResponse(err); // see toErrorResponse() below
//   }
// ============================================================

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { isAccountWriteLocked } from "@/lib/billing/write-lock";
import { checkAccountFeature } from "@/lib/billing/feature-gate";
import type { PlanFeatures } from "@/lib/billing/plan";
import { hasMinRole, isAccountRole, type AccountRole } from "./roles";

// ------------------------------------------------------------
// Errors
//
// Custom classes so API routes can map a single `catch` to the
// right HTTP status without sprinkling 401/403 strings everywhere.
// ------------------------------------------------------------

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Thrown by `requireWrite` when the caller has the right role but
 * their ACCOUNT is billing-locked (trial lapsed, expired, canceled).
 * 402 rather than 403 because it's a distinct axis from role — "your
 * account", not "your permissions" — which lets the client branch on
 * `code: 'account_read_only'` without string-matching the message.
 *
 * This is a UX layer, not the real gate: RLS (is_account_member(),
 * see supabase/migrations/041_platform_billing.sql) already rejects
 * the underlying write regardless of whether a route remembers to
 * call requireWrite. This class exists so API routes can turn that
 * opaque Postgres 42501 into a clean, actionable response instead.
 */
export class PaymentRequiredError extends Error {
  readonly status = 402 as const;
  constructor(message = "Account is read-only") {
    super(message);
    this.name = "PaymentRequiredError";
  }
}

/**
 * Thrown by `requireFeature` / `requireWriteFeature` when the caller
 * is authenticated, has the right role, and their account is in good
 * standing — but their PLAN (Starter vs Pro, see
 * src/lib/billing/plan.ts) doesn't include the feature being called.
 * 403 (not 402 — this isn't about payment status, it's about tier)
 * with a distinct `code: 'plan_upgrade_required'` so the client can
 * show "upgrade to Pro" copy instead of the generic role-forbidden
 * message.
 */
export class FeatureNotAvailableError extends Error {
  readonly status = 403 as const;
  constructor(message = "This feature requires the Pro plan") {
    super(message);
    this.name = "FeatureNotAvailableError";
  }
}

/**
 * Convert one of the typed errors above (or anything else) into a
 * `NextResponse`. Routes can do:
 *
 *   } catch (err) {
 *     return toErrorResponse(err);
 *   }
 *
 * Unknown errors collapse to 500 with the generic message — we
 * never leak `err.message` for non-classified errors to keep
 * server internals out of the wire.
 */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof PaymentRequiredError) {
    return NextResponse.json(
      { error: err.message, code: "account_read_only" },
      { status: err.status },
    );
  }
  if (err instanceof FeatureNotAvailableError) {
    return NextResponse.json(
      { error: err.message, code: "plan_upgrade_required" },
      { status: err.status },
    );
  }
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[toErrorResponse] uncategorized error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

// ------------------------------------------------------------
// Account context
// ------------------------------------------------------------

export interface AccountContext {
  /** Supabase SSR client, RLS scoped to the calling user. */
  supabase: SupabaseClient;
  /** `auth.uid()` for the caller. Always defined when this resolves. */
  userId: string;
  /** Caller's account_id from their profile row. */
  accountId: string;
  /** Caller's role within their account. */
  role: AccountRole;
  /** Lightweight account meta — id + name. */
  account: { id: string; name: string };
}

/**
 * Resolve the caller's user + account + role in one round trip.
 *
 * Throws `UnauthorizedError` if there's no Supabase session.
 * Throws `ForbiddenError` if the profile is missing account
 * fields (shouldn't happen post-017 migration; defensive guard
 * against profile rows that pre-date the backfill or were
 * inserted by hand).
 *
 * Use `requireRole(min)` instead when the route also needs a
 * minimum-role check — it's a thin wrapper over this.
 */
export async function getCurrentAccount(): Promise<AccountContext> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    throw new UnauthorizedError();
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("account_id, account_role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[getCurrentAccount] profile fetch error:", error);
    throw new ForbiddenError("Could not load account context");
  }
  if (!data || !data.account_id || !data.account_role) {
    // Pre-migration profile, or a manual insert that skipped the
    // signup trigger. The user is authenticated but the app has
    // no way to scope their queries — treat as forbidden.
    throw new ForbiddenError("Profile is not linked to an account");
  }
  if (!isAccountRole(data.account_role)) {
    // The DB enum should make this impossible, but a future
    // migration that broadens the enum without updating TS would
    // hit this — surface it rather than silently widening.
    throw new ForbiddenError(`Unknown account role: ${data.account_role}`);
  }

  // Load the account with a plain point lookup by id rather than an
  // embedded FK join (`account:accounts!inner(...)`). The embed forces
  // PostgREST to resolve the profiles.account_id → accounts.id
  // relationship from its schema cache; when that cache is stale — a
  // common Supabase state right after a migration adds the FK, or when
  // migrations are applied out of band — the embed fails hard with
  // PGRST200 ("could not find a relationship … in the schema cache")
  // and takes down the entire account context (issue #294). A lookup by
  // id needs no relationship inference and is gated by the same accounts
  // RLS, so it stays robust against cache staleness and older schemas.
  const { data: account, error: accountErr } = await supabase
    .from("accounts")
    .select("id, name")
    .eq("id", data.account_id)
    .maybeSingle();

  if (accountErr) {
    console.error("[getCurrentAccount] account fetch error:", accountErr);
    throw new ForbiddenError("Could not load account context");
  }
  if (!account) {
    // account_id points at no readable account row — orphaned profile
    // or an RLS gap. Same "can't scope this user" outcome as above.
    throw new ForbiddenError("Profile is not linked to an account");
  }

  return {
    supabase,
    userId: user.id,
    accountId: data.account_id,
    role: data.account_role,
    account: { id: account.id, name: account.name },
  };
}

/**
 * Resolve the caller's account context and enforce a minimum role.
 *
 * Throws `UnauthorizedError` / `ForbiddenError` as documented on
 * `getCurrentAccount`, plus `ForbiddenError("Insufficient role")`
 * when the caller is below `min`.
 */
export async function requireRole(min: AccountRole): Promise<AccountContext> {
  const ctx = await getCurrentAccount();
  if (!hasMinRole(ctx.role, min)) {
    throw new ForbiddenError(
      `This action requires the '${min}' role or higher`,
    );
  }
  return ctx;
}

/**
 * Like `requireRole`, but for MUTATING handlers only: also rejects
 * when the caller's account is billing-locked (trial lapsed, expired
 * or canceled — see src/lib/billing/state.ts), throwing
 * `PaymentRequiredError` (402) instead of letting the write fall
 * through to an opaque RLS rejection.
 *
 * Deliberately NOT folded into `requireRole` itself: that would add a
 * billing round trip to every read too (GET routes call `requireRole`
 * constantly). Swap `requireRole('agent')` → `requireWrite('agent')`
 * only on the handler(s) that actually mutate data — a route that
 * exports both GET and POST typically keeps GET on `requireRole` and
 * only changes POST/PATCH/DELETE.
 *
 * This is UX only. The real gate is RLS: even if a route forgets this
 * wrapper, the underlying `.insert()/.update()/.delete()` still fails
 * under `is_account_member()` for a locked account. What this adds is
 * a clean 402 instead of a raw Postgres 42501.
 */
export async function requireWrite(min: AccountRole): Promise<AccountContext> {
  const ctx = await requireRole(min);
  if (await isAccountWriteLocked(ctx.supabase, ctx.accountId)) {
    throw new PaymentRequiredError();
  }
  return ctx;
}

/**
 * Like `requireRole`, but also rejects when the caller's PLAN doesn't
 * include `feature` (Flows, Gerente IA / aiCopilot, apiAccess — see
 * src/lib/billing/plan.ts). Deliberately independent of billing lock:
 * a Pro account that's `past_due` (still writable — see
 * src/lib/billing/state.ts) should keep its plan features; a Starter
 * account that's perfectly current still doesn't get Pro features.
 * Use this for READ routes gated by plan (e.g. `GET /api/flows`); use
 * `requireWriteFeature` below for mutating ones.
 */
export async function requireFeature(
  min: AccountRole,
  feature: keyof PlanFeatures,
): Promise<AccountContext> {
  const ctx = await requireRole(min);
  if (!(await checkAccountFeature(ctx.supabase, ctx.accountId, feature))) {
    throw new FeatureNotAvailableError();
  }
  return ctx;
}

/**
 * `requireWrite` + the plan-feature check — both axes a mutating
 * Flows/Copilot/API-key route needs: is the account allowed to write
 * at all (billing), AND does its plan include this feature at all
 * (tier). Order matters for the error the caller sees: billing lock
 * first (the more urgent "go pay" message), then plan tier.
 */
export async function requireWriteFeature(
  min: AccountRole,
  feature: keyof PlanFeatures,
): Promise<AccountContext> {
  const ctx = await requireWrite(min);
  if (!(await checkAccountFeature(ctx.supabase, ctx.accountId, feature))) {
    throw new FeatureNotAvailableError();
  }
  return ctx;
}
