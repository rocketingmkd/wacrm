// ============================================================
// Shared types for the AI reply assistant (bring-your-own-key).
//
// One small provider-agnostic surface so the inbox draft route and the
// inbound auto-reply bot both talk to `generateReply` without caring
// whether the account is on OpenAI or Anthropic.
// ============================================================

export type AiProvider = 'openai' | 'anthropic'

/**
 * One AI agent's setup, decrypted and ready to use. Produced by
 * `loadAiAgent` / `loadReceptionistAgent` (src/lib/ai/config.ts) —
 * `apiKey` is the plaintext BYO provider key (stored AES-256-GCM-
 * encrypted at rest). An account can have several of these (table
 * `ai_agents`, migration 044 — evolved from the old singular
 * `ai_configs`); `dispatchInboundToAiReply` resolves which one is
 * "on duty" for a given conversation before loading it.
 */
export interface AiConfig {
  /** ai_agents.id — needed for transfer-target lookups and usage logging. */
  id: string
  /** Display name, e.g. "Suporte". */
  name: string
  /** Stable, LLM-facing identifier used in the `[[TRANSFER:<slug>]]`
   *  sentinel — see src/lib/ai/generate.ts. Unique per account. */
  slug: string
  /** One-line description shown to OTHER agents in the transfer-menu
   *  prompt block, and in the agents list UI. */
  description: string | null
  /** True for the account's single fixed entry point — every new
   *  conversation starts here (no rule-based routing). Exactly one
   *  per account, enforced by a partial unique index. */
  isReceptionist: boolean
  provider: AiProvider
  model: string
  apiKey: string
  systemPrompt: string | null
  isActive: boolean
  autoReplyEnabled: boolean
  /** Max AI replies per conversation before the bot stands down to a
   *  human. `null` = no limit — it keeps answering until it transfers
   *  or a human takes the thread over. */
  autoReplyMaxPerConversation: number | null
  /** Where THIS agent hands a conversation off when it bails: a
   *  human's `auth.users.id`, or null to leave it unassigned (drop
   *  into the shared queue). Each agent can point at a different
   *  human queue (e.g. Suporte → support queue, Vendas → sales queue). */
  handoffAgentId: string | null
  /** Optional OpenAI-compatible key for embeddings. When set, the
   *  knowledge base is embedded and semantic retrieval turns on; when
   *  null, retrieval falls back to lexical full-text search. */
  embeddingsApiKey: string | null
}

/** Lightweight agent info for the transfer-menu prompt block and
 *  simple listings — deliberately excludes the API key. */
export interface AiAgentSummary {
  id: string
  name: string
  slug: string
  description: string | null
  isReceptionist: boolean
  isActive: boolean
  autoReplyEnabled: boolean
  /** `null` = no per-conversation reply limit. */
  autoReplyMaxPerConversation: number | null
}

/** A single conversation turn in the shape both providers accept. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Token counts for one provider call, normalized across OpenAI
 * (`prompt`/`completion`) and Anthropic (`input`/`output`). Null when
 * the provider didn't return usage. Logged to `ai_usage_log`.
 */
export interface AiUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** Raw text + usage a provider adapter returns before handoff parsing. */
export interface ProviderResult {
  text: string
  usage: AiUsage | null
}

/** Outcome of a generation call. */
export interface GenerateResult {
  /** The reply text, with any handoff/transfer sentinel stripped. */
  text: string
  /** True when the model asked to hand off to a human (auto-reply mode). */
  handoff: boolean
  /** The target agent's slug when the model asked to transfer to
   *  another AI agent (`[[TRANSFER:<slug>]]`), else null. Auto-reply
   *  mode only — see buildSystemPrompt's transfer-menu block. */
  transferToSlug: string | null
  /** Provider token usage for this call, or null when unavailable. */
  usage: AiUsage | null
}

/**
 * Typed error for every AI failure mode. `status` maps cleanly to an
 * HTTP response in the draft route; `code` lets the UI/tests branch
 * (invalid_key vs rate_limited vs timeout, etc.).
 */
export class AiError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'AiError'
    this.code = opts.code ?? 'ai_error'
    this.status = opts.status ?? 502
  }
}
