import { describe, it, expect } from 'vitest';
import {
  generateWebhookToken,
  hashWebhookToken,
  looksLikeWebhookToken,
  timingSafeHexEqual,
  WEBHOOK_TOKEN_PREFIX,
} from './webhook-token';

describe('generateWebhookToken', () => {
  it('plaintext starts with the prefix and hashes to the returned hash', () => {
    const t = generateWebhookToken();
    expect(t.plaintext.startsWith(WEBHOOK_TOKEN_PREFIX)).toBe(true);
    expect(t.hash).toBe(hashWebhookToken(t.plaintext));
  });

  it('prefix is a strict, short fragment of the plaintext — never the full secret', () => {
    const t = generateWebhookToken();
    expect(t.plaintext.startsWith(t.prefix.replace(/…$/, ''))).toBe(true);
    expect(t.prefix.length).toBeLessThan(t.plaintext.length / 2);
  });

  it('two generations never collide', () => {
    const a = generateWebhookToken();
    const b = generateWebhookToken();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('hashWebhookToken', () => {
  it('is deterministic', () => {
    expect(hashWebhookToken('same-input')).toBe(hashWebhookToken('same-input'));
  });

  it('is a 64-char hex digest (SHA-256)', () => {
    expect(hashWebhookToken('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('looksLikeWebhookToken', () => {
  it('accepts a real generated token', () => {
    expect(looksLikeWebhookToken(generateWebhookToken().plaintext)).toBe(true);
  });

  it('rejects the bare prefix with nothing after it', () => {
    expect(looksLikeWebhookToken(WEBHOOK_TOKEN_PREFIX)).toBe(false);
  });

  it('rejects an unrelated string', () => {
    expect(looksLikeWebhookToken('wacrm_live_something')).toBe(false);
    expect(looksLikeWebhookToken('')).toBe(false);
  });
});

describe('timingSafeHexEqual', () => {
  it('true for identical hex strings', () => {
    const h = hashWebhookToken('a');
    expect(timingSafeHexEqual(h, h)).toBe(true);
  });

  it('false for different hex strings of the same length', () => {
    expect(timingSafeHexEqual(hashWebhookToken('a'), hashWebhookToken('b'))).toBe(false);
  });

  it('false (not throwing) on length mismatch', () => {
    expect(timingSafeHexEqual('ab', 'abcd')).toBe(false);
  });
});
