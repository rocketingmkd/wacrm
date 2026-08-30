// ============================================================
// Agent slug helpers. The slug is the LLM-facing identifier used in
// the `[[TRANSFER:<slug>]]` sentinel (see generate.ts) and must stay
// stable, lower-case, and DB-safe — it's matched against
// `ai_agents.slug` (UNIQUE(account_id, slug)).
// ============================================================

/** Matches the DB column's expectations: lower-case letters, digits,
 *  underscore, hyphen. Mirrors the transfer-sentinel regex in
 *  generate.ts so a slug that passes this always parses back out. */
const SLUG_RE = /^[a-z0-9_-]+$/

export function isValidAgentSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 60 && SLUG_RE.test(value)
}

// Combining Diacritical Marks block (U+0300-U+036F) — what NFD
// normalization splits accents into. Built from char codes (not a
// regex literal containing the actual combining characters) so it
// can't get silently mangled by editor/encoding round-trips.
const COMBINING_MARKS_RE = new RegExp(
  `[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`,
  'g',
)

/**
 * Derive a slug from a display name — lower-case, accents stripped,
 * anything outside [a-z0-9] collapsed to a single hyphen, trimmed.
 * Falls back to "agente" for a name with no latinizable characters
 * (e.g. all-emoji) so callers never get an empty string.
 */
export function slugifyAgentName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(COMBINING_MARKS_RE, '') // strip combining accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'agente'
}
