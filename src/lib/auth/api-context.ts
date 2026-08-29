// ============================================================
// Public API authentication — resolve a request's API key into an
// account context.
//
// This is the machine-to-machine counterpart of `getCurrentAccount`
// (cookie session → account). Where the dashboard authenticates a
// human via Supabase cookies, the public API authenticates a caller
// via `Authorization: Bearer wacrm_live_…`.
//
// Calling convention — every `/api/v1` route does:
//
//   try {
//     const ctx = await requireApiKey(request, "messages:send");
//     // ctx.supabase   — service-role client (no user session exists)
//     // ctx.accountId  — the key's account; scope every query by it
//     // ctx.scopes     — granted scopes
//     // ctx.keyId      — for logging / the rate-limit bucket
//   } catch (err) {
//     return toApiErrorResponse(err);   // maps ApiError → envelope
//   }
//
// Why a service-role client: an API caller has no Supabase session,
// so there's no `auth.uid()` for RLS to match. The key lookup itself
// establishes the account; from there every downstream query MUST be
// explicitly filtered by `ctx.accountId` (the same discipline the
// dashboard's send route already follows). The key never escalates
// past its own account because the account is fixed at lookup time.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { findActiveKeyByHash, touchLastUsed } from '@/lib/api-keys/store';
import { hashApiKey, looksLikeApiKey } from '@/lib/api-keys/keys';
import { hasScope, isWriteScope, type ApiScope } from '@/lib/api-keys/scopes';
import {
  forbidden,
  paymentRequired,
  planUpgradeRequired,
  rateLimited,
  unauthorized,
} from '@/lib/api/v1/respond';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { isAccountWriteLocked } from '@/lib/billing/write-lock';
import { checkAccountFeature } from '@/lib/billing/feature-gate';

export interface ApiKeyContext {
  /** Discriminant — lets shared logic tell key auth from cookie auth. */
  authType: 'api_key';
  /** Service-role Supabase client. RLS-bypassing; scope by accountId. */
  supabase: SupabaseClient;
  /** The account this key belongs to. */
  accountId: string;
  /** The key row id — for audit logging and the rate-limit bucket. */
  keyId: string;
  /** Scopes granted to this key. */
  scopes: string[];
  /** Who minted the key (null if that user was later removed). */
  createdBy: string | null;
}

/**
 * Extract the bearer token from the `Authorization` header.
 * Tolerates the `Bearer ` prefix being absent (some clients send the
 * bare key) but requires the value to look like one of our keys.
 */
function extractKey(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const value = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : header.trim();
  return value.length > 0 ? value : null;
}

/**
 * Authenticate a public-API request and (optionally) enforce a
 * single scope. Throws an `ApiError` (mapped to the envelope by
 * `toApiErrorResponse`) on any failure:
 *
 *   401 unauthorized          — no key, malformed, unknown, revoked, expired
 *   403 forbidden             — valid key without the required scope
 *   403 plan_upgrade_required — valid key, but the account's plan has no API access
 *   402 payment_required      — valid key + scope, but the account is billing-locked
 *   429 rate_limited          — per-key budget exhausted
 *
 * On success, bumps `last_used_at` (fire-and-forget) and returns the
 * account context.
 */
export async function requireApiKey(
  request: Request,
  scope?: ApiScope
): Promise<ApiKeyContext> {
  const presented = extractKey(request);
  if (!presented || !looksLikeApiKey(presented)) {
    throw unauthorized();
  }

  const row = await findActiveKeyByHash(hashApiKey(presented));
  if (!row) {
    // Covers unknown, revoked, and expired keys alike — we don't
    // distinguish them on the wire so a probe can't learn whether a
    // key ever existed.
    throw unauthorized();
  }

  // Rate-limit per key, before the scope check, so an unauthorized-
  // scope caller still can't hammer the endpoint for free.
  const limit = checkRateLimit(`apikey:${row.id}`, RATE_LIMITS.publicApi);
  if (!limit.success) {
    throw rateLimited(limit);
  }

  if (scope && !hasScope(row.scopes, scope)) {
    throw forbidden(`This API key is missing the '${scope}' scope`);
  }

  // The public API itself is a Pro-plan feature (src/lib/billing/
  // plan.ts) — checked on every call, not just write scopes, so a key
  // minted while the account was on Pro stops authenticating the
  // moment a downgrade to Starter takes effect (via /platform forcing
  // a plan change, or a future self-serve downgrade).
  const hasApiAccess = await checkAccountFeature(supabaseAdmin(), row.account_id, 'apiAccess')
  if (!hasApiAccess) {
    throw planUpgradeRequired();
  }

  // This client is service-role (see the module doc above) — it
  // bypasses RLS entirely, so is_account_member()'s write-lock check
  // never runs for it. This is the ONLY enforcement point for a
  // billing-locked account on the public API; unlike the dashboard,
  // there is no RLS backstop here.
  if (scope && isWriteScope(scope)) {
    const locked = await isAccountWriteLocked(supabaseAdmin(), row.account_id);
    if (locked) {
      throw paymentRequired();
    }
  }

  touchLastUsed(row.id);

  return {
    authType: 'api_key',
    supabase: supabaseAdmin(),
    accountId: row.account_id,
    keyId: row.id,
    scopes: row.scopes,
    createdBy: row.created_by,
  };
}
