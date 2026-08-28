// ============================================================
// Response-timing flags for the Gerente IA panel.
//
// Pure functions over the messages the inbox already has in memory —
// no AI, no network, always live. The panel turns these into the
// "cliente esperando há 12 min" / "sua 1ª resposta demorou 45 min"
// lines.
// ============================================================

interface TimingMessage {
  sender_type: 'customer' | 'agent' | 'bot' | string
  created_at: string
}

export interface ResponseTiming {
  /**
   * How long the customer has been waiting for a reply RIGHT NOW —
   * set only when the most recent message in the thread is theirs.
   * null when the business has already replied to the latest message.
   */
  awaitingReplyMs: number | null
  /**
   * Time between the customer's first-ever message and the first
   * business reply after it. null when the business has never replied.
   */
  firstResponseMs: number | null
}

const isCustomer = (m: TimingMessage) => m.sender_type === 'customer'
const isBusiness = (m: TimingMessage) =>
  m.sender_type === 'agent' || m.sender_type === 'bot'

/**
 * @param messages any order — sorted here by `created_at` ascending.
 */
export function computeResponseTiming(
  messages: TimingMessage[],
  now: number = Date.now(),
): ResponseTiming {
  const sorted = [...messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  let awaitingReplyMs: number | null = null
  const last = sorted[sorted.length - 1]
  if (last && isCustomer(last)) {
    // Walk back to the start of the current unanswered customer burst.
    let i = sorted.length - 1
    while (i > 0 && isCustomer(sorted[i - 1])) i--
    awaitingReplyMs = Math.max(0, now - new Date(sorted[i].created_at).getTime())
  }

  let firstResponseMs: number | null = null
  const firstCustomer = sorted.find(isCustomer)
  if (firstCustomer) {
    const firstCustomerAt = new Date(firstCustomer.created_at).getTime()
    const firstReply = sorted.find(
      (m) => isBusiness(m) && new Date(m.created_at).getTime() >= firstCustomerAt,
    )
    if (firstReply) {
      firstResponseMs = Math.max(
        0,
        new Date(firstReply.created_at).getTime() - firstCustomerAt,
      )
    }
  }

  return { awaitingReplyMs, firstResponseMs }
}

/**
 * Compact pt-BR duration: "45 s", "12 min", "1 h 5 min", "2 dias".
 * Rounds to the two most significant units.
 */
export function formatDurationPtBr(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) {
    const rm = m % 60
    return rm ? `${h} h ${rm} min` : `${h} h`
  }
  const d = Math.floor(h / 24)
  const rh = h % 24
  const dLabel = d === 1 ? 'dia' : 'dias'
  return rh ? `${d} ${dLabel} ${rh} h` : `${d} ${dLabel}`
}

/** Waiting longer than this reads as a problem, not just "in progress". */
export const AWAITING_REPLY_WARN_MS = 15 * 60_000
/** A first response slower than this is worth flagging in the panel. */
export const SLOW_FIRST_RESPONSE_MS = 10 * 60_000
