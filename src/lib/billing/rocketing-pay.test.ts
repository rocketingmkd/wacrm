import { describe, it, expect } from 'vitest';
import {
  normalizeRocketingPayPayload,
  planForProduct,
  resolveTrialDays,
  buildIdempotencyKey,
  decideBillingAction,
  PRODUCT_PLAN_MAP,
  type NormalizedBillingEvent,
  type CurrentBillingRow,
} from './rocketing-pay';

const NOW = new Date('2026-08-29T12:00:00.000Z');

function baseEvent(overrides: Partial<NormalizedBillingEvent> = {}): NormalizedBillingEvent {
  return {
    rawEvent: '',
    resolvedStatus: 'unknown',
    email: 'cliente@exemplo.com',
    name: 'Cliente Teste',
    phone: '',
    transactionId: 'tst-0001',
    productId: null,
    productName: '',
    amount: 0,
    paymentMethod: '',
    proximaCobranca: null,
    diasAtraso: 0,
    tipo: null,
    trialDaysRaw: null,
    ...overrides,
  };
}

describe('normalizeRocketingPayPayload', () => {
  it('returns null for a payload with no data field', () => {
    expect(normalizeRocketingPayPayload({ body: { event: 'ping' } })).toBeNull();
    expect(normalizeRocketingPayPayload({})).toBeNull();
    expect(normalizeRocketingPayPayload(null)).toBeNull();
    expect(normalizeRocketingPayPayload('not an object')).toBeNull();
  });

  it('reads a wrapped payload ({ body: { data } })', () => {
    const ev = normalizeRocketingPayPayload({
      body: {
        event: 'subscription_renewal',
        produto_id: 46,
        data: {
          status_pagamento: 'approved',
          comprador: { email: 'Cliente@Exemplo.com', nome: 'Cliente' },
          transacao_id: 'tx-1',
          valor: 97,
        },
      },
    });
    expect(ev).not.toBeNull();
    expect(ev!.email).toBe('cliente@exemplo.com'); // lower-cased
    expect(ev!.resolvedStatus).toBe('renewal');
    expect(ev!.productId).toBe('46');
    expect(ev!.amount).toBe(97);
  });

  it('reads a bare payload ({ data } with no body wrapper)', () => {
    const ev = normalizeRocketingPayPayload({
      produto_id: 46,
      event: 'trial',
      data: { comprador_email: 'a@b.com', comprador_nome: 'A' },
    });
    expect(ev).not.toBeNull();
    expect(ev!.email).toBe('a@b.com');
    expect(ev!.resolvedStatus).toBe('trial');
    expect(ev!.productId).toBe('46');
  });

  it('falls back comprador.email -> comprador_email', () => {
    const ev = normalizeRocketingPayPayload({
      data: { comprador_email: 'fallback@x.com' },
    });
    expect(ev!.email).toBe('fallback@x.com');
  });

  it('email is null when absent from either shape', () => {
    const ev = normalizeRocketingPayPayload({ data: {} });
    expect(ev!.email).toBeNull();
  });

  it('maps chargeback to the refunded resolved status', () => {
    const ev = normalizeRocketingPayPayload({
      data: { status_pagamento: 'chargeback' },
    });
    expect(ev!.resolvedStatus).toBe('refunded');
  });

  it('unknown event/status resolves to unknown', () => {
    const ev = normalizeRocketingPayPayload({ event: 'something_else', data: {} });
    expect(ev!.resolvedStatus).toBe('unknown');
  });

  it('picks transacao_id, else venda_id, else assinatura_id', () => {
    expect(normalizeRocketingPayPayload({ data: { transacao_id: 't1' } })!.transactionId).toBe('t1');
    expect(normalizeRocketingPayPayload({ data: { venda_id: 'v1' } })!.transactionId).toBe('v1');
    expect(normalizeRocketingPayPayload({ data: { assinatura_id: 's1' } })!.transactionId).toBe('s1');
  });
});

describe('planForProduct', () => {
  it('returns null for a null productId', () => {
    expect(planForProduct(null)).toBeNull();
  });

  it('returns null for an unmapped product', () => {
    expect(planForProduct('unmapped-id')).toBeNull();
  });

  it('resolves every configured product', () => {
    for (const [id, plan] of Object.entries(PRODUCT_PLAN_MAP)) {
      expect(planForProduct(id)).toBe(plan);
    }
  });
});

describe('resolveTrialDays', () => {
  it('uses the explicit trial_days from the payload', () => {
    expect(resolveTrialDays(baseEvent({ trialDaysRaw: 14 }), 7)).toBe(14);
  });

  it('falls back to the trial_1m/trial_3m event convention', () => {
    expect(resolveTrialDays(baseEvent({ rawEvent: 'trial_1m' }), 7)).toBe(30);
    expect(resolveTrialDays(baseEvent({ rawEvent: 'trial_3m' }), 7)).toBe(90);
  });

  it('falls back to the platform default when nothing else applies', () => {
    expect(resolveTrialDays(baseEvent({ rawEvent: 'trial' }), 7)).toBe(7);
  });

  it('clamps below 1 up to 1', () => {
    expect(resolveTrialDays(baseEvent({ trialDaysRaw: 0 }), 7)).toBe(1);
    expect(resolveTrialDays(baseEvent({ trialDaysRaw: -5 }), 7)).toBe(1);
  });

  it('clamps above 365 down to 365', () => {
    expect(resolveTrialDays(baseEvent({ trialDaysRaw: 10000 }), 7)).toBe(365);
  });
});

