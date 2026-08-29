// ============================================================
// Platform webhook token store — the auth-path data access for
// platform_webhook_tokens (migration 043). Mirrors
// src/lib/api-keys/store.ts: read-only here, always via the
// service-role client (a webhook caller has no Supabase session, so
// RLS can't scope the lookup — and this table has no policies at
// all regardless). Generation/rotation lives inline in the
// /platform API route (src/app/api/platform/integrations/
// webhook-token/route.ts), same split as api-keys management.
// ============================================================

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { hashWebhookToken, timingSafeHexEqual } from './webhook-token';

/**
 * True iff `authorizationHeader` presents the currently-valid token
 * for `integration`. Fails closed on every edge case: no header, no
 * row generated yet, hash mismatch — all return false, never throw.
 */
export async function verifyStoredWebhookToken(
  integration: string,
  authorizationHeader: string | null,
): Promise<boolean> {
  if (!authorizationHeader) return false;
  const presented = authorizationHeader.replace(/^Bearer\s+/i, '').trim();
  if (!presented) return false;

  const { data, error } = await supabaseAdmin()
    .from('platform_webhook_tokens')
    .select('token_hash')
    .eq('integration', integration)
    .maybeSingle();

  if (error) {
    console.error('[webhook-token-store] lookup error:', error.message);
    return false;
  }
  // No token generated yet for this integration — nothing can match.
  if (!data) return false;

  return timingSafeHexEqual(hashWebhookToken(presented), data.token_hash);
}
