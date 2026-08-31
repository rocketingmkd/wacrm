import { NextResponse } from 'next/server'
import { requireWrite, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { validateAiCredentials } from '@/lib/ai/validate'
import { loadProviderConfig } from '@/lib/ai/config'
import { AiError } from '@/lib/ai/types'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/ai/agents/[id]/test  (admin+)
 *
 * "Test model" button: validate a candidate MODEL against the
 * account's shared provider credential (see /api/ai/provider) WITHOUT
 * saving. `id` is `"new"` when testing before the agent has been
 * created yet (the create form) — it's only used for the error
 * message context, since the credential is account-level either way.
 * Returns `{ ok: true }` on success, 400 with the provider's message
 * on failure (including `code: "provider_not_configured"` when the
 * account hasn't set up an API key yet).
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

    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model) {
      return NextResponse.json({ error: 'model is required' }, { status: 400 })
    }

    const credential = await loadProviderConfig(supabase, accountId)
    if (!credential) {
      return NextResponse.json(
        {
          error: 'Configure your provider API key first.',
          code: 'provider_not_configured',
        },
        { status: 400 },
      )
    }

    try {
      await validateAiCredentials({
        id,
        name: 'test',
        slug: 'test',
        description: null,
        isReceptionist: false,
        provider: credential.provider,
        model,
        apiKey: credential.apiKey,
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
      return NextResponse.json({ error: 'Could not validate this model.' }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
