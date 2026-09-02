import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiAgent: vi.fn(),
  loadReceptionistAgent: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  notifyHandoffToTeam: vi.fn(),
  syncDealToAiStage: vi.fn(),
  moveFunnelDealToHumanStage: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    siblings: [] as { id: string; slug: string; name: string; description: string | null }[],
    claim: true as boolean,
    conversationUpdates: [] as Record<string, unknown>[],
    rpcCalls: [] as { name: string; args: unknown }[],
    writeLocked: false as boolean,
    // Rows the conditional "flip to capped" UPDATE reports back — empty
    // simulates "another path already stood the thread down".
    capFlipRows: [{ id: 'conv-1' }] as { id: string }[],
  },
}))

// The billing write-lock check is a separate concern from this
// file's eligibility-gate tests — mock it directly (not via the
// generic `rpc` mock below, which is reserved for claim_ai_reply_slot)
// so it doesn't interfere with the rpcCalls assertions.
vi.mock('@/lib/billing/write-lock', () => ({
  isAccountWriteLocked: async () => h.state.writeLocked,
}))

vi.mock('./config', () => ({
  loadAiAgent: h.loadAiAgent,
  loadReceptionistAgent: h.loadReceptionistAgent,
}))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.engineSendText }))
vi.mock('./handoff-notify', () => ({ notifyHandoffToTeam: h.notifyHandoffToTeam }))
vi.mock('./kanban-sync', () => ({
  syncDealToAiStage: h.syncDealToAiStage,
  moveFunnelDealToHumanStage: h.moveFunnelDealToHumanStage,
}))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automations') {
        // .select().eq().eq().in().limit() → active auto-responders
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.autoResponders, error: null }),
        }
        return chain
      }
      if (table === 'ai_agents') {
        // loadTransferSiblings: .select().eq().eq().eq().neq()
        const chain = {
          select: () => chain,
          eq: () => chain,
          neq: () => Promise.resolve({ data: h.state.siblings, error: null }),
        }
        return chain
      }
      // conversations
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: h.state.conv, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          h.state.conversationUpdates.push(payload)
          // Chainable + awaitable: supports both `.update().eq()` (handoff)
          // and `.update().eq().eq().select()` (the conditional cap flip).
          const chain: Record<string, unknown> = {
            eq: () => chain,
            select: () =>
              Promise.resolve({ data: h.state.capFlipRows, error: null }),
            then: (
              onFulfilled: (v: { error: null }) => unknown,
              onRejected?: (e: unknown) => unknown,
            ) => Promise.resolve({ error: null }).then(onFulfilled, onRejected),
          }
          return chain
        },
      }
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: h.state.claim, error: null })
    },
  }),
}))

import { dispatchInboundToAiReply } from './auto-reply'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    id: 'agent-1',
    name: 'Assistente',
    slug: 'assistente',
    description: null,
    isReceptionist: true,
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

