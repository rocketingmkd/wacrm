// ============================================================
// Platform webhook token generation + hashing — pure, no I/O.
//
// Mirrors src/lib/api-keys/keys.ts exactly: the DB stores only the
// SHA-256 hash (platform_webhook_tokens.token_hash, migration 043),
// the plaintext is returned to the generating staff member exactly
// ONCE and never persisted or logged. Same "fast hash is correct
// here" reasoning — this is 32 bytes of CSPRNG entropy, not a
// user-chosen password, so there's nothing a slow KDF would protect
// against that a UNIQUE-indexed SHA-256 doesn't already.
// ============================================================

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Prefix on every generated token — self-identifying, part of the plaintext. */
export const WEBHOOK_TOKEN_PREFIX = 'rkpay_whsec_';

/** Chars of the random body shown in the display prefix (never the secret itself). */
const DISPLAY_BODY_CHARS = 8;

export interface GeneratedWebhookToken {
  /** Plaintext token — return to the caller ONCE, never persist. */
  plaintext: string;
  /** SHA-256 hex digest — persist this in platform_webhook_tokens.token_hash. */
  hash: string;
  /** Non-secret display string — persist this in .token_prefix. */
  prefix: string;
}

/**
 * Generate a fresh webhook token + its hash + its display prefix.
 * Call once per rotation; the plaintext is shown to staff in the
 * /platform/integrations "Gerar chave" flow and never again.
 */
export function generateWebhookToken(): GeneratedWebhookToken {
  const body = randomBytes(32).toString('base64url');
  const plaintext = `${WEBHOOK_TOKEN_PREFIX}${body}`;
  return {
    plaintext,
    hash: hashWebhookToken(plaintext),
    prefix: `${WEBHOOK_TOKEN_PREFIX}${body.slice(0, DISPLAY_BODY_CHARS)}…`,
  };
}

/** Deterministic SHA-256 of a plaintext token, hex-encoded. */
export function hashWebhookToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/** Cheap structural pre-check before hashing + hitting the DB. */
export function looksLikeWebhookToken(value: string): boolean {
  return value.startsWith(WEBHOOK_TOKEN_PREFIX) && value.length > WEBHOOK_TOKEN_PREFIX.length;
}

/**
 * Constant-time hex-digest comparison. Returns false (not a throw)
 * on any length mismatch — timingSafeEqual throws on unequal buffer
 * lengths, which would otherwise turn a routine "token doesn't
 * match" into an unhandled exception.
 */
export function timingSafeHexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
