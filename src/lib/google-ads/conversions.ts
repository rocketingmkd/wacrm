import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  MAX_ATTEMPTS,
  backoffMinutes,
  type QueueResult,
  type QueuedEvent,
} from '@/lib/tracking/conversions'
import { refreshAccessToken } from './oauth'
import { buildGoogleRequest, ingestEvents, onlyDigits, type GoogleOrigin } from './data-manager'

const BATCH = 50

export interface GoogleConnection {
  clientId: string
  clientSecret: string
  refreshToken: string
  customerId: string | null
  loginCustomerId: string | null
}

/** Reads and decrypts the account's Google connection. Service role only. */
export async function loadConnection(db: SupabaseClient, accountId: string): Promise<GoogleConnection | null> {
  const { data } = await db
    .from('google_ads_connections')
    .select('client_id, client_secret_enc, refresh_token_enc, customer_id, login_customer_id')
    .eq('account_id', accountId)
    .maybeSingle()
  if (!data?.refresh_token_enc) return null
  try {
    return {
      clientId: data.client_id as string,
      clientSecret: decrypt(data.client_secret_enc as string),
      refreshToken: decrypt(data.refresh_token_enc as string),
      customerId: (data.customer_id as string | null) ?? null,
      loginCustomerId: (data.login_customer_id as string | null) ?? null,
    }
  } catch {
    return null
  }
}

interface Row extends QueuedEvent {
  account_id: string
  contact_id: string | null
  rule_id: string
  attempts: number
}

interface AccountCfg {
  enabled: boolean
  validateOnly: boolean
  connection: GoogleConnection | null
  accessToken: string | null
}

/**
 * Sends the due Google rows to the Data Manager API, oldest first. Mirrors
 * processConversionQueue (Meta): each row is claimed by moving its
 * next_attempt_at forward, failures retry with backoff, and the function
 * never throws.
 *
 * While google_validate_only is on, Google validates the request and nothing
 * is imported; the row is closed as "skipped" with a note.
 */
export async function processGoogleQueue(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<QueueResult> {
  const result: QueueResult = { processed: 0, sent: 0, skipped: 0, failed: 0 }
  const nowSecs = Math.floor(now.getTime() / 1000)

  const { data: rows, error } = await db
    .from('conversion_events')
    .select('id, account_id, contact_id, rule_id, event_name, value, currency, occurred_at, attempts')
    .eq('destination', 'google')
    .in('status', ['pending', 'failed'])
    .lt('attempts', MAX_ATTEMPTS)
    .lte('next_attempt_at', now.toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(BATCH)
  if (error || !rows) {
    if (error) console.error('[google-conversions] queue read failed:', error.message)
    return result
  }

  const cache = new Map<string, AccountCfg>()
  async function accountCfg(accountId: string): Promise<AccountCfg> {
    const cached = cache.get(accountId)
    if (cached) return cached
    const { data: s } = await db
      .from('conversion_settings')
      .select('google_enabled, google_validate_only')
      .eq('account_id', accountId)
      .maybeSingle()
    const value: AccountCfg = {
      enabled: Boolean(s?.google_enabled),
      validateOnly: s?.google_validate_only !== false,
      connection: await loadConnection(db, accountId),
      accessToken: null,
    }
    cache.set(accountId, value)
    return value
  }

  for (const row of rows as Row[]) {
    result.processed += 1
    const finish = (patch: Record<string, unknown>) =>
      db.from('conversion_events').update(patch).eq('id', row.id)

    try {
      await finish({ next_attempt_at: new Date(now.getTime() + 10 * 60_000).toISOString() })

      const cfg = await accountCfg(row.account_id)
      if (!cfg.enabled) {
        await finish({ status: 'skipped', detail: 'Envio ao Google desativado' })
        result.skipped += 1
        continue
      }
      const customerId = onlyDigits(cfg.connection?.customerId)
      if (!cfg.connection || !customerId) {
        await finish({ status: 'skipped', detail: 'Google Ads não conectado ou sem conta escolhida' })
        result.skipped += 1
        continue
      }

      const { data: rule } = await db
        .from('conversion_rules')
        .select('google_action_id')
        .eq('id', row.rule_id)
        .maybeSingle()
      const actionId = onlyDigits(rule?.google_action_id as string | null)
      if (!actionId) {
        await finish({ status: 'skipped', detail: 'Regra sem ação de conversão do Google' })
        result.skipped += 1
        continue
      }

      let origin: GoogleOrigin | null = null
      if (row.contact_id) {
        const { data: a } = await db
          .from('lead_attribution')
          .select('gclid')
          .eq('account_id', row.account_id)
          .eq('contact_id', row.contact_id)
          .maybeSingle()
        origin = (a as GoogleOrigin | null) ?? null
      }

      const built = buildGoogleRequest(
        row,
        origin,
        {
          customerId,
          loginCustomerId: onlyDigits(cfg.connection.loginCustomerId) || null,
          actionId,
        },
        nowSecs,
        cfg.validateOnly,
      )
      if ('skip' in built) {
        await finish({ status: 'skipped', detail: built.skip })
        result.skipped += 1
        continue
      }

      if (!cfg.accessToken) {
        cfg.accessToken = await refreshAccessToken({
          refreshToken: cfg.connection.refreshToken,
          clientId: cfg.connection.clientId,
          clientSecret: cfg.connection.clientSecret,
        })
      }
      const sent = await ingestEvents(cfg.accessToken, built.body)
      const warning = sent.warnings.length > 0 ? ` Avisos: ${sent.warnings.join('; ')}` : ''

      if (cfg.validateOnly) {
        await finish({
          status: 'skipped',
          attempts: row.attempts + 1,
          detail: `Teste: o Google validou, nada foi importado.${warning}`.slice(0, 300),
        })
        result.skipped += 1
      } else {
        await finish({
          status: 'sent',
          sent_at: new Date().toISOString(),
          attempts: row.attempts + 1,
          detail: warning ? warning.trim().slice(0, 300) : null,
        })
        result.sent += 1
      }
    } catch (err) {
      const attempts = row.attempts + 1
      const message = err instanceof Error ? err.message : String(err)
      await finish({
        status: 'failed',
        attempts,
        next_attempt_at: new Date(now.getTime() + backoffMinutes(attempts) * 60_000).toISOString(),
        detail: message.slice(0, 300),
      })
      result.failed += 1
      console.error('[google-conversions] send failed:', message)
    }
  }
  return result
}
