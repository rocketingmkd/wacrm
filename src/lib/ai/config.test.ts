import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// decrypt is identity in tests so we don't depend on real ciphertext.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `plain:${v}`,
}))

import { loadAiAgent, loadReceptionistAgent, loadProviderConfig } from './config'

/** Fake client whose `.from(table)` resolves a different fixed row per
 *  table — agent identity/behaviour now lives in `ai_agents`, the
 *  shared BYO credential in `ai_provider_config` (migration 047). */
function dbWith(rows: {
  agent?: Record<string, unknown> | null
  provider?: Record<string, unknown> | null
}): SupabaseClient {
  const chainFor = (row: Record<string, unknown> | null | undefined) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: row ?? null, error: null }),
    }
    return chain
  }
  return {
    from: (table: string) =>
      table === 'ai_agents' ? chainFor(rows.agent) : chainFor(rows.provider),
  } as unknown as SupabaseClient
}

const AGENT_ROW = {
  id: 'agent-1',
  name: 'Assistente',
  slug: 'assistente',
  description: null,
  is_receptionist: true,
  model: 'gpt-x',
  system_prompt: null,
  is_active: false,
  auto_reply_enabled: false,
  auto_reply_max_per_conversation: 3,
  handoff_agent_id: null,
}

const PROVIDER_ROW = {
  provider: 'openai',
  api_key: 'enc-key',
  embeddings_api_key: null,
}

describe('loadAiAgent requireActive', () => {
  it('returns null for an inactive agent by default', async () => {
    const db = dbWith({ agent: AGENT_ROW, provider: PROVIDER_ROW })
    expect(await loadAiAgent(db, 'acct', 'agent-1')).toBeNull()
  })

  it('returns the agent merged with the shared credential when requireActive is false (Playground path)', async () => {
    const db = dbWith({ agent: AGENT_ROW, provider: PROVIDER_ROW })
    const config = await loadAiAgent(db, 'acct', 'agent-1', { requireActive: false })
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('openai')
    expect(config!.apiKey).toBe('plain:enc-key')
    expect(config!.slug).toBe('assistente')
    expect(config!.isReceptionist).toBe(true)
    expect(config!.model).toBe('gpt-x')
  })

  it('returns null when there is no agent row', async () => {
    const db = dbWith({ agent: null, provider: PROVIDER_ROW })
    expect(await loadAiAgent(db, 'acct', 'agent-1', { requireActive: false })).toBeNull()
  })

  it('returns null when the agent exists but the account has no provider credential yet', async () => {
    const db = dbWith({ agent: AGENT_ROW, provider: null })
    expect(await loadAiAgent(db, 'acct', 'agent-1', { requireActive: false })).toBeNull()
  })
})

describe('loadReceptionistAgent', () => {
  it('returns null for an inactive receptionist by default', async () => {
    const db = dbWith({ agent: AGENT_ROW, provider: PROVIDER_ROW })
    expect(await loadReceptionistAgent(db, 'acct')).toBeNull()
  })

  it('returns the receptionist merged with the shared credential when requireActive is false', async () => {
    const db = dbWith({ agent: AGENT_ROW, provider: PROVIDER_ROW })
    const config = await loadReceptionistAgent(db, 'acct', { requireActive: false })
    expect(config).not.toBeNull()
    expect(config!.isReceptionist).toBe(true)
    expect(config!.apiKey).toBe('plain:enc-key')
  })

  it('returns null when the account has no receptionist yet', async () => {
    const db = dbWith({ agent: null, provider: PROVIDER_ROW })
    expect(await loadReceptionistAgent(db, 'acct', { requireActive: false })).toBeNull()
  })
})

describe('loadProviderConfig', () => {
  it('returns null when the account has not configured a credential', async () => {
    const db = dbWith({ provider: null })
    expect(await loadProviderConfig(db, 'acct')).toBeNull()
  })

  it('decrypts the chat key and leaves embeddingsApiKey null when unset', async () => {
    const db = dbWith({ provider: PROVIDER_ROW })
    const credential = await loadProviderConfig(db, 'acct')
    expect(credential).toEqual({ provider: 'openai', apiKey: 'plain:enc-key', embeddingsApiKey: null })
  })

  it('decrypts the embeddings key when present', async () => {
    const db = dbWith({
      provider: { ...PROVIDER_ROW, embeddings_api_key: 'enc-emb' },
    })
    const credential = await loadProviderConfig(db, 'acct')
    expect(credential?.embeddingsApiKey).toBe('plain:enc-emb')
  })
})
