import crypto from 'node:crypto';

/**
 * Verify the `Authorization: Bearer <token>` header Rocketing Pay
 * attaches to every billing webhook POST, against
 * `ROCKETING_PAY_WEBHOOK_TOKEN`.
 *
 * Mirrors the fail-closed contract of `verifyMetaWebhookSignature`
 * (src/lib/whatsapp/webhook-signature.ts): a missing env var rejects
 * every request rather than silently accepting unsigned ones.
 *
 * CRITICAL — do not weaken the "header must be present" check. The
 * DSC app's webhook-checkout function has this exact bug:
 *
 *   if (webhookSecret && token && token !== webhookSecret) { reject }
 *
 * An ABSENT Authorization header makes `token` an empty string, which
 * is falsy, so the whole condition short-circuits to `false` and the
 * request sails through unauthenticated. This function requires the
 * header to be present and non-empty — there is no code path where
 * omitting it grants access.
 */
export function verifyRocketingPayToken(
  authorizationHeader: string | null,
): boolean {
  const expected = process.env.ROCKETING_PAY_WEBHOOK_TOKEN;
  if (!expected) {
    console.error(
      '[billing-webhook] ROCKETING_PAY_WEBHOOK_TOKEN is not set — rejecting request.',
    );
    return false;
  }

  if (!authorizationHeader) return false;

  const presented = authorizationHeader.replace(/^Bearer\s+/i, '').trim();
  if (!presented) return false;

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // Bail if lengths differ — timingSafeEqual throws on mismatched buffers.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
