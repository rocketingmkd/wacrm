import type { AttributionSource } from './attribution'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendCapiEvents } from '@/lib/whatsapp/meta-api'
import {
  processQueue,
  type QueuedEvent,
  type QueueResult,
  type QueueRow,
} from '@/lib/conversions/queue'

/** Meta rejects events older than 7 days. Stay a bit inside the limit. */
export const MAX_EVENT_AGE_SECS = 7 * 24 * 3600 - 3600
export interface LeadOrigin {
  source: AttributionSource
  ctwa_clid: string | null
  fbc: string | null
  fbp: string | null
  landing_url: string | null
}

export type BuildResult =
  | { skip: string }
  | { payload: Record<string, unknown> }

/** SHA-256 of the phone digits, as Meta expects for `ph`. */
export function hashPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '')
  if (digits.length < 8) return null
  return createHash('sha256').update(digits).digest('hex')
}

/**
 * Turns a queued deal event plus the lead's origin into the payload of one
 * Meta Conversions API event, or a reason to skip it.
 *  - Click to WhatsApp lead: business messaging event keyed by ctwa_clid.
 *  - Landing page lead from a Meta ad: website event keyed by fbc/fbp and
 *    the hashed phone.
 *  - Anything else (Google, organic, unknown) is not reported to Meta.
 */
export function buildMetaEvent(
  event: QueuedEvent,
  origin: LeadOrigin | null,
  phone: string | null,
  nowSecs: number,
): BuildResult {
  if (!origin) return { skip: 'Contato sem origem de anúncio' }

  const eventTime = Math.floor(new Date(event.occurred_at).getTime() / 1000)
  if (nowSecs - eventTime > MAX_EVENT_AGE_SECS) {
    return { skip: 'Evento com mais de 7 dias (a Meta recusa)' }
  }

  const base: Record<string, unknown> = {
    event_name: event.event_name,
    event_time: eventTime,
    event_id: event.id,
  }
  if (event.value != null && Number(event.value) > 0) {
    base.custom_data = { value: Number(event.value), currency: event.currency || 'BRL' }
  }

  if (origin.source === 'meta_ctwa') {
    if (!origin.ctwa_clid) return { skip: 'Anúncio sem ctwa_clid' }
    return {
      payload: {
        ...base,
        action_source: 'business_messaging',
        messaging_channel: 'whatsapp',
        user_data: { ctwa_clid: origin.ctwa_clid },
      },
    }
  }

  if (origin.source === 'meta_site') {
    const ph = hashPhone(phone)
    const userData: Record<string, unknown> = {}
    if (origin.fbc) userData.fbc = origin.fbc
    if (origin.fbp) userData.fbp = origin.fbp
    if (ph) userData.ph = [ph]
    if (!userData.fbc && !userData.fbp && !ph) return { skip: 'Sem dados para casar com o anúncio' }
    return {
      payload: {
        ...base,
        action_source: 'website',
        ...(origin.landing_url ? { event_source_url: origin.landing_url } : {}),
        user_data: userData,
      },
    }
  }

  return { skip: 'Origem fora da Meta' }
}

interface MetaAccountSettings {
  dataset: string | null
  enabled: boolean
  test: string | null
  token: string | null
}

/**
 * Sends the due events to Meta, oldest first. Each row is claimed before
 * sending (see `processQueue`), so overlapping runs don't send it twice.
 * Never throws.
 */
export async function processConversionQueue(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<QueueResult> {
  const nowSecs = Math.floor(now.getTime() / 1000)
  const settingsCache = new Map<string, MetaAccountSettings>()

  async function accountSettings(accountId: string): Promise<MetaAccountSettings> {
    const cached = settingsCache.get(accountId)
    if (cached) return cached
    const { data: s } = await db
      .from('conversion_settings')
      .select('meta_dataset_id, meta_enabled, meta_test_code')
      .eq('account_id', accountId)
      .maybeSingle()
    const { data: cfg } = await db
      .from('whatsapp_config')
      .select('access_token')
      .eq('account_id', accountId)
      .limit(1)
      .maybeSingle()
    let token: string | null = null
    try {
      token = cfg?.access_token ? decrypt(cfg.access_token as string) : null
    } catch {
      token = null
    }
    const value: MetaAccountSettings = {
      dataset: (s?.meta_dataset_id as string | null) ?? null,
      enabled: Boolean(s?.meta_enabled),
      test: (s?.meta_test_code as string | null) ?? null,
      token,
    }
    settingsCache.set(accountId, value)
    return value
  }

  return processQueue<QueueRow>(db, now, {
    destination: 'meta',
    columns: 'id, account_id, contact_id, event_name, value, currency, occurred_at, attempts',
    logTag: '[conversions]',
    async process(row) {
      const cfg = await accountSettings(row.account_id)
      if (!cfg.enabled || !cfg.dataset) {
        return { kind: 'skipped', detail: 'Envio à Meta desativado' }
      }
      if (!cfg.token) {
        return { kind: 'skipped', detail: 'WhatsApp sem token para a Meta' }
      }

      let origin: LeadOrigin | null = null
      let phone: string | null = null
      if (row.contact_id) {
        const { data: a } = await db
          .from('lead_attribution')
          .select('source, ctwa_clid, fbc, fbp, landing_url')
          .eq('account_id', row.account_id)
          .eq('contact_id', row.contact_id)
          .maybeSingle()
        origin = (a as LeadOrigin | null) ?? null
        const { data: ct } = await db.from('contacts').select('phone').eq('id', row.contact_id).maybeSingle()
        phone = (ct?.phone as string | null) ?? null
      }

      const built = buildMetaEvent(row, origin, phone, nowSecs)
      if ('skip' in built) return { kind: 'skipped', detail: built.skip }

      await sendCapiEvents({
        datasetId: cfg.dataset,
        accessToken: cfg.token,
        events: [built.payload],
        testEventCode: cfg.test,
      })
      return { kind: 'sent', detail: cfg.test ? 'Enviado como teste' : null }
    },
  })
}
