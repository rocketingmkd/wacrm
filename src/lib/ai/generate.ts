import {
  AiError,
  type AiConfig,
  type AiUsage,
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

/**
 * Split the raw model output into `{ text, handoff, transferToSlug,
 * usage }`. Either sentinel can appear alone or trailing a partial
 * reply; either way the marker is stripped from any remaining text.
 * `usage` is passed straight through (null when the provider didn't
 * report it).
 *
 * A model could in principle emit both sentinels in one turn (a
 * malformed response, not a valid instruction — the prompt only ever
 * asks for one or the other). Both are still parsed defensively;
 * `dispatchInboundToAiReply` decides precedence when routing.
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const transferMatch = raw.match(TRANSFER_SENTINEL_RE)
  const transferToSlug = transferMatch ? transferMatch[1].toLowerCase() : null
  const text = raw
    .split(HANDOFF_SENTINEL)
    .join('')
    .replace(TRANSFER_SENTINEL_RE, '')
    .trim()
  return { text, handoff, transferToSlug, usage }
}
