import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendCapiEvents } from '@/lib/whatsapp/meta-api'

/** Meta rejects events older than 7 days. Stay a bit inside the limit. */
export const MAX_EVENT_AGE_SECS = 7 * 24 * 3600 - 3600
export const MAX_ATTEMPTS = 5
const BATCH = 50

export const EVENT_LABELS: Record<string, string> = {
  Lead: 'Lead',
  Contact: 'Contato',
  Schedule: 'Agendamento',
  CompleteRegistration: 'Cadastro completo',
  InitiateCheckout: 'Início de compra',
  Purchase: 'Compra',
}

export interface QueuedEvent {
  id: string
  event_name: string
  value: number | null
  currency: string | null
  occurred_at: string
}

export interface LeadOrigin {
  source: 'meta_ctwa' | 'meta_site' | 'google' | 'other'
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

/** Minutes to wait before retry number `attempts` (2, 4, 8, 16...). */
export function backoffMinutes(attempts: number): number {
  return Math.min(2 ** Math.max(attempts, 1), 240)
}

interface Row extends QueuedEvent {
  account_id: string
  contact_id: string | null
  attempts: number
}

export interface QueueResult {
  processed: number
  sent: number
  skipped: number
  failed: number
}

/**
 * Sends the due events to Meta, oldest first. Safe to run concurrently with
 * itself only through the cron lock; each row is claimed by moving its
 * next_attempt_at forward before sending. Never throws.
 */
export async function processConversionQueue(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<QueueResult> {
  const result: QueueResult = { processed: 0, sent: 0, skipped: 0, failed: 0 }
  const nowIso = now.toISOString()
  const nowSecs = Math.floor(now.getTime() / 1000)

  const { data: rows, error } = await db
    .from('conversion_events')
    .select('id, account_id, contact_id, event_name, value, currency, occurred_at, attempts')
    .eq('destination', 'meta')
    .in('status', ['pending', 'failed'])
    .lt('attempts', MAX_ATTEMPTS)
    .lte('next_attempt_at', nowIso)
    .order('next_attempt_at', { ascending: true })
    .limit(BATCH)
  if (error || !rows) {
    if (error) console.error('[conversions] queue read failed:', error.message)
    return result
  }

  const settingsCache = new Map<string, { dataset: string | null; enabled: boolean; test: string | null; token: string | null }>()

  async function accountSettings(accountId: string) {
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
    const value = {
      dataset: (s?.meta_dataset_id as string | null) ?? null,
      enabled: Boolean(s?.meta_enabled),
      test: (s?.meta_test_code as string | null) ?? null,
      token,
    }
    settingsCache.set(accountId, value)
    return value
  }

  for (const row of rows as Row[]) {
    result.processed += 1
    const finish = (patch: Record<string, unknown>) =>
      db.from('conversion_events').update(patch).eq('id', row.id)

    try {
      // Claim the row so an overlapping run does not send it twice.
      await finish({ next_attempt_at: new Date(now.getTime() + 10 * 60_000).toISOString() })

      const cfg = await accountSettings(row.account_id)
      if (!cfg.enabled || !cfg.dataset) {
        await finish({ status: 'skipped', detail: 'Envio à Meta desativado' })
        result.skipped += 1
        continue
      }
      if (!cfg.token) {
        await finish({ status: 'skipped', detail: 'WhatsApp sem token para a Meta' })
        result.skipped += 1
        continue
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
        const { data: c } = await db.from('contacts').select('phone').eq('id', row.contact_id).maybeSingle()
        phone = (c?.phone as string | null) ?? null
      }

      const built = buildMetaEvent(row, origin, phone, nowSecs)
      if ('skip' in built) {
        await finish({ status: 'skipped', detail: built.skip })
        result.skipped += 1
        continue
      }

      await sendCapiEvents({
        datasetId: cfg.dataset,
        accessToken: cfg.token,
        events: [built.payload],
        testEventCode: cfg.test,
      })
      await finish({
        status: 'sent',
        sent_at: new Date().toISOString(),
        attempts: row.attempts + 1,
        detail: cfg.test ? 'Enviado como teste' : null,
      })
      result.sent += 1
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
      console.error('[conversions] send failed:', message)
    }
  }
  return result
}
