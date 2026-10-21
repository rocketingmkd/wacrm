// ============================================================
// Registers the CRM as the inbound webhook of an account's Evolution
// instance (group messages). Idempotent: Evolution replaces the
// instance's webhook config on every call. The marker column
// `webhook_set_at` (migration 071) lets callers register once for
// sessions that were already active before groups existed.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { setWebhook } from '@/lib/whatsapp/evolution-api';
import { webhookSecretFor } from '@/lib/whatsapp/evolution-group-inbound';

export function evolutionWebhookUrl(): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('NEXT_PUBLIC_SITE_URL is not set');
  return `${base}/api/whatsapp/evolution/webhook`;
}

/**
 * Point the instance at the CRM and stamp `webhook_set_at`. Best effort:
 * a failure is logged and returned as false, never thrown, so it can't
 * break activating the session or loading the settings card.
 */
export async function ensureEvolutionWebhook(
  db: SupabaseClient,
  accountId: string,
  instanceName: string,
): Promise<boolean> {
  try {
    await setWebhook({
      instanceName,
      url: evolutionWebhookUrl(),
      headers: { 'x-evolution-secret': webhookSecretFor(instanceName) },
    });
    await db
      .from('whatsapp_unofficial_sessions')
      .update({ webhook_set_at: new Date().toISOString() })
      .eq('account_id', accountId);
    return true;
  } catch (err) {
    console.warn('[unofficial] webhook registration failed:', err instanceof Error ? err.message : err);
    return false;
  }
}
