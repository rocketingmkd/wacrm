import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { processQueue, type QueueResult, type QueueRow } from '@/lib/conversions/queue'
import { refreshAccessToken } from './oauth'
import { buildGoogleRequest, ingestEvents, onlyDigits, type GoogleOrigin } from './data-manager'

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

interface GoogleRow extends QueueRow {
  rule_id: string
}

interface AccountCfg {
  enabled: boolean
  validateOnly: boolean
  connection: GoogleConnection | null
  accessToken: string | null
}

/**
 * Sends the due Google rows to the Data Manager API, oldest first. Each row
 * is claimed before sending and failures retry with backoff (see
 * `processQueue`). Never throws.
 *
 * While google_validate_only is on, Google validates the request and nothing
 * is imported; the row is closed as "skipped" with a note.
 */
export async function processGoogleQueue(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<QueueResult> {
  const nowSecs = Math.floor(now.getTime() / 1000)

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

  return processQueue<GoogleRow>(db, now, {
    destination: 'google',
    columns: 'id, account_id, contact_id, rule_id, event_name, value, currency, occurred_at, attempts',
    logTag: '[google-conversions]',
    async process(row) {
      const cfg = await accountCfg(row.account_id)
      if (!cfg.enabled) return { kind: 'skipped', detail: 'Envio ao Google desativado' }
      const customerId = onlyDigits(cfg.connection?.customerId)
      if (!cfg.connection || !customerId) {
        return { kind: 'skipped', detail: 'Google Ads não conectado ou sem conta escolhida' }
      }

      const { data: rule } = await db
        .from('conversion_rules')
        .select('google_action_id')
        .eq('id', row.rule_id)
        .maybeSingle()
      const actionId = onlyDigits(rule?.google_action_id as string | null)
      if (!actionId) {
        return { kind: 'skipped', detail: 'Regra sem ação de conversão do Google' }
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
      if ('skip' in built) return { kind: 'skipped', detail: built.skip }

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
        return {
          kind: 'skipped',
          countAttempt: true,
          detail: `Teste: o Google validou, nada foi importado.${warning}`.slice(0, 300),
        }
      }
      return { kind: 'sent', detail: warning ? warning.trim().slice(0, 300) : null }
    },
  })
}
