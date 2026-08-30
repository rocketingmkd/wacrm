import { NextResponse } from 'next/server'
import { requireWrite, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiAgent, loadReceptionistAgent, listAiAgents } from '@/lib/ai/config'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import { generateReply } from '@/lib/ai/generate'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { latestUserMessage } from '@/lib/ai/query'
import { AiError, type ChatMessage } from '@/lib/ai/types'

// Keep the tested transcript bounded, mirroring the live context window.
const MAX_TURNS = 20

/**
 * POST /api/ai/playground  (agent+)
 *
 * Body: { agent_id?, messages }. Test-chat with one of the account's
 * agents WITHOUT touching WhatsApp — the exact same path the auto-reply
 * bot uses for that agent (knowledge-base retrieval + `auto_reply`
 * system prompt, including the transfer-menu block when siblings
 * exist). Omitting `agent_id` tests the receptionist. Reads the agent
 * even when its master switch is off (requireActive:false) so you can
 * try it before going live. Stateless: the client sends the running
 * transcript each turn. Transfers are NOT simulated here — the reply
 * just reports `transfer_to` when the model asks for one, same as
 * `handoff` (see the multi-agent plan's declared out-of-scope list).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireWrite('agent')

    const limit = checkRateLimit(`ai-playground:${userId}`, RATE_LIMITS.aiDraft)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const rawMessages = Array.isArray(body?.messages) ? body.messages : null
    if (!rawMessages) {
      return NextResponse.json({ error: 'messages is required' }, { status: 400 })
    }
    const agentId = typeof body?.agent_id === 'string' ? body.agent_id : null

    const messages: ChatMessage[] = rawMessages
      .filter(
        (m: unknown): m is ChatMessage =>
          !!m &&
          typeof m === 'object' &&
          ((m as ChatMessage).role === 'user' ||
            (m as ChatMessage).role === 'assistant') &&
          typeof (m as ChatMessage).content === 'string' &&
          (m as ChatMessage).content.trim().length > 0,
      )
      .slice(-MAX_TURNS)

    if (messages.length === 0) {
      return NextResponse.json(
        { error: 'Send a message to test the agent.' },
        { status: 400 },
      )
    }

    const loadOpts = { requireActive: false }
    const config = await (agentId
      ? loadAiAgent(supabase, accountId, agentId, loadOpts)
      : loadReceptionistAgent(supabase, accountId, loadOpts)
    ).catch((err) => {
      console.error('[ai/playground] load error:', err)
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error: 'No agent configured yet. Add your provider key in Setup.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    const knowledge = await retrieveKnowledge(
      supabase,
      accountId,
      config.id,
      config,
      latestUserMessage(messages),
    )
    const roster = await listAiAgents(supabase, accountId)
    const availableAgents = roster
      .filter((a) => a.id !== config.id && a.isActive && a.autoReplyEnabled)
      .map((a) => ({ id: a.id, slug: a.slug, name: a.name, description: a.description }))
    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      availableAgents,
    })

    const { text, handoff, transferToSlug } = await generateReply({
      config,
      systemPrompt,
      messages,
    })
    return NextResponse.json({ reply: text, handoff, transfer_to: transferToSlug })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    return toErrorResponse(err)
  }
}
