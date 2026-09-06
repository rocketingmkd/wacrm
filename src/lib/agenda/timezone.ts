// ============================================================
// Zoned wall-clock <-> UTC conversion for the booking engine.
//
// The repo only has `date-fns` (no `date-fns-tz`), and the booking
// engine needs to go both ways between a UTC instant (what
// `deals.scheduled_at` and `Date` actually store) and the wall-clock
// time a person in `aiTimezone()` would read on a clock (what the AI
// prompt and the `[[BOOK: quando=...]]` marker deal in). Both
// directions use the same technique `currentDateTimeLine`
// (src/lib/ai/defaults.ts) already relies on for formatting: ask
// `Intl.DateTimeFormat` what a given instant looks like in a given
// IANA zone.
// ============================================================

interface ZonedParts {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  second: number
}

function getZonedParts(date: Date, tz: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === '24' ? '0' : map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

/** How far a UTC instant's wall-clock reading in `tz` differs from the
 *  instant itself, in ms — i.e. `asUtcMs(wallClockOf(date, tz)) -
 *  date.getTime()`. Negative for zones behind UTC (e.g. -3h for
 *  America/Sao_Paulo). Recomputed per-instant so a DST transition
 *  (irrelevant for Brazil today, not assumed forever) isn't hard-coded. */
function getOffsetMs(date: Date, tz: string): number {
  const p = getZonedParts(date, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - date.getTime()
}

/**
 * The reverse of formatting: given a wall-clock date + "HH:MM" as a
 * person in `tz` would read them, return the UTC instant that
 * produces that reading. Two-pass (re-derives the offset from the
 * first guess) so a DST boundary crossed between the naive guess and
 * the real instant doesn't leave it off by the transition amount.
 */
export function zonedWallTimeToUtc(dateISO: string, timeHHMM: string, tz: string): Date {
  const [year, month, day] = dateISO.split('-').map(Number)
  const [hour, minute] = timeHHMM.split(':').map(Number)
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute)

  const offset1 = getOffsetMs(new Date(naiveUtcMs), tz)
  let candidate = naiveUtcMs - offset1
  const offset2 = getOffsetMs(new Date(candidate), tz)
  if (offset2 !== offset1) candidate = naiveUtcMs - offset2

  return new Date(candidate)
}

/** The inverse: format a UTC instant as the "YYYY-MM-DDTHH:MM" wall-
 *  clock token a person in `tz` would read — the exact shape used by
 *  the `[[BOOK: quando=...]]` marker and `<input type="datetime-local">`
 *  elsewhere in the app (src/components/pipelines/deal-form.tsx). */
export function formatWallTimeToken(date: Date, tz: string): string {
  const p = getZonedParts(date, tz)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

/** The wall-clock calendar date ("YYYY-MM-DD") a person in `tz` is on
 *  right now — the anchor `listFreeSlots` counts forward from. Using
 *  the zoned date (not `date.toISOString().slice(0, 10)`) matters near
 *  midnight: UTC and America/Sao_Paulo disagree on which calendar day
 *  it is for several hours every evening. */
export function zonedDateString(date: Date, tz: string): string {
  const p = getZonedParts(date, tz)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** pt-BR label for a slot, e.g. "quinta-feira, 10/09 às 14:00" — shown
 *  to the model as the human-readable half of each offered slot
 *  (paired with the exact token it must echo back verbatim in
 *  `[[BOOK: quando=...]]`). Built from parts rather than trusting
 *  `Intl`'s own combined punctuation, which drifts across Node/ICU
 *  versions. */
export function formatSlotLabelPtBr(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  return `${map.weekday}, ${map.day}/${map.month} às ${map.hour}:${map.minute}`
}
