import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireWrite,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { validateAiCredentials } from '@/lib/ai/validate'
import { embedTexts } from '@/lib/ai/embeddings'
import { isValidAgentSlug } from '@/lib/ai/slug'
import { AiError, type AiProvider } from '@/lib/ai/types'

type Params = { params: Promise<{ id: string }> }

function bad(message: string, code?: string) {
  return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status: 400 })
}

const DETAIL_COLUMNS =
  'id, name, slug, description, is_receptionist, provider, model, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, api_key, embeddings_api_key'

/**
 * GET /api/ai/agents/[id]
 *
 * Any member may read one agent's config so settings/inbox pickers can
 * show it. The encrypted keys are NEVER returned — only `has_key` /
 * `has_embeddings_key` flags; the form shows a masked placeholder.
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { id } = await params

    const { data, error } = await supabase
      .from('ai_agents')
      .select(DETAIL_COLUMNS)
      .eq('account_id', accountId)
      .eq('id', id)
      .maybeSingle()
    if (error) {
      console.error('[ai/agents/[id] GET] error:', error)
      return NextResponse.json({ error: 'Failed to load agent' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { api_key, embeddings_api_key, ...safe } = data
    return NextResponse.json({
      ...safe,
      has_key: !!api_key,
      has_embeddings_key: !!embeddings_api_key,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/ai/agents/[id]  (admin+)
 *
 * Partial update. Only fields present in the body are touched (so a
 * toggle flip doesn't require resending the whole form). Re-validates
 * credentials with the provider only when they actually changed.
 *
 * Receptionist promotion: `is_receptionist: true` unsets the account's
 * current receptionist first (the partial unique index would otherwise
 * reject having two). `is_receptionist: false` is rejected outright —
 * promote a different agent instead, which demotes this one as a side
 * effect. This guarantees the account always has exactly one.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireWrite('admin')
    const limit = checkRateLimit(`ai-agents:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const { data: existing, error: fetchErr } = await supabase
      .from('ai_agents')
      .select(DETAIL_COLUMNS)
      .eq('account_id', accountId)
      .eq('id', id)
      .maybeSingle()
    if (fetchErr) {
      console.error('[ai/agents/[id] PATCH] fetch error:', fetchErr)
      return NextResponse.json({ error: 'Failed to load agent' }, { status: 500 })
    }
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if ('is_receptionist' in body && body.is_receptionist === false && existing.is_receptionist) {
      return bad(
        'Every account needs exactly one receptionist — promote another agent instead of removing this one.',
        'last_receptionist',
      )
    }

    const update: Record<string, unknown> = {}

    if ('name' in body) {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name) return bad('name cannot be empty')
      update.name = name
    }
    if ('slug' in body) {
      const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : ''
      if (!isValidAgentSlug(slug)) {
        return bad('slug must be lower-case letters, digits, "-" or "_" only')
      }
      update.slug = slug
    }
    if ('description' in body) {
      update.description =
        typeof body.description === 'string' && body.description.trim()
          ? body.description.trim()
          : null
    }
    if ('is_active' in body) update.is_active = body.is_active === true
    if ('auto_reply_enabled' in body) update.auto_reply_enabled = body.auto_reply_enabled === true
    if ('system_prompt' in body) {
      update.system_prompt =
        typeof body.system_prompt === 'string' && body.system_prompt.trim()
          ? body.system_prompt.trim()
          : null
    }
    if ('auto_reply_max_per_conversation' in body) {
      let maxPer = Number(body.auto_reply_max_per_conversation)
      if (!Number.isFinite(maxPer)) maxPer = 3
      update.auto_reply_max_per_conversation = Math.min(20, Math.max(1, Math.floor(maxPer)))
    }
    if ('handoff_agent_id' in body) {
      const raw =
        typeof body.handoff_agent_id === 'string' ? body.handoff_agent_id.trim() : ''
      if (raw) {
        const { data: member } = await supabase
          .from('profiles')
          .select('user_id')
          .eq('account_id', accountId)
          .eq('user_id', raw)
          .maybeSingle()
        if (!member) return bad('handoff_agent_id must be a member of this account')
        update.handoff_agent_id = raw
      } else {
        update.handoff_agent_id = null
      }
    }

    const provider = ('provider' in body ? body.provider : existing.provider) as AiProvider
    if (provider !== 'openai' && provider !== 'anthropic') {
      return bad('provider must be "openai" or "anthropic"')
    }
    const model =
      'model' in body
        ? typeof body.model === 'string'
          ? body.model.trim()
          : ''
        : existing.model
    if (!model) return bad('model is required')
    if ('provider' in body) update.provider = provider
    if ('model' in body) update.model = model

    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
    let apiKeyPlain: string
    if (rawKey) {
      apiKeyPlain = rawKey
    } else {
      try {
        apiKeyPlain = decrypt(existing.api_key)
      } catch {
        return bad('Stored API key could not be decrypted — re-enter your key.')
      }
    }

    const credentialsChanged = rawKey !== '' || provider !== existing.provider || model !== existing.model
    if (credentialsChanged) {
      try {
        await validateAiCredentials({
          id: existing.id,
          name: (update.name as string) ?? existing.name,
          slug: (update.slug as string) ?? existing.slug,
          description: null,
          isReceptionist: existing.is_receptionist,
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
        console.error('[ai/agents/[id] PATCH] validation error:', err)
        return bad('Could not validate the API key with the provider.')
      }
      if (rawKey) update.api_key = encrypt(rawKey)
    }

    const rawEmbeddingsKey =
      typeof body.embeddings_api_key === 'string' ? body.embeddings_api_key.trim() : ''
    const clearEmbeddingsKey = body.embeddings_api_key === null
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
        console.error('[ai/agents/[id] PATCH] embeddings validation error:', err)
        return bad('Could not validate the embeddings key.')
      }
      update.embeddings_api_key = encrypt(rawEmbeddingsKey)
    } else if (clearEmbeddingsKey) {
      update.embeddings_api_key = null
    }

    // Receptionist promotion: demote the current one first so the
    // partial unique index (one receptionist per account) never sees
    // two true rows at once.
    if (body.is_receptionist === true && !existing.is_receptionist) {
      const { error: demoteErr } = await supabase
        .from('ai_agents')
        .update({ is_receptionist: false })
        .eq('account_id', accountId)
        .eq('is_receptionist', true)
      if (demoteErr) {
        console.error('[ai/agents/[id] PATCH] demote error:', demoteErr)
        return NextResponse.json({ error: 'Failed to promote agent' }, { status: 500 })
      }
      update.is_receptionist = true
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ success: true })
    }

    const { error: upErr } = await supabase
      .from('ai_agents')
      .update(update)
      .eq('account_id', accountId)
      .eq('id', id)
    if (upErr) {
      if ((upErr as { code?: string }).code === '23505') {
        return bad('An agent with this slug already exists on this account.', 'slug_taken')
      }
      console.error('[ai/agents/[id] PATCH] update error:', upErr)
      return NextResponse.json({ error: 'Failed to update agent' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/agents/[id]  (admin+)
 *
 * Refuses to delete the receptionist — every account must always have
 * one, and it's also always the last-remaining agent when there's only
 * one, so this rule alone keeps the account from ever hitting zero.
 * Promote another agent first (PATCH is_receptionist:true), then delete.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireWrite('admin')
    const { id } = await params

    const { data: existing } = await supabase
      .from('ai_agents')
      .select('id, is_receptionist')
      .eq('account_id', accountId)
      .eq('id', id)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (existing.is_receptionist) {
      return bad(
        'The receptionist agent cannot be deleted — promote another agent first.',
        'last_receptionist',
      )
    }

    const { error } = await supabase
      .from('ai_agents')
      .delete()
      .eq('account_id', accountId)
      .eq('id', id)
    if (error) {
      console.error('[ai/agents/[id] DELETE] error:', error)
      return NextResponse.json({ error: 'Failed to delete agent' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
