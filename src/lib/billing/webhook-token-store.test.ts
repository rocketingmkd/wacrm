import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashWebhookToken } from './webhook-token';

// Mock the admin client factory so this stays a pure unit test (no
// real DB). The property under test here is security-critical enough
// (this is the exact bug class the DSC app shipped — see
// src/lib/billing/webhook-token-store.ts's header comment) that it's
// worth a real test despite api-keys/store.ts's convention of leaving
// DB-glue untested.
const from = vi.fn();
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({ from }),
}));

const { verifyStoredWebhookToken } = await import('./webhook-token-store');

function queuedResult(result: { data: unknown; error: unknown }) {
  from.mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve(result),
      }),
    }),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('verifyStoredWebhookToken', () => {
  it('THE DSC BUG — an absent Authorization header must reject, never bypass', async () => {
    // Even if the DB happens to have a matching row, no header must never pass.
    queuedResult({ data: { token_hash: 'irrelevant' }, error: null });
    await expect(verifyStoredWebhookToken('rocketing_pay', null)).resolves.toBe(false);
    // Never even queries the DB for a missing header — fails before that.
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects an empty header', async () => {
    await expect(verifyStoredWebhookToken('rocketing_pay', '')).resolves.toBe(false);
  });

  it('rejects "Bearer " with nothing after it', async () => {
    await expect(verifyStoredWebhookToken('rocketing_pay', 'Bearer ')).resolves.toBe(false);
  });

  it('rejects when no token has been generated for this integration yet', async () => {
    queuedResult({ data: null, error: null });
    await expect(
      verifyStoredWebhookToken('rocketing_pay', 'Bearer rkpay_whsec_anything'),
    ).resolves.toBe(false);
  });

  it('rejects on a DB error, fails closed', async () => {
    queuedResult({ data: null, error: { message: 'boom' } });
    await expect(
      verifyStoredWebhookToken('rocketing_pay', 'Bearer rkpay_whsec_anything'),
    ).resolves.toBe(false);
  });

  it('accepts the correct token', async () => {
    const plaintext = 'rkpay_whsec_realtoken123';
    queuedResult({ data: { token_hash: hashWebhookToken(plaintext) }, error: null });
    await expect(
      verifyStoredWebhookToken('rocketing_pay', `Bearer ${plaintext}`),
    ).resolves.toBe(true);
  });

  it('rejects a wrong token', async () => {
    queuedResult({ data: { token_hash: hashWebhookToken('rkpay_whsec_real') }, error: null });
    await expect(
      verifyStoredWebhookToken('rocketing_pay', 'Bearer rkpay_whsec_wrong'),
    ).resolves.toBe(false);
  });

  it('accepts without the Bearer prefix too', async () => {
    const plaintext = 'rkpay_whsec_realtoken123';
    queuedResult({ data: { token_hash: hashWebhookToken(plaintext) }, error: null });
    await expect(verifyStoredWebhookToken('rocketing_pay', plaintext)).resolves.toBe(true);
  });
});