beforeEach(() => {
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
    active_ai_agent_id: null,
  }
  h.state.autoResponders = []
  h.state.siblings = []
  h.state.claim = true
  h.state.conversationUpdates = []
  h.state.rpcCalls = []
  h.state.writeLocked = false
  h.state.capFlipRows = [{ id: 'conv-1' }]
  h.loadAiAgent.mockReset()
  h.loadReceptionistAgent.mockReset()
  h.notifyHandoffToTeam.mockReset()
  h.syncDealToAiStage.mockReset()
  h.moveFunnelDealToHumanStage.mockReset()
  h.loadReceptionistAgent.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.retrieveKnowledge.mockResolvedValue([])
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false, transferToSlug: null })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path (receptionist, no active_ai_agent_id)', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.loadReceptionistAgent).toHaveBeenCalledWith(expect.anything(), 'acct-1')
    expect(h.loadAiAgent).not.toHaveBeenCalled()
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
  })

  it('loads the conversation-pinned agent when active_ai_agent_id is set', async () => {
    h.state.conv = { ...h.state.conv, active_ai_agent_id: 'agent-9' }
    h.loadAiAgent.mockResolvedValue(aiConfig({ id: 'agent-9', name: 'Suporte', slug: 'suporte' }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.loadAiAgent).toHaveBeenCalledWith(expect.anything(), 'acct-1', 'agent-9')
    expect(h.loadReceptionistAgent).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalled()
  })

  it('replies via the pinned agent even when its own auto-reply flag is off', async () => {
    // A conversation explicitly pinned (transfer, or the activate_ai_agent
    // step) must keep talking to that agent regardless of the account's
    // blanket "pick up any new conversation" toggle on that agent — the
    // two are meant to be independent (see the doc comment on
    // dispatchInboundToAiReply).
    h.state.conv = { ...h.state.conv, active_ai_agent_id: 'agent-9' }
    h.loadAiAgent.mockResolvedValue(
      aiConfig({ id: 'agent-9', name: 'Suporte', slug: 'suporte', autoReplyEnabled: false }),
    )
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalled()
  })

  it('falls back to the receptionist when the pinned agent no longer resolves', async () => {
    h.state.conv = { ...h.state.conv, active_ai_agent_id: 'agent-deleted' }
    h.loadAiAgent.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.loadReceptionistAgent).toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalled()
  })

  it('skips silently when there is no receptionist and no pinned agent (AI never configured)', async () => {
    h.loadReceptionistAgent.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'agent-1',
      expect.anything(),
      'hi',
    )
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
  })

  it('stands down when an active message-level automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when AI is off / not configured', async () => {
    h.loadReceptionistAgent.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when the account is billing write-locked, before even loading an agent', async () => {
    h.state.writeLocked = true
    await dispatchInboundToAiReply(ARGS)
    expect(h.loadReceptionistAgent).not.toHaveBeenCalled()
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the resolved agent', async () => {
    h.loadReceptionistAgent.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when a human agent is assigned', async () => {
    h.state.conv = { ...h.state.conv, assigned_agent_id: 'agent-9' }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = { ...h.state.conv, ai_autoreply_disabled: true }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('stands down visibly when the per-conversation cap is already reached', async () => {
    h.state.conv = { ...h.state.conv, ai_reply_count: 3 }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    // Not a silent return any more: pause the bot, leave a note, tell the
    // team, move the pipeline card.
    const update = h.state.conversationUpdates[0]
    expect(update).toMatchObject({ ai_autoreply_disabled: true })
    expect(update.ai_handoff_summary).toContain('limite de 3')
    expect(h.notifyHandoffToTeam).toHaveBeenCalledOnce()
    expect(h.moveFunnelDealToHumanStage).toHaveBeenCalledOnce()
  })

  it('does not re-notify when another path already stood the thread down', async () => {
    h.state.conv = { ...h.state.conv, ai_reply_count: 3 }
    h.state.capFlipRows = [] // conditional flip affected no row
    await dispatchInboundToAiReply(ARGS)
    expect(h.notifyHandoffToTeam).not.toHaveBeenCalled()
    expect(h.moveFunnelDealToHumanStage).not.toHaveBeenCalled()
  })

  it('stands down right after sending the last reply the cap allows', async () => {
    h.state.conv = { ...h.state.conv, ai_reply_count: 2 } // this send makes it 3
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledOnce()
    expect(h.notifyHandoffToTeam).toHaveBeenCalledOnce()
    const update = h.state.conversationUpdates.find(
      (u) => u.ai_autoreply_disabled === true,
    )
    expect(update?.ai_handoff_summary).toContain('limite de 3')
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply, writes a summary, and does not send on handoff', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true, transferToSlug: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.rpcCalls).toHaveLength(0)
    const update = h.state.conversationUpdates[0]
    expect(update).toMatchObject({ ai_autoreply_disabled: true })
    expect(update.ai_handoff_summary).toContain('AI agent handed off')
    // No handoff target configured → conversation left unassigned.
    expect(update).not.toHaveProperty('assigned_agent_id')
  })

  it('routes to the configured handoff agent on handoff', async () => {
    h.loadReceptionistAgent.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true, transferToSlug: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.conversationUpdates[0]).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })
})

describe('dispatchInboundToAiReply — transfer between agents', () => {
  const suporte = aiConfig({
    id: 'agent-suporte',
    name: 'Suporte',
    slug: 'suporte',
    autoReplyMaxPerConversation: 3,
  })

  beforeEach(() => {
    h.state.siblings = [
      { id: 'agent-suporte', slug: 'suporte', name: 'Suporte', description: 'Suporte técnico' },
    ]
  })

  it('transfers within the same dispatch and the target agent replies', async () => {
    h.generateReply
      .mockResolvedValueOnce({ text: '', handoff: false, transferToSlug: 'suporte' })
      .mockResolvedValueOnce({ text: 'Claro, posso ajudar!', handoff: false, transferToSlug: null })
    h.loadAiAgent.mockResolvedValue(suporte)

    await dispatchInboundToAiReply(ARGS)

    // active_ai_agent_id is repointed at the target before the second turn runs.
    expect(h.state.conversationUpdates).toContainEqual({ active_ai_agent_id: 'agent-suporte' })
    // Only the second (post-transfer) turn actually sends a message.
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Claro, posso ajudar!' }),
    )
    expect(h.generateReply).toHaveBeenCalledTimes(2)
  })

  it('sends a lead-in message before transferring when the model leaves text', async () => {
    h.generateReply
      .mockResolvedValueOnce({
        text: 'Já te encaminho para o suporte!',
        handoff: false,
        transferToSlug: 'suporte',
      })
      .mockResolvedValueOnce({ text: 'Oi, em que posso ajudar?', handoff: false, transferToSlug: null })
    h.loadAiAgent.mockResolvedValue(suporte)

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).toHaveBeenCalledTimes(2)
    expect(h.engineSendText).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ text: 'Já te encaminho para o suporte!' }),
    )
    // Both sends claim a slot off the same shared per-conversation counter.
    expect(h.state.rpcCalls).toHaveLength(2)
  })

  it('degrades to a human handoff once the transfer-hop limit is exceeded', async () => {
    // Both agents keep asking to transfer to the other, forever.
    h.generateReply.mockResolvedValue({ text: '', handoff: false, transferToSlug: 'suporte' })
    h.loadAiAgent.mockResolvedValue(suporte)

    await dispatchInboundToAiReply(ARGS)

    // Never actually sends a customer-facing message…
    expect(h.engineSendText).not.toHaveBeenCalled()
    // …and ends in a human handoff instead of looping forever.
    const handoffUpdate = h.state.conversationUpdates.find((u) => u.ai_autoreply_disabled)
    expect(handoffUpdate).toBeTruthy()
    expect(handoffUpdate!.ai_handoff_summary).toContain('hop limit')
  })
})
