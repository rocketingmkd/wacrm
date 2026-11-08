// ============================================================
// Plan feature matrix — pure, no I/O.
//
// Starter vs Pro (list prices in PLAN_PRICE_BRL below): the price gap is justified
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
  /** Multiple AI agents per account + transfer between them. Starter
   *  keeps exactly 1 agent (the receptionist), behaving like today —
   *  enforced not by this boolean alone but by POST /api/ai/agents also
   *  allowing a first agent regardless of plan (see that route). */
  aiAgents: boolean;
}

export const PLAN_FEATURES: Record<Plan, PlanFeatures> = {
  starter: { flows: false, aiCopilot: false, apiAccess: false, aiAgents: false },
  pro: { flows: true, aiCopilot: true, apiAccess: true, aiAgents: true },
};

/**
 * List price per plan, in BRL per month: the one place the landing page,
 * the platform admin and the "MRR estimado" read it from. Real charges
 * can differ (coupons, promos); the real amounts live in Rocketing Pay and
 * in `account_billing.last_payment_*`.
 */
export const PLAN_PRICE_BRL: Record<Plan, number> = {
  starter: 97,
  pro: 197,
};

/** A plan's list price as shown to people, e.g. "R$ 97". */
export function formatPlanPrice(plan: Plan): string {
  return `R$ ${PLAN_PRICE_BRL[plan]}`;
}

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
