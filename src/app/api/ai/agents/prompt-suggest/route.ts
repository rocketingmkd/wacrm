import { NextResponse } from 'next/server'
import { requireWrite, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadProviderConfig } from '@/lib/ai/config'
import { AI_PROVIDER_DEFAULT_MODEL, aiRequestTimeoutMs } from '@/lib/ai/defaults'
import { generateOpenAi } from '@/lib/ai/providers/openai'
import { generateAnthropic } from '@/lib/ai/providers/anthropic'
import { buildPromptSuggestMessages } from '@/lib/ai/prompt-suggest'
import { AiError } from '@/lib/ai/types'

function bad(message: string, code?: string) {
  return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status: 400 })
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/**
 * POST /api/ai/agents/prompt-suggest  (admin+)
 *
 * Generate (or rewrite) an agent's `system_prompt` so it fits the fixed
 * scaffold — see src/lib/ai/prompt-suggest.ts. Runs on the account's own
 * BYO provider credential; a cheap one-shot generation.
 *
 * Body:
 *   { mode: 'generate', agent_name?, role, avoids?, handoff_when?, tone?, notes?, model? }
 *   { mode: 'improve',  agent_name?, current, model? }
 *
 * Returns: { prompt: string }
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireWrite('admin')

    const limit = checkRateLimit(`ai-prompt-suggest:${userId}`, RATE_LIMITS.aiDraft)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const mode = body.mode === 'improve' ? 'improve' : 'generate'
    if (mode === 'generate' && !str(body.role)) {
      return bad('Descreva o que o agente faz.')
    }
    if (mode === 'improve' && !str(body.current)) {
      return bad('Não há prompt para ajustar.')
    }

    const credential = await loadProviderConfig(supabase, accountId)
    if (!credential) {
      return bad('Configure sua chave de API primeiro.', 'provider_not_configured')
    }

    const { system, user } = buildPromptSuggestMessages({
      mode,
      agentName: str(body.agent_name),
      role: str(body.role),
      avoids: str(body.avoids),
      handoffWhen: str(body.handoff_when),
      tone: str(body.tone),
      notes: str(body.notes),
      current: str(body.current),
    })

    const model = str(body.model) || AI_PROVIDER_DEFAULT_MODEL[credential.provider]
    const providerArgs = {
      apiKey: credential.apiKey,
      model,
      systemPrompt: system,
      messages: [{ role: 'user' as const, content: user }],
      timeoutMs: aiRequestTimeoutMs(),
    }

    // The generated text intentionally contains the literal strings
    // "[[HANDOFF]]" / "[[TRANSFER:<slug>]]" as instructions, so this must
    // NOT go through generateReply (which would strip them). Call the
    // adapter directly and use the raw text.
    const result =
      credential.provider === 'anthropic'
        ? await generateAnthropic(providerArgs)
        : await generateOpenAi(providerArgs)

    const prompt = result.text.trim()
    if (!prompt) return bad('O provedor devolveu uma resposta vazia. Tente de novo.')

    return NextResponse.json({ prompt })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
