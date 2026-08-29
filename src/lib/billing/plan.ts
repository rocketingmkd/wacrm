// ============================================================
// Plan feature matrix — pure, no I/O.
//
// Starter (R$97/mês) vs Pro (R$197/mês): the price gap is justified
// by Flows (chatbot builder), the "Gerente IA" copilot, and developer
// access (API keys + outbound webhooks) — not by WhatsApp-number
// count, since the CRM only supports one number per account today
// (multi-number was deliberately deferred, see project memory).
//
// Trial always unlocks everything (see accountHasFeature) — a
// prospect needs to see the Pro features to want to pay for them;
// gating during the trial would undercut the sales pitch the trial
// exists to make.
// ============================================================

import type { BillingStatus } from './state';

export const PLANS = ['starter', 'pro'] as const;
export type Plan = (typeof PLANS)[number];

export function isPlan(value: unknown): value is Plan {
  return typeof value === 'string' && (PLANS as readonly string[]).includes(value);
}

export interface PlanFeatures {
  /** Flows — the visual chatbot/conversation-flow builder. */
  flows: boolean;
  /** "Gerente IA" — the per-conversation copilot insight panel. */
  aiCopilot: boolean;
  /** Public API key management + /api/v1/* + outbound webhook subscriptions. */
  apiAccess: boolean;
}

export const PLAN_FEATURES: Record<Plan, PlanFeatures> = {
  starter: { flows: false, aiCopilot: false, apiAccess: false },
  pro: { flows: true, aiCopilot: true, apiAccess: true },
};

/** The subset of `account_billing` feature-gating needs to read. */
export interface PlanBillingSummary {
  status: BillingStatus;
  plan: string | null;
}

/**
 * True iff the account currently has `feature` unlocked.
 *
 * - `billing` is `null` (row missing/not loaded) → fails OPEN, same
 *   policy as `isWriteLocked` — a transient lookup failure must never
 *   brick a paying customer's access to a feature they're entitled to.
 * - `status === 'trialing'` → always true, regardless of `plan`
 *   (which is typically null during trial anyway) — see header.
 * - Otherwise → looks up `plan` in `PLAN_FEATURES`. An unrecognized or
 *   missing plan defaults to `'starter'` (the MORE restrictive tier),
 *   not `'pro'` — defaulting open here would be a revenue leak, the
 *   mirror image of why the write-lock defaults closed-safe the other way.
 */
export function accountHasFeature(
  billing: PlanBillingSummary | null,
  feature: keyof PlanFeatures,
): boolean {
  if (!billing) return true;
  if (billing.status === 'trialing') return true;
  const plan = isPlan(billing.plan) ? billing.plan : 'starter';
  return PLAN_FEATURES[plan][feature];
}
