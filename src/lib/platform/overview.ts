// ============================================================
// Platform admin numbers — pure helpers behind /platform's Painel and
// Assinaturas pages (no I/O, so they are unit-tested on their own).
// ============================================================

import { isPlan, type Plan } from '@/lib/billing/plan'

/**
 * List price per plan, in BRL per month. Only used for the
 * "MRR estimado": real charges can differ (coupons, promos), the real
 * amounts live in Rocketing Pay and in `account_billing.last_payment_*`.
 */
export const PLAN_PRICE_BRL: Record<Plan, number> = {
  starter: 97,
  pro: 197,
}

/** Monthly list price of a plan slug, 0 for no / unknown plan. */
export function planPrice(plan: string | null | undefined): number {
  return isPlan(plan) ? PLAN_PRICE_BRL[plan] : 0
}

export interface SubscriptionLike {
  status: string | null
  plan: string | null
}

export interface SubscriptionSummary {
  /** Sum of list prices of ACTIVE subscriptions. */
  mrr: number
  active: number
  trialing: number
  pastDue: number
  expired: number
  canceled: number
}

export function summarizeSubscriptions(rows: SubscriptionLike[]): SubscriptionSummary {
  const out: SubscriptionSummary = {
    mrr: 0,
    active: 0,
    trialing: 0,
    pastDue: 0,
    expired: 0,
    canceled: 0,
  }
  for (const r of rows) {
    switch (r.status) {
      case 'active':
        out.active += 1
        out.mrr += planPrice(r.plan)
        break
      case 'trialing':
        out.trialing += 1
        break
      case 'past_due':
        out.pastDue += 1
        break
      case 'expired':
        out.expired += 1
        break
      case 'canceled':
        out.canceled += 1
        break
    }
  }
  return out
}

export interface GrowthPoint {
  /** YYYY-MM (UTC), stable for tests and as a chart key. */
  key: string
  /** Short pt-BR month label, e.g. "out". */
  month: string
  /** Accounts that existed by the end of that month. */
  total: number
}

/**
 * Cumulative number of accounts at the end of each of the last
 * `months` months (UTC), oldest first. Accounts without a usable
 * `created_at` are ignored.
 */
export function monthlyGrowth(
  createdAts: (string | null | undefined)[],
  now: Date,
  months = 12,
): GrowthPoint[] {
  const times = createdAts
    .map((c) => (c ? new Date(c).getTime() : NaN))
    .filter((t) => Number.isFinite(t))

  const points: GrowthPoint[] = []
  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1)
    points.push({
      key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
      month: start
        .toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' })
        .replace('.', ''),
      total: times.filter((t) => t < next).length,
    })
  }
  return points
}

/** How many of the dates fall on or after `since`. */
export function countSince(
  createdAts: (string | null | undefined)[],
  since: Date,
): number {
  const from = since.getTime()
  return createdAts.filter((c) => (c ? new Date(c).getTime() >= from : false)).length
}

/** First instant of the current month (UTC). */
export function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}
