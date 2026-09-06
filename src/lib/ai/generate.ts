import {
  AiError,
  type AiConfig,
  type AiUsage,
  type BookingRequest,
  type ChatMessage,
  type GenerateResult,
} from './types'
import { HANDOFF_SENTINEL, aiRequestTimeoutMs } from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. Throws `AiError` on any provider/network failure.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, messages } = args
  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
  }

  let result: { text: string; usage: AiUsage | null }
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  return parseGeneration(result.text, result.usage)
}

/** Matches `[[TRANSFER:<slug>]]` — see `buildSystemPrompt`'s
 *  transfer-menu block in defaults.ts. Case-insensitive because models
 *  aren't perfectly consistent about casing; the captured slug is
 *  lower-cased below to match `ai_agents.slug`, which is always stored
 *  lower-case. */
const TRANSFER_SENTINEL_RE = /\[\[TRANSFER:([a-z0-9_-]+)\]\]/i

/** Matches `[[NOTE: … ]]` — the model records internal context for the
 *  human team here (a lead-qualification summary, a support-ticket
 *  recap) instead of putting a recap in the customer-facing reply.
 *  Non-greedy `[\s\S]` so it spans newlines but stops at the first
 *  closing `]]`. Case-insensitive on the label for the same reason as
 *  the other sentinels — models drift on casing. Only the FIRST note
 *  is captured; any stray extra one is still stripped from the reply
 *  text by the global replace below. */
const NOTE_SENTINEL_RE = /\[\[NOTE:\s*([\s\S]*?)\]\]/i

/** Matches `[[BOOK: ...]]` — the scheduling agent's booking request,
 *  taught only when `buildSystemPrompt` receives an `availability`
 *  block (canSchedule agents). Payload is either the bare wall-clock
 *  token (`[[BOOK: 2026-09-10T14:00]]`) or `key=value` pairs separated
 *  by `;` (`quando=...; email=...; assunto=...`) — see
 *  `parseBookingPayload`. Non-greedy for the same reason as the note
 *  sentinel; case-insensitive for the same reason as every other one. */
const BOOK_SENTINEL_RE = /\[\[BOOK:\s*([\s\S]*?)\]\]/i

/** Parse a `[[BOOK: ...]]` payload into a `BookingRequest`, or `null`
 *  when it has no `quando`/date at all (a malformed emission — treated
 *  as "no booking request" rather than throwing, since a bad marker
 *  should degrade to a normal reply, not break the turn). Accepts
 *  either the bare-token form or `key=value; key=value` pairs;
 *  `quando`/`when` is the only required field. */
function parseBookingPayload(raw: string): BookingRequest | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const fields: Record<string, string> = {}
  if (trimmed.includes('=')) {
    for (const part of trimmed.split(';')) {
      const eq = part.indexOf('=')
      if (eq === -1) continue
      const key = part.slice(0, eq).trim().toLowerCase()
      const value = part.slice(eq + 1).trim()
      if (key) fields[key] = value
    }
  } else {
    fields.quando = trimmed
  }

  const whenRaw = fields.quando || fields.when
  if (!whenRaw) return null

  return {
    whenRaw,
    email: fields.email || null,
    subject: fields.assunto || fields.subject || null,
  }
}

/**
 * Split the raw model output into `{ text, handoff, transferToSlug,
 * note, booking, usage }`. Any sentinel can appear alone or trailing a
 * partial reply; either way the marker is stripped from any remaining
 * text. `usage` is passed straight through (null when the provider
 * didn't report it).
 *
 * A model could in principle emit several sentinels in one turn (a
 * malformed response, not a valid instruction — the prompt asks for
 * one control marker plus an optional note). All are parsed
 * defensively; `dispatchInboundToAiReply` decides precedence when
 * routing.
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const transferMatch = raw.match(TRANSFER_SENTINEL_RE)
  const transferToSlug = transferMatch ? transferMatch[1].toLowerCase() : null
  const noteMatch = raw.match(NOTE_SENTINEL_RE)
  const note = noteMatch ? noteMatch[1].trim() || null : null
  const bookMatch = raw.match(BOOK_SENTINEL_RE)
  const booking = bookMatch ? parseBookingPayload(bookMatch[1]) : null
  const text = raw
    .split(HANDOFF_SENTINEL)
    .join('')
    .replace(TRANSFER_SENTINEL_RE, '')
    .replace(new RegExp(NOTE_SENTINEL_RE.source, 'gi'), '')
    .replace(new RegExp(BOOK_SENTINEL_RE.source, 'gi'), '')
    .trim()
  return { text, handoff, transferToSlug, note, booking, usage }
}
