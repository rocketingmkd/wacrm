import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttributionSource } from './attribution'

/**
 * Origin by phrase: a rule maps a phrase typed in the customer's first
 * message (usually pre-filled by the client's site) to a source and a
 * campaign name. Matching ignores case, accents and repeated spaces.
 * Rules only ever fill contacts WITHOUT attribution: first touch wins.
 */

export const SOURCES: readonly AttributionSource[] = ['meta_ctwa', 'meta_site', 'google', 'other']
export const PHRASE_MIN = 3
export const PHRASE_MAX = 200
export const LABEL_MAX = 255
/** Customer messages read per search. Keeps one dry run bounded. */
export const SCAN_LIMIT = 5000
const WRITE_CHUNK = 200
const LOOKUP_CHUNK = 200

export interface PhraseRule {
  id: string
  phrase: string
  source: AttributionSource
  label: string
}

export interface PhraseMatch {
  contactId: string
  conversationId: string
  name: string | null
  phone: string | null
  /** Message text that matched, cut to a short excerpt. */
  excerpt: string
  /** When the first matching message was sent. */
  matchedAt: string
}

/** Lowercase, strip accents, collapse whitespace. */
export function normalizeText(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** True when `message` contains `phrase` (normalized). A phrase shorter
 *  than PHRASE_MIN never matches, so a blank rule can't tag everyone. */
export function matchesPhrase(message: string | null | undefined, phrase: string): boolean {
  const needle = normalizeText(phrase)
  if (needle.length < PHRASE_MIN) return false
  return normalizeText(message).includes(needle)
}

/** The rule that applies to a message, or null. The longest (most
 *  specific) matching phrase wins; ties keep the order given. */
export function pickRule<T extends { phrase: string }>(
  rules: readonly T[],
  message: string | null | undefined,
): T | null {
  let best: T | null = null
  let bestLen = 0
  for (const rule of rules) {
    if (!matchesPhrase(message, rule.phrase)) continue
    const len = normalizeText(rule.phrase).length
    if (len > bestLen) {
      best = rule
      bestLen = len
    }
  }
  return best
}

/**
 * SQL ILIKE pattern that is a superset of `matchesPhrase`: letters that
 * can carry an accent become `_` (any one character) and spaces become
 * `%`. The exact check is then redone in JS with `matchesPhrase`.
 */
export function ilikePattern(phrase: string): string {
  const body = normalizeText(phrase)
    .replace(/[\\%_]/g, (c) => `\\${c}`)
    .replace(/[aeioucn]/g, '_')
    .replace(/ /g, '%')
  return `%${body}%`
}

/** Short excerpt around the match, for the preview table. */
export function excerptAround(text: string, phrase: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const idx = normalizeText(flat).indexOf(normalizeText(phrase))
  // Normalizing can shift offsets, so this only chooses where to cut.
  const start = Math.max(0, Math.min(idx < 0 ? 0 : idx - 20, flat.length - max))
  return `${start > 0 ? '…' : ''}${flat.slice(start, start + max)}${start + max < flat.length ? '…' : ''}`
}

export interface PhraseMessageRow {
  created_at: string
  content_text: string | null
  conversation: {
    id: string
    contact_id: string
    contact: { name: string | null; phone: string | null; is_group: boolean | null } | null
  } | null
}

/**
 * Pure step: from customer messages (oldest first) keep one match per
 * contact, the earliest, and drop contacts that already have an
 * attribution. Groups are skipped.
 */
export function selectUnattributed(
  rows: readonly PhraseMessageRow[],
  phrase: string,
  attributedContactIds: ReadonlySet<string>,
): PhraseMatch[] {
  const seen = new Set<string>()
  const out: PhraseMatch[] = []
  for (const row of rows) {
    const conv = row.conversation
    if (!conv || !row.content_text) continue
    if (conv.contact?.is_group) continue
    if (seen.has(conv.contact_id)) continue
    if (!matchesPhrase(row.content_text, phrase)) continue
    seen.add(conv.contact_id)
    if (attributedContactIds.has(conv.contact_id)) continue
    out.push({
      contactId: conv.contact_id,
      conversationId: conv.id,
      name: conv.contact?.name ?? null,
      phone: conv.contact?.phone ?? null,
      excerpt: excerptAround(row.content_text, phrase),
      matchedAt: row.created_at,
    })
  }
  return out
}

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

/**
 * Dry run: contacts of the account WITHOUT lead_attribution whose
 * customer messages contain `phrase`. Reads only; writes nothing.
 * `truncated` is true when the message scan hit SCAN_LIMIT.
 */
export async function findPhraseMatches(
  db: SupabaseClient,
  accountId: string,
  phrase: string,
): Promise<{ matches: PhraseMatch[]; truncated: boolean }> {
  const { data, error } = await db
    .from('messages')
    .select(
      'created_at, content_text, conversation:conversations!inner(id, contact_id, account_id, contact:contacts(name, phone, is_group))',
    )
    .eq('conversation.account_id', accountId)
    .eq('sender_type', 'customer')
    .eq('content_type', 'text')
    .ilike('content_text', ilikePattern(phrase))
    .order('created_at', { ascending: true })
    .limit(SCAN_LIMIT)
  if (error) throw error

  const raw = (data ?? []) as unknown as {
    created_at: string
    content_text: string | null
    conversation: unknown
  }[]
  const rows: PhraseMessageRow[] = raw.map((r) => {
    const conv = one(r.conversation as Record<string, unknown> | Record<string, unknown>[] | null)
    return {
      created_at: r.created_at,
      content_text: r.content_text,
      conversation: conv
        ? ({
            id: conv.id,
            contact_id: conv.contact_id,
            contact: one(conv.contact as never),
          } as PhraseMessageRow['conversation'])
        : null,
    }
  })

  const candidates = selectUnattributed(rows, phrase, new Set())
  const attributed = new Set<string>()
  for (let i = 0; i < candidates.length; i += LOOKUP_CHUNK) {
    const ids = candidates.slice(i, i + LOOKUP_CHUNK).map((m) => m.contactId)
    const { data: have, error: haveErr } = await db
      .from('lead_attribution')
      .select('contact_id')
      .eq('account_id', accountId)
      .in('contact_id', ids)
    if (haveErr) throw haveErr
    for (const r of (have ?? []) as { contact_id: string }[]) attributed.add(r.contact_id)
  }

  return {
    matches: candidates.filter((m) => !attributed.has(m.contactId)),
    truncated: rows.length >= SCAN_LIMIT,
  }
}

/** The lead_attribution row a rule writes. Pure. */
export function buildAttributionRow(
  accountId: string,
  rule: Pick<PhraseRule, 'source' | 'label'>,
  match: Pick<PhraseMatch, 'contactId' | 'conversationId' | 'matchedAt'>,
) {
  return {
    account_id: accountId,
    contact_id: match.contactId,
    conversation_id: match.conversationId,
    source: rule.source,
    utm_campaign: rule.label,
    session_code: null,
    first_seen_at: match.matchedAt,
  }
}

/**
 * Writes lead_attribution for the given matches. `ON CONFLICT DO
 * NOTHING` on (account_id, contact_id): a contact that got an
 * attribution meanwhile is left alone. Returns how many rows were
 * really inserted. Needs the service role (no INSERT policy).
 */
export async function applyPhraseMatches(
  db: SupabaseClient,
  accountId: string,
  rule: Pick<PhraseRule, 'source' | 'label'>,
  matches: readonly PhraseMatch[],
): Promise<number> {
  let written = 0
  for (let i = 0; i < matches.length; i += WRITE_CHUNK) {
    const rows = matches.slice(i, i + WRITE_CHUNK).map((m) => buildAttributionRow(accountId, rule, m))
    const { data, error } = await db
      .from('lead_attribution')
      .upsert(rows, { onConflict: 'account_id,contact_id', ignoreDuplicates: true })
      .select('contact_id')
    if (error) throw error
    written += (data ?? []).length
  }
  return written
}

/**
 * Validates the body of a "create rule" request. Returns the clean
 * values or a pt-BR error message. Pure.
 */
export function parseRuleInput(
  body: unknown,
):
  | { ok: true; value: { phrase: string; source: AttributionSource; label: string } }
  | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const phrase = typeof b.phrase === 'string' ? b.phrase.replace(/\s+/g, ' ').trim() : ''
  const label = typeof b.label === 'string' ? b.label.replace(/\s+/g, ' ').trim() : ''
  const source = b.source as AttributionSource
  if (phrase.length < PHRASE_MIN || phrase.length > PHRASE_MAX) {
    return { ok: false, error: `A frase precisa ter entre ${PHRASE_MIN} e ${PHRASE_MAX} caracteres.` }
  }
  if (!SOURCES.includes(source)) return { ok: false, error: 'Origem inválida.' }
  if (label.length < 1 || label.length > LABEL_MAX) {
    return { ok: false, error: `O nome da campanha precisa ter entre 1 e ${LABEL_MAX} caracteres.` }
  }
  return { ok: true, value: { phrase, source, label } }
}

/** Active rules of an account, for the webhook. One indexed query. */
export async function loadActiveRules(db: SupabaseClient, accountId: string): Promise<PhraseRule[]> {
  const { data, error } = await db
    .from('attribution_phrase_rules')
    .select('id, phrase, source, label')
    .eq('account_id', accountId)
    .eq('active', true)
  if (error) throw error
  return Array.isArray(data) ? (data as PhraseRule[]) : []
}
