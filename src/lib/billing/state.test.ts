import { describe, it, expect } from 'vitest';
import {
  isWriteLocked,
  billingWarning,
  trialDaysRemaining,
  isBillingStatus,
  type BillingSummary,
} from './state';

const NOW = new Date('2026-08-29T12:00:00.000Z');

function billing(overrides: Partial<BillingSummary>): BillingSummary {
  return {
    status: 'active',
    trial_ends_at: null,
    current_period_end: null,
    past_due_since: null,
    ...overrides,
  };
}

describe('isBillingStatus', () => {
  it('accepts every known status', () => {
    for (const s of ['trialing', 'active', 'past_due', 'expired', 'canceled']) {
      expect(isBillingStatus(s)).toBe(true);
    }
  });
  it('rejects unknown values', () => {
    expect(isBillingStatus('lifetime')).toBe(false);
    expect(isBillingStatus(null)).toBe(false);
    expect(isBillingStatus(undefined)).toBe(false);
  });
});

describe('isWriteLocked', () => {
  it('null billing (row missing/not loaded yet) fails open — not locked', () => {
    expect(isWriteLocked(null, NOW)).toBe(false);
  });

  it('active is never locked', () => {
    expect(isWriteLocked(billing({ status: 'active' }), NOW)).toBe(false);
  });

  it('past_due is NOT locked — it is the grace window', () => {
    expect(isWriteLocked(billing({ status: 'past_due' }), NOW)).toBe(false);
  });

  it('expired is always locked', () => {
    expect(isWriteLocked(billing({ status: 'expired' }), NOW)).toBe(true);
  });

  it('canceled is always locked', () => {
    expect(isWriteLocked(billing({ status: 'canceled' }), NOW)).toBe(true);
  });

  it('trialing with no trial_ends_at is not locked', () => {
    expect(isWriteLocked(billing({ status: 'trialing', trial_ends_at: null }), NOW)).toBe(false);
  });

  it('trialing with a future trial_ends_at is not locked', () => {
    const future = new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString();
    expect(isWriteLocked(billing({ status: 'trialing', trial_ends_at: future }), NOW)).toBe(false);
  });

  it('trialing exactly at the boundary (trial_ends_at === now) is locked', () => {
    expect(
      isWriteLocked(billing({ status: 'trialing', trial_ends_at: NOW.toISOString() }), NOW),
    ).toBe(true);
  });

  it('trialing with a past trial_ends_at is locked', () => {
    const past = new Date(NOW.getTime() - 1000).toISOString();
    expect(isWriteLocked(billing({ status: 'trialing', trial_ends_at: past }), NOW)).toBe(true);
  });
});

describe('trialDaysRemaining', () => {
  it('null for non-trialing accounts', () => {
    expect(trialDaysRemaining(billing({ status: 'active' }), NOW)).toBeNull();
  });

  it('null when trialing but trial_ends_at is unset', () => {
    expect(trialDaysRemaining(billing({ status: 'trialing', trial_ends_at: null }), NOW)).toBeNull();
  });

  it('rounds up partial days remaining', () => {
    const in36h = new Date(NOW.getTime() + 36 * 60 * 60 * 1000).toISOString();
    expect(trialDaysRemaining(billing({ status: 'trialing', trial_ends_at: in36h }), NOW)).toBe(2);
  });

  it('negative once the trial has passed', () => {
    const past = new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString();
    expect(trialDaysRemaining(billing({ status: 'trialing', trial_ends_at: past }), NOW)).toBe(-1);
  });
});

describe('billingWarning', () => {
  it('null for a healthy active account', () => {
    expect(billingWarning(billing({ status: 'active' }), NOW)).toBeNull();
  });

  it('null for null billing', () => {
    expect(billingWarning(null, NOW)).toBeNull();
  });

  it('null for trialing with plenty of time left', () => {
    const in10d = new Date(NOW.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(billingWarning(billing({ status: 'trialing', trial_ends_at: in10d }), NOW)).toBeNull();
  });

  it('trial_ending inside the warning window', () => {
    const in2d = new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(billingWarning(billing({ status: 'trialing', trial_ends_at: in2d }), NOW)).toEqual({
      kind: 'trial_ending',
      days: 2,
    });
  });

  it('locked (not trial_ending) once the trial has actually lapsed', () => {
    const past = new Date(NOW.getTime() - 1000).toISOString();
    expect(billingWarning(billing({ status: 'trialing', trial_ends_at: past }), NOW)).toEqual({
      kind: 'locked',
    });
  });

  it('past_due warns but the account is still writable', () => {
    const since = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const w = billingWarning(billing({ status: 'past_due', past_due_since: since }), NOW);
    expect(w?.kind).toBe('past_due');
    expect(w?.days).toBe(3);
  });

  it('expired/canceled report locked', () => {
    expect(billingWarning(billing({ status: 'expired' }), NOW)).toEqual({ kind: 'locked' });
    expect(billingWarning(billing({ status: 'canceled' }), NOW)).toEqual({ kind: 'locked' });
  });
});
