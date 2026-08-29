import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyRocketingPayToken } from './webhook-auth';

const TOKEN = 'whsec_test_token_12345';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('verifyRocketingPayToken', () => {
  it('rejects when ROCKETING_PAY_WEBHOOK_TOKEN is unset (fail closed)', () => {
    vi.stubEnv('ROCKETING_PAY_WEBHOOK_TOKEN', '');
    expect(verifyRocketingPayToken(`Bearer ${TOKEN}`)).toBe(false);
  });

  it('THE DSC BUG — an absent Authorization header must reject, not bypass', () => {
    vi.stubEnv('ROCKETING_PAY_WEBHOOK_TOKEN', TOKEN);
    expect(verifyRocketingPayToken(null)).toBe(false);
  });

  it('rejects an empty string header', () => {
    vi.stubEnv('ROCKETING_PAY_WEBHOOK_TOKEN', TOKEN);
    expect(verifyRocketingPayToken('')).toBe(false);
  });

  it('rejects "Bearer " with nothing after it', () => {
    vi.stubEnv('ROCKETING_PAY_WEBHOOK_TOKEN', TOKEN);
    expect(verifyRocketingPayToken('Bearer ')).toBe(false);
  });

  it('accepts the correct token with the Bearer prefix', () => {
    vi.stubEnv('ROCKETING_PAY_WEBHOOK_TOKEN', TOKEN);
    expect(verifyRocketingPayToken(`Bearer ${TOKEN}`)).toBe(true);
  });

  it('accepts the correct token without the Bearer prefix', () => {
    vi.stubEnv('ROCKETING_PAY_WEBHOOK_TOKEN', TOKEN);
    expect(verifyRocketingPayToken(TOKEN)).toBe(true);
  });

  it('accepts a lowercase "bearer" prefix', () => {
    vi.stubEnv('ROCKETING_PAY_WEBHOOK_TOKEN', TOKEN);
    expect(verifyRocketingPayToken(`bearer ${TOKEN}`)).toBe(true);
  });

  it('rejects a wrong token of the same length', () => {
    vi.stubEnv('ROCKETING_PAY_WEBHOOK_TOKEN', TOKEN);
    expect(verifyRocketingPayToken(`Bearer ${'x'.repeat(TOKEN.length)}`)).toBe(false);
  });

  it('rejects a wrong token of a different length', () => {
    vi.stubEnv('ROCKETING_PAY_WEBHOOK_TOKEN', TOKEN);
    expect(verifyRocketingPayToken('Bearer short')).toBe(false);
  });
});
