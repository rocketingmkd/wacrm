import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// decrypt is identity in tests so we don't depend on real ciphertext.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `plain:${v}`,
}))

import { loadAiAgent, loadReceptionistAgent } from './config'

function dbReturning(row: Record<string, unknown> | null): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  }
  return chain as unknown as SupabaseClient
}

const ROW = {
  id: 'agent-1',
  name: 'Assistente',
  slug: 'assistente',
  description: null,
  is_receptionist: true,
  provider: 'openai',
  model: 'gpt-x',
  api_key: 'enc-key',
  system_prompt: null,
  is_active: false,
  auto_reply_enabled: false,
  auto_reply_max_per_conversation: 3,
  handoff_agent_id: null,
  embeddings_api_key: null,
}

describe('loadAiAgent requireActive', () => {
  it('returns null for an inactive agent by default', async () => {
    expect(await loadAiAgent(dbReturning(ROW), 'acct', 'agent-1')).toBeNull()
  })

  it('returns the agent when requireActive is false (Playground path)', async () => {
    const config = await loadAiAgent(dbReturning(ROW), 'acct', 'agent-1', {
      requireActive: false,
    })
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('openai')
    expect(config!.apiKey).toBe('plain:enc-key')
    expect(config!.slug).toBe('assistente')
    expect(config!.isReceptionist).toBe(true)
  })

  it('returns null when there is no row', async () => {
    expect(
      await loadAiAgent(dbReturning(null), 'acct', 'agent-1', {
        requireActive: false,
      }),
    ).toBeNull()
  })
})

describe('loadReceptionistAgent', () => {
  it('returns null for an inactive receptionist by default', async () => {
    expect(await loadReceptionistAgent(dbReturning(ROW), 'acct')).toBeNull()
  })

  it('returns the receptionist when requireActive is false', async () => {
    const config = await loadReceptionistAgent(dbReturning(ROW), 'acct', {
      requireActive: false,
    })
    expect(config).not.toBeNull()
    expect(config!.isReceptionist).toBe(true)
  })

  it('returns null when the account has no receptionist yet', async () => {
    expect(
      await loadReceptionistAgent(dbReturning(null), 'acct', {
        requireActive: false,
      }),
    ).toBeNull()
  })
})
