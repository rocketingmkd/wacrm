import { NextResponse } from 'next/server'
import { requireWrite, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { validateAiCredentials } from '@/lib/ai/validate'
import { AiError, type AiProvider } from '@/lib/ai/types'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/ai/agents/[id]/test  (admin+)
 *
 * "Test key" button: validate a candidate provider/model/key against
 * the provider WITHOUT saving. `id` is `"new"` when testing before the
 * agent has been created yet (the create form); otherwise an existing
 * agent id, and omitting `api_key` re-tests its stored key. Returns
 * `{ ok: true }` on success, 400 with the provider's message on failure.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireWrite('admin')

    const limit = checkRateLimit(`ai-agents-test:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const provider = body.provider as AiProvider
    if (provider !== 'openai' && provider !== 'anthropic') {
      return NextResponse.json(
        { error: 'provider must be "openai" or "anthropic"' },
        { status: 400 },
      )
    }
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model) {
      return NextResponse.json({ error: 'model is required' }, { status: 400 })
    }

    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
    let apiKeyPlain = rawKey
    if (!apiKeyPlain) {
      if (id === 'new') {
        return NextResponse.json({ error: 'Enter an API key to test.' }, { status: 400 })
      }
      const { data: existing } = await supabase
        .from('ai_agents')
        .select('api_key')
        .eq('account_id', accountId)
        .eq('id', id)
        .maybeSingle()
      if (!existing?.api_key) {
        return NextResponse.json({ error: 'Enter an API key to test.' }, { status: 400 })
      }
      try {
        apiKeyPlain = decrypt(existing.api_key)
      } catch {
        return NextResponse.json(
          { error: 'Stored API key could not be decrypted — re-enter your key.' },
          { status: 400 },
        )
      }
    }

    try {
      await validateAiCredentials({
        id,
        name: 'test',
        slug: 'test',
        description: null,
        isReceptionist: false,
        provider,
        model,
        apiKey: apiKeyPlain,
        systemPrompt: null,
        isActive: true,
        autoReplyEnabled: false,
        autoReplyMaxPerConversation: 3,
        handoffAgentId: null,
        embeddingsApiKey: null,
      })
    } catch (err) {
      if (err instanceof AiError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
      }
      console.error('[ai/agents/[id]/test] validation error:', err)
      return NextResponse.json({ error: 'Could not validate the API key.' }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
