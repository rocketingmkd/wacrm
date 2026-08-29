import { describe, it, expect } from 'vitest';
import { accountHasFeature, isPlan, PLAN_FEATURES, PLANS, type PlanBillingSummary } from './plan';

function billing(overrides: Partial<PlanBillingSummary>): PlanBillingSummary {
  return { status: 'active', plan: null, ...overrides };
}

describe('isPlan', () => {
  it('accepts every declared plan', () => {
    for (const p of PLANS) expect(isPlan(p)).toBe(true);
  });
  it('rejects unknown values', () => {
    expect(isPlan('enterprise')).toBe(false);
    expect(isPlan(null)).toBe(false);
    expect(isPlan(undefined)).toBe(false);
  });
});

describe('accountHasFeature', () => {
  it('fails open when billing is null (row missing/not loaded)', () => {
    expect(accountHasFeature(null, 'flows')).toBe(true);
    expect(accountHasFeature(null, 'aiCopilot')).toBe(true);
    expect(accountHasFeature(null, 'apiAccess')).toBe(true);
  });

  it('unlocks everything during trial, regardless of plan', () => {
    expect(accountHasFeature(billing({ status: 'trialing', plan: null }), 'flows')).toBe(true);
    expect(accountHasFeature(billing({ status: 'trialing', plan: 'starter' }), 'aiCopilot')).toBe(
      true,
    );
  });

  it('starter plan: none of the pro features', () => {
    const b = billing({ status: 'active', plan: 'starter' });
    expect(accountHasFeature(b, 'flows')).toBe(false);
    expect(accountHasFeature(b, 'aiCopilot')).toBe(false);
    expect(accountHasFeature(b, 'apiAccess')).toBe(false);
  });

  it('pro plan: all features unlocked', () => {
    const b = billing({ status: 'active', plan: 'pro' });
    expect(accountHasFeature(b, 'flows')).toBe(true);
    expect(accountHasFeature(b, 'aiCopilot')).toBe(true);
    expect(accountHasFeature(b, 'apiAccess')).toBe(true);
  });

  it('past_due keeps the plan-based access it already had (not an extra lock)', () => {
    expect(accountHasFeature(billing({ status: 'past_due', plan: 'pro' }), 'flows')).toBe(true);
    expect(accountHasFeature(billing({ status: 'past_due', plan: 'starter' }), 'flows')).toBe(
      false,
    );
  });

  it('an unrecognized or missing plan defaults to the MORE restrictive tier (starter), not pro', () => {
    expect(accountHasFeature(billing({ status: 'active', plan: null }), 'flows')).toBe(false);
    expect(accountHasFeature(billing({ status: 'active', plan: 'legacy_v1' }), 'apiAccess')).toBe(
      false,
    );
  });

  it('PLAN_FEATURES has an entry for every declared plan', () => {
    for (const p of PLANS) {
      expect(PLAN_FEATURES[p]).toBeDefined();
    }
  });
});
