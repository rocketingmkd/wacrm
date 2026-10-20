/**
 * Lead attribution: where a WhatsApp contact came from.
 *
 * Two inputs feed it:
 *  - Click to WhatsApp ads: Meta sends a `referral` object on the first
 *    inbound message (ad id, headline, ctwa_clid...).
 *  - Landing pages: the tracking script stores UTMs / gclid / fbclid under
 *    a short code and appends "[#CODE]" to the pre-filled WhatsApp text.
 */

export type AttributionSource = 'meta_ctwa' | 'meta_site' | 'google' | 'other'

export const SOURCE_LABELS: Record<AttributionSource, string> = {
  meta_ctwa: 'Meta (clique no WhatsApp)',
  meta_site: 'Meta (site)',
  google: 'Google Ads',
  other: 'Outras origens',
}

/** Params captured on the landing page. All optional, all untrusted text. */
export interface SessionParams {
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_term?: string | null
  utm_content?: string | null
  gclid?: string | null
  fbclid?: string | null
  fbc?: string | null
  fbp?: string | null
  landing_url?: string | null
  referrer?: string | null
}

/** Meta's Click to WhatsApp referral object (webhook `message.referral`). */
export interface CtwaReferral {
  source_url?: string
  source_id?: string
  source_type?: string
  body?: string
  headline?: string
  media_type?: string
  ctwa_clid?: string
}

const CODE_RE = /\[#([A-Za-z0-9]{6,12})\]/
const META_UTM_SOURCES = new Set(['facebook', 'fb', 'instagram', 'ig', 'meta', 'facebook_ads', 'meta_ads'])
const GOOGLE_UTM_SOURCES = new Set(['google', 'googleads', 'google_ads', 'adwords'])

/** The tracking code the landing page appended to the first message. */
export function extractSessionCode(text: string | null | undefined): string | null {
  if (!text) return null
  const match = CODE_RE.exec(text)
  return match ? match[1].toUpperCase() : null
}

/** Message text without the tracking code, for display and AI replies. */
export function stripSessionCode(text: string): string {
  return text.replace(CODE_RE, '').replace(/[ \t]+$/gm, '').trim()
}

/** Trim and bound a value coming from the browser; empty becomes null. */
export function clean(value: unknown, max = 255): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().slice(0, max)
  return trimmed ? trimmed : null
}

/** Normalises a raw session payload from the public endpoint. */
export function cleanSessionParams(raw: Record<string, unknown>): SessionParams {
  return {
    utm_source: clean(raw.utm_source, 100),
    utm_medium: clean(raw.utm_medium, 100),
    utm_campaign: clean(raw.utm_campaign, 200),
    utm_term: clean(raw.utm_term, 200),
    utm_content: clean(raw.utm_content, 200),
    gclid: clean(raw.gclid, 300),
    fbclid: clean(raw.fbclid, 300),
    fbc: clean(raw.fbc, 300),
    fbp: clean(raw.fbp, 300),
    landing_url: clean(raw.landing_url, 1000),
    referrer: clean(raw.referrer, 1000),
  }
}

/** Which ad platform brought the visitor to the landing page. */
export function classifySession(p: SessionParams): AttributionSource {
  const utm = (p.utm_source ?? '').toLowerCase()
  if (p.gclid || GOOGLE_UTM_SOURCES.has(utm)) return 'google'
  if (p.fbclid || p.fbc || META_UTM_SOURCES.has(utm)) return 'meta_site'
  return 'other'
}

/** A session with nothing useful (direct visit) is not an attribution. */
export function hasSignal(p: SessionParams): boolean {
  return Boolean(
    p.utm_source || p.utm_medium || p.utm_campaign || p.gclid || p.fbclid || p.fbc,
  )
}

/** A referral only counts when it points to an ad or a post. */
export function isCtwaReferral(referral: unknown): referral is CtwaReferral {
  if (!referral || typeof referral !== 'object') return false
  const r = referral as CtwaReferral
  return Boolean(r.ctwa_clid || r.source_id)
}

/** Fields of lead_attribution derived from a Click to WhatsApp referral. */
export function fromReferral(r: CtwaReferral) {
  return {
    source: 'meta_ctwa' as const,
    ctwa_clid: clean(r.ctwa_clid, 300),
    ad_id: clean(r.source_id, 100),
    source_type: clean(r.source_type, 30),
    source_url: clean(r.source_url, 1000),
    headline: clean(r.headline, 300),
    body: clean(r.body, 1000),
  }
}

/** Fields of lead_attribution derived from a landing page session. */
export function fromSession(code: string, p: SessionParams) {
  return {
    source: classifySession(p),
    session_code: code,
    utm_source: p.utm_source ?? null,
    utm_medium: p.utm_medium ?? null,
    utm_campaign: p.utm_campaign ?? null,
    utm_term: p.utm_term ?? null,
    utm_content: p.utm_content ?? null,
    gclid: p.gclid ?? null,
    fbclid: p.fbclid ?? null,
    fbc: p.fbc ?? null,
    fbp: p.fbp ?? null,
    landing_url: p.landing_url ?? null,
  }
}

/** Code format the script generates: 8 chars from an unambiguous alphabet. */
export function isValidSessionCode(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Z0-9]{6,12}$/.test(code)
}
