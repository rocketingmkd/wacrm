import { NextResponse } from 'next/server'
import { requireWrite, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { validateAiCredentials } from '@/lib/ai/validate'
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults'
import { AiError, type AiProvider } from '@/lib/ai/types'

/**
 * POST /api/ai/provider/test  (admin+)
 *
 * "Test key" button on the shared provider config screen: validate a
 * candidate provider/key against the provider's default model WITHOUT
 * saving. Omitting `api_key` re-tests the stored key. Returns
 * `{ ok: true }` on success, 400 with the provider's message on failure.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireWrite('admin')

    const limit = checkRateLimit(`ai-provider-test:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Corpo da requisição inválido' }, { status: 400 })
    }

    const provider = body.provider as AiProvider
    if (provider !== 'openai' && provider !== 'anthropic') {
      return NextResponse.json(
        { error: 'provider must be "openai" or "anthropic"' },
        { status: 400 },
      )
    }

    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
    let apiKeyPlain = rawKey
    if (!apiKeyPlain) {
      const { data: existing } = await supabase
        .from('ai_provider_config')
        .select('api_key')
        .eq('account_id', accountId)
        .maybeSingle()
      if (!existing?.api_key) {
        return NextResponse.json({ error: 'Informe uma chave de API para testar.' }, { status: 400 })
      }
      try {
        apiKeyPlain = decrypt(existing.api_key)
      } catch {
        return NextResponse.json(
          { error: 'A chave de API salva não pôde ser descriptografada. Informe a chave novamente.' },
          { status: 400 },
        )
      }
    }

    try {
      await validateAiCredentials({
        id: 'provider-config',
        name: 'test',
        slug: 'test',
        description: null,
        isReceptionist: false,
        provider,
        model: AI_PROVIDER_DEFAULT_MODEL[provider],
        apiKey: apiKeyPlain,
        systemPrompt: null,
        isActive: true,
        autoReplyEnabled: false,
        autoReplyMaxPerConversation: 3,
        handoffAgentId: null,
        embeddingsApiKey: null,
        canSchedule: false,
      })
    } catch (err) {
      if (err instanceof AiError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
      }
      console.error('[ai/provider/test] validation error:', err)
      return NextResponse.json({ error: 'Não foi possível validar a chave de API.' }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
