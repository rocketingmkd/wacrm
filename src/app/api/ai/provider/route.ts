import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireWrite,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { validateAiCredentials } from '@/lib/ai/validate'
import { embedTexts } from '@/lib/ai/embeddings'
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults'
import { AiError, type AiProvider } from '@/lib/ai/types'

function bad(message: string, code?: string) {
  return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status: 400 })
}

/**
 * GET /api/ai/provider
 *
 * Any member may read whether the account's shared BYO credential is
 * configured, so agent settings / the playground can explain why
 * there's nothing to test yet. The encrypted keys are NEVER returned —
 * only `has_key` / `has_embeddings_key` flags.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data, error } = await supabase
      .from('ai_provider_config')
      .select('provider, api_key, embeddings_api_key')
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[ai/provider GET] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load provider config' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ configured: false })

    return NextResponse.json({
      configured: true,
      provider: data.provider,
      has_key: !!data.api_key,
      has_embeddings_key: !!data.embeddings_api_key,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/provider  (admin+)
 *
 * Upsert the account's ONE shared provider credential — every agent on
 * the account uses this same key (migration 047); only each agent's
 * MODEL varies. Validates the key with the provider before persisting
 * (a cheap connectivity check against that provider's default model —
 * this endpoint has no per-agent model to test with), then stores it
 * AES-256-GCM-encrypted. When `api_key` is omitted the existing stored
 * key is reused (the form sends it only when the user re-enters it).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireWrite('admin')

    const limit = checkRateLimit(`ai-provider:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const provider = body.provider as AiProvider
    if (provider !== 'openai' && provider !== 'anthropic') {
      return bad('provider must be "openai" or "anthropic"')
    }

    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
    const rawEmbeddingsKey =
      typeof body.embeddings_api_key === 'string' ? body.embeddings_api_key.trim() : ''
    const clearEmbeddingsKey = body.embeddings_api_key === null

    const { data: existing } = await supabase
      .from('ai_provider_config')
      .select('provider, api_key')
      .eq('account_id', accountId)
      .maybeSingle()

    let apiKeyPlain: string
    if (rawKey) {
      apiKeyPlain = rawKey
    } else if (existing?.api_key) {
      try {
        apiKeyPlain = decrypt(existing.api_key)
      } catch {
        return bad('Stored API key could not be decrypted — re-enter your key.')
      }
    } else {
      return bad('api_key is required')
    }

    // Only spend a provider round-trip when the credentials that affect
    // reachability actually changed — a save that just re-orders
    // nothing (there's nothing else on this endpoint) always re-tests
    // the key when present, since it's the only field.
    const credentialsChanged = !existing || rawKey !== '' || provider !== existing.provider
    if (credentialsChanged) {
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
        })
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
        }
        console.error('[ai/provider POST] validation error:', err)
        return bad('Could not validate the API key with the provider.')
      }
    }

    if (rawEmbeddingsKey) {
      try {
        await embedTexts(rawEmbeddingsKey, ['ping'])
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: `Embeddings key: ${err.message}`, code: err.code },
            { status: 400 },
          )
        }
        console.error('[ai/provider POST] embeddings validation error:', err)
        return bad('Could not validate the embeddings key.')
      }
    }

    const row: Record<string, unknown> = {
      account_id: accountId,
      provider,
      api_key: encrypt(apiKeyPlain),
    }
    if (rawEmbeddingsKey) row.embeddings_api_key = encrypt(rawEmbeddingsKey)
    else if (clearEmbeddingsKey) row.embeddings_api_key = null

    if (existing) {
      const { error: upErr } = await supabase
        .from('ai_provider_config')
        .update(row)
        .eq('account_id', accountId)
      if (upErr) {
        console.error('[ai/provider POST] update error:', upErr)
        return NextResponse.json({ error: 'Failed to save provider config' }, { status: 500 })
      }
    } else {
      const { error: insErr } = await supabase
        .from('ai_provider_config')
        .insert({ ...row, created_by: userId })
      if (insErr) {
        console.error('[ai/provider POST] insert error:', insErr)
        return NextResponse.json({ error: 'Failed to save provider config' }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/provider  (admin+)
 *
 * Removes the account's shared credential — every agent stops being
 * usable (loadAiAgent/loadReceptionistAgent return null) until a new
 * key is saved, but agents themselves (name/prompt/knowledge base)
 * are untouched. Also used to recover from a corrupted encrypted key.
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireWrite('admin')
    const { error } = await supabase
      .from('ai_provider_config')
      .delete()
      .eq('account_id', accountId)
    if (error) {
      console.error('[ai/provider DELETE] error:', error)
      return NextResponse.json({ error: 'Failed to delete provider config' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