describe('buildIdempotencyKey', () => {
  it('null when there is no transaction id at all', () => {
    expect(buildIdempotencyKey(baseEvent({ transactionId: '', resolvedStatus: 'approved' }), NOW)).toBeNull();
  });

  it('null for unknown events', () => {
    expect(buildIdempotencyKey(baseEvent({ resolvedStatus: 'unknown' }), NOW)).toBeNull();
  });

  it('null for a plain charge reminder (never state-changing)', () => {
    expect(
      buildIdempotencyKey(baseEvent({ resolvedStatus: 'charge', tipo: 'lembrete' }), NOW),
    ).toBeNull();
  });

  it('non-null for an overdue charge (tipo=atraso)', () => {
    expect(
      buildIdempotencyKey(baseEvent({ resolvedStatus: 'charge', tipo: 'atraso' }), NOW),
    ).not.toBeNull();
  });

  it('non-null for an overdue charge (dias_atraso > 0, no tipo)', () => {
    expect(
      buildIdempotencyKey(baseEvent({ resolvedStatus: 'charge', diasAtraso: 3 }), NOW),
    ).not.toBeNull();
  });

  it('is deterministic for the same event + same day', () => {
    const ev = baseEvent({ resolvedStatus: 'approved', transactionId: 'tx-1' });
    expect(buildIdempotencyKey(ev, NOW)).toBe(buildIdempotencyKey(ev, NOW));
  });

  it('two renewals of the same subscription in different months get different keys', () => {
    const ev = baseEvent({ resolvedStatus: 'renewal', transactionId: 'sub-1' });
    const august = buildIdempotencyKey(ev, new Date('2026-08-15T00:00:00Z'));
    const september = buildIdempotencyKey(ev, new Date('2026-09-15T00:00:00Z'));
    expect(august).not.toBe(september);
  });

  it('two renewal deliveries the same day dedupe to the same key', () => {
    const ev = baseEvent({ resolvedStatus: 'renewal', transactionId: 'sub-1' });
    const a = buildIdempotencyKey(ev, new Date('2026-08-15T08:00:00Z'));
    const b = buildIdempotencyKey(ev, new Date('2026-08-15T23:00:00Z'));
    expect(a).toBe(b);
  });
});

describe('decideBillingAction', () => {
  const opts = { defaultTrialDays: 7, now: NOW };

  it('trial event sets status=trialing with a computed trial_ends_at', () => {
    const d = decideBillingAction(baseEvent({ resolvedStatus: 'trial' }), null, opts);
    expect(d.action).toBe('trial_set');
    expect(d.patch?.status).toBe('trialing');
    expect(d.patch?.trial_ends_at).toBe(
      new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    );
  });

  it('approved activates the account and clears trial/past_due', () => {
    const d = decideBillingAction(baseEvent({ resolvedStatus: 'approved', amount: 97 }), null, opts);
    expect(d.action).toBe('activated');
    expect(d.patch).toMatchObject({
      status: 'active',
      trial_ends_at: null,
      past_due_since: null,
      last_payment_amount: 97,
    });
  });

  it('renewal activates and is distinguished from approved by action name', () => {
    const d = decideBillingAction(baseEvent({ resolvedStatus: 'renewal' }), null, opts);
    expect(d.action).toBe('renewed');
    expect(d.patch?.status).toBe('active');
  });

  it('a plain charge reminder logs only, no patch', () => {
    const d = decideBillingAction(baseEvent({ resolvedStatus: 'charge', tipo: 'lembrete' }), null, opts);
    expect(d.action).toBe('charge_logged');
    expect(d.patch).toBeNull();
  });

  it('an overdue charge moves the account to past_due without locking it', () => {
    const d = decideBillingAction(baseEvent({ resolvedStatus: 'charge', tipo: 'atraso' }), null, opts);
    expect(d.action).toBe('past_due');
    expect(d.patch?.status).toBe('past_due');
  });

  it('past_due_since is preserved once already set (first-failure timestamp, not renewed each webhook)', () => {
    const current: CurrentBillingRow = {
      status: 'past_due',
      plan: null,
      external_subscription_id: null,
      external_product_id: null,
      past_due_since: '2026-08-01T00:00:00.000Z',
    };
    const d = decideBillingAction(baseEvent({ resolvedStatus: 'charge', tipo: 'atraso' }), current, opts);
    expect(d.patch?.past_due_since).toBe('2026-08-01T00:00:00.000Z');
  });

  it('expired locks the account', () => {
    const d = decideBillingAction(baseEvent({ resolvedStatus: 'expired' }), null, opts);
    expect(d.action).toBe('locked');
    expect(d.patch).toEqual({ status: 'expired' });
  });

  it('refunded/chargeback cancels the account', () => {
    const d = decideBillingAction(baseEvent({ resolvedStatus: 'refunded' }), null, opts);
    expect(d.action).toBe('canceled');
    expect(d.patch).toEqual({ status: 'canceled' });
  });

  it('declined moves to past_due, does NOT lock (deliberate deviation from DSC)', () => {
    const d = decideBillingAction(baseEvent({ resolvedStatus: 'declined' }), null, opts);
    expect(d.action).toBe('past_due');
    expect(d.patch?.status).toBe('past_due');
  });

  it('unknown status is ignored, no patch', () => {
    const d = decideBillingAction(baseEvent({ resolvedStatus: 'unknown' }), null, opts);
    expect(d.action).toBe('ignored');
    expect(d.patch).toBeNull();
  });

  it('plan carries forward from current row when the product is unmapped', () => {
    const current: CurrentBillingRow = {
      status: 'active',
      plan: 'starter',
      external_subscription_id: null,
      external_product_id: null,
      past_due_since: null,
    };
    const d = decideBillingAction(
      baseEvent({ resolvedStatus: 'renewal', productId: null }),
      current,
      opts,
    );
    expect(d.patch?.plan).toBe('starter');
  });
});
