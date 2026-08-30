import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireWrite,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { checkAccountFeature } from '@/lib/billing/feature-gate'
import { encrypt } from '@/lib/whatsapp/encryption'
import { validateAiCredentials } from '@/lib/ai/validate'
import { listAiAgents } from '@/lib/ai/config'
import { embedTexts } from '@/lib/ai/embeddings'
import { isValidAgentSlug, slugifyAgentName } from '@/lib/ai/slug'
import { AiError, type AiProvider } from '@/lib/ai/types'

function bad(message: string, code?: string) {
  return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status: 400 })
}

/**
 * GET /api/ai/agents
 *
 * List the account's agents (any member) — lightweight roster, no keys.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const agents = await listAiAgents(supabase, accountId)
    return NextResponse.json({ agents })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/agents  (admin+)
 *
 * Create a new agent. Validates the key with the provider before
 * persisting (mirrors the old single-config route), then stores it
 * AES-256-GCM-encrypted.
 *
 * Plan gate: a Starter account may still create its FIRST agent (kept
 * as the receptionist) — behaviour identical to the pre-multi-agent
 * bot. A second+ agent requires the `aiAgents` Pro feature. This is
 * intentionally not a flat `requireWriteFeature` check, since it's
 * conditioned on how many agents already exist, not a plain boolean.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireWrite('admin')

    const limit = checkRateLimit(`ai-agents:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { count: existingCount, error: countErr } = await supabase
      .from('ai_agents')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    if (countErr) {
      console.error('[ai/agents POST] count error:', countErr)
      return NextResponse.json({ error: 'Failed to check existing agents' }, { status: 500 })
    }
    const isFirstAgent = (existingCount ?? 0) === 0

    if (!isFirstAgent) {
      const hasAiAgents = await checkAccountFeature(supabase, accountId, 'aiAgents')
      if (!hasAiAgents) {
        return NextResponse.json(
          {
            error: 'Adding more than one AI agent requires the Pro plan.',
            code: 'plan_upgrade_required',
          },
          { status: 403 },
        )
      }
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return bad('name is required')

    let slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : ''
    if (!slug) slug = slugifyAgentName(name)
    if (!isValidAgentSlug(slug)) {
      return bad('slug must be lower-case letters, digits, "-" or "_" only')
    }

    const description =
      typeof body.description === 'string' && body.description.trim()
        ? body.description.trim()
        : null

    const provider = body.provider as AiProvider
    if (provider !== 'openai' && provider !== 'anthropic') {
      return bad('provider must be "openai" or "anthropic"')
    }
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model) return bad('model is required')

    const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
    if (!apiKey) return bad('api_key is required')

    const systemPrompt =
      typeof body.system_prompt === 'string' && body.system_prompt.trim()
        ? body.system_prompt.trim()
        : null
    const isActive = body.is_active === true
    const autoReplyEnabled = body.auto_reply_enabled === true

    let maxPer = Number(body.auto_reply_max_per_conversation)
    if (!Number.isFinite(maxPer)) maxPer = 3
    maxPer = Math.min(20, Math.max(1, Math.floor(maxPer)))

    const rawHandoff =
      typeof body.handoff_agent_id === 'string' ? body.handoff_agent_id.trim() : ''
    let handoffAgentId: string | null = null
    if (rawHandoff) {
      const { data: member } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('account_id', accountId)
        .eq('user_id', rawHandoff)
        .maybeSingle()
      if (!member) return bad('handoff_agent_id must be a member of this account')
      handoffAgentId = rawHandoff
    }

    const rawEmbeddingsKey =
      typeof body.embeddings_api_key === 'string' ? body.embeddings_api_key.trim() : ''

    try {
      await validateAiCredentials({
        id: 'pending',
        name,
        slug,
        description,
        isReceptionist: isFirstAgent,
        provider,
        model,
        apiKey,
        systemPrompt,
        isActive,
        autoReplyEnabled,
        autoReplyMaxPerConversation: maxPer,
        handoffAgentId: null,
        embeddingsApiKey: null,
      })
    } catch (err) {
      if (err instanceof AiError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
      }
      console.error('[ai/agents POST] validation error:', err)
      return bad('Could not validate the API key with the provider.')
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
        console.error('[ai/agents POST] embeddings validation error:', err)
        return bad('Could not validate the embeddings key.')
      }
    }

    const { data: inserted, error: insErr } = await supabase
      .from('ai_agents')
      .insert({
        account_id: accountId,
        created_by: userId,
        name,
        slug,
        description,
        // The account's very first agent is always the receptionist —
        // there are no siblings yet to conflict with, and every
        // account must have exactly one (partial unique index).
        is_receptionist: isFirstAgent,
        provider,
        model,
        api_key: encrypt(apiKey),
        system_prompt: systemPrompt,
        is_active: isActive,
        auto_reply_enabled: autoReplyEnabled,
        auto_reply_max_per_conversation: maxPer,
        handoff_agent_id: handoffAgentId,
        embeddings_api_key: rawEmbeddingsKey ? encrypt(rawEmbeddingsKey) : null,
      })
      .select('id')
      .single()

    if (insErr || !inserted) {
      // 23505 = unique_violation — either the slug or (on a first-agent
      // race) the one-receptionist index.
      if ((insErr as { code?: string } | null)?.code === '23505') {
        return bad('An agent with this slug already exists on this account.', 'slug_taken')
      }
      console.error('[ai/agents POST] insert error:', insErr)
      return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 })
    }

    return NextResponse.json({ success: true, id: inserted.id })
  } catch (err) {
    return toErrorResponse(err)
  }
}
