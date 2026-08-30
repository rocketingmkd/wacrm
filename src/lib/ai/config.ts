import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { AiAgentSummary, AiConfig } from './types'

interface AiAgentRow {
  id: string
  name: string
  slug: string
  description: string | null
  is_receptionist: boolean
  provider: 'openai' | 'anthropic'
  model: string
  api_key: string
  system_prompt: string | null
  is_active: boolean
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  handoff_agent_id: string | null
  embeddings_api_key: string | null
}

const AGENT_COLUMNS =
  'id, name, slug, description, is_receptionist, provider, model, api_key, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, embeddings_api_key'

const SUMMARY_COLUMNS =
  'id, name, slug, description, is_receptionist, is_active, auto_reply_enabled'

/**
 * Decrypt one `ai_agents` row into the shape callers use. Shared by
 * every loader below so the "requireActive" / "missing key" rules stay
 * in exactly one place.
 */
function decryptRow(accountId: string, row: AiAgentRow): AiConfig {
  // The embeddings key is optional and independent of the chat key —
  // a corrupt/undecryptable one should downgrade to lexical KB, not
  // take down draft/auto-reply, so decrypt failures are swallowed here.
  let embeddingsApiKey: string | null = null
  if (row.embeddings_api_key) {
    try {
      embeddingsApiKey = decrypt(row.embeddings_api_key)
    } catch {
      console.error(
        `[ai config] embeddings key for agent ${row.id} (account ${accountId}) could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`,
      )
      embeddingsApiKey = null
    }
  }

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    isReceptionist: row.is_receptionist,
    provider: row.provider,
    model: row.model,
    apiKey: decrypt(row.api_key),
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    handoffAgentId: row.handoff_agent_id,
    embeddingsApiKey,
  }
}

/**
 * Load and decrypt one agent by id, scoped to the account (so a
 * cross-account id never resolves). Returns `null` when there's no
 * matching row or the master switch (`is_active`) is off — both mean
 * "this agent is not available", which callers treat identically.
 * Throws only if the stored key can't be decrypted (mismatched
 * `ENCRYPTION_KEY`), so that distinct failure surfaces rather than
 * looking like "not configured".
 *
 * Works with any client: pass the RLS-scoped SSR client from a
 * dashboard route, or the service-role admin client from the webhook.
 */
export async function loadAiAgent(
  db: SupabaseClient,
  accountId: string,
  agentId: string,
  opts: { requireActive?: boolean } = {},
): Promise<AiConfig | null> {
  const { requireActive = true } = opts
  const { data, error } = await db
    .from('ai_agents')
    .select(AGENT_COLUMNS)
    .eq('account_id', accountId)
    .eq('id', agentId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as AiAgentRow
  // The Playground passes requireActive:false so an admin can test the
  // agent before flipping the master switch on.
  if (requireActive && !row.is_active) return null
  // Defensive: the column is NOT NULL, but a partial write / manual DB
  // edit could leave it empty. Treat a missing key as "not configured"
  // rather than letting decrypt() throw on null.
  if (!row.api_key) return null

  return decryptRow(accountId, row)
}

/**
 * Load the account's fixed entry-point agent — every new conversation
 * starts here (no rule-based routing, see the multi-agent plan). Same
 * null/requireActive semantics as `loadAiAgent`.
 */
export async function loadReceptionistAgent(
  db: SupabaseClient,
  accountId: string,
  opts: { requireActive?: boolean } = {},
): Promise<AiConfig | null> {
  const { requireActive = true } = opts
  const { data, error } = await db
    .from('ai_agents')
    .select(AGENT_COLUMNS)
    .eq('account_id', accountId)
    .eq('is_receptionist', true)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as AiAgentRow
  if (requireActive && !row.is_active) return null
  if (!row.api_key) return null

  return decryptRow(accountId, row)
}

/**
 * Resolve "the agent handling this conversation right now": the pinned
 * `conversations.active_ai_agent_id` when it still resolves to a live
 * agent, else the account's receptionist. Shared by the auto-reply
 * dispatcher and the manual "draft with AI" route so both pick the
 * exact same agent for a given conversation.
 */
export async function resolveAgentForConversation(
  db: SupabaseClient,
  accountId: string,
  activeAgentId: string | null,
  opts: { requireActive?: boolean } = {},
): Promise<AiConfig | null> {
  if (activeAgentId) {
    const pinned = await loadAiAgent(db, accountId, activeAgentId, opts)
    if (pinned) return pinned
  }
  return loadReceptionistAgent(db, accountId, opts)
}

/**
 * List every agent on the account (lightweight — no API key), for the
 * settings roster, the transfer-menu prompt block, and the playground
 * / inbox agent pickers. Receptionist first, then alphabetical.
 */
export async function listAiAgents(
  db: SupabaseClient,
  accountId: string,
): Promise<AiAgentSummary[]> {
  const { data, error } = await db
    .from('ai_agents')
    .select(SUMMARY_COLUMNS)
    .eq('account_id', accountId)
    .order('is_receptionist', { ascending: false })
    .order('name', { ascending: true })

  if (error) throw error
  return ((data ?? []) as {
    id: string
    name: string
    slug: string
    description: string | null
    is_receptionist: boolean
    is_active: boolean
    auto_reply_enabled: boolean
  }[]).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    isReceptionist: row.is_receptionist,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
  }))
}

/**
 * Load + decrypt just one agent's embeddings key, independent of
 * `is_active`. Used by the knowledge-base ingest routes so the KB gets
 * embedded (and semantic search works) whenever an embeddings key is
 * present, even if the agent's master switch is currently off.
 *
 * Returns `{ key, corrupt }`: `key` is null when there's no key OR it
 * can't be decrypted; `corrupt` distinguishes those cases so callers can
 * warn ("a key is set but unusable") rather than silently indexing
 * lexical-only and reporting success.
 */
export async function loadEmbeddingsKey(
  db: SupabaseClient,
  accountId: string,
  agentId: string,
): Promise<{ key: string | null; corrupt: boolean }> {
  const { data, error } = await db
    .from('ai_agents')
    .select('embeddings_api_key')
    .eq('account_id', accountId)
    .eq('id', agentId)
    .maybeSingle()
  if (error || !data?.embeddings_api_key) return { key: null, corrupt: false }
  try {
    return { key: decrypt(data.embeddings_api_key), corrupt: false }
  } catch {
    console.error(
      `[ai config] embeddings key for agent ${agentId} (account ${accountId}) could not be decrypted — check ENCRYPTION_KEY.`,
    )
    return { key: null, corrupt: true }
  }
}
