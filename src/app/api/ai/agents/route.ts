import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireWrite,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { checkAccountFeature } from '@/lib/billing/feature-gate'
import { validateAiCredentials } from '@/lib/ai/validate'
import { listAiAgents, loadProviderConfig } from '@/lib/ai/config'
import { isValidAgentSlug, slugifyAgentName } from '@/lib/ai/slug'
import { normalizeReplyCap } from '@/lib/ai/defaults'
import { AiError } from '@/lib/ai/types'

function bad(message: string, code?: string) {
  return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status: 400 })
}

/**
 * GET /api/ai/agents
 *
 * List the account's agents (any member) — lightweight roster.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const agents = await listAiAgents(supabase, accountId)
    // Serialize snake_case for HTTP consumers — matches
    // /api/ai/agents/[id] and every client that reads this list
    // (ai-agents-manager card, ai-thread-banner, ai-playground). The
    // typed camelCase `AiAgentSummary` stays for server-side callers
    // like /api/ai/playground.
    return NextResponse.json({
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        slug: a.slug,
        description: a.description,
        is_receptionist: a.isReceptionist,
        is_active: a.isActive,
        auto_reply_enabled: a.autoReplyEnabled,
        auto_reply_max_per_conversation: a.autoReplyMaxPerConversation,
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/agents  (admin+)
 *
 * Create a new agent. Every agent on the account shares the ONE
 * provider credential configured at `/api/ai/provider` (migration 047
 * — re-entering a key per agent was pure friction, not a real need);
 * this route requires that credential to already exist and validates
 * the chosen MODEL against it before persisting (an agent can still
 * pick its own model — a cheaper one for FAQs, a stronger one for
 * sales — just not its own key).
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

    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model) return bad('model is required')

    const systemPrompt =
      typeof body.system_prompt === 'string' && body.system_prompt.trim()
        ? body.system_prompt.trim()
        : null
    const isActive = body.is_active === true
    // Receptionist-only concept (migration 053) — a specialist agent
    // never fields a cold inbound on its own, only the account's first
    // (auto-receptionist) agent can turn this on at creation time.
    const autoReplyEnabled = isFirstAgent && body.auto_reply_enabled === true

    // `null` = no per-conversation reply limit (the new default for a
    // freshly created agent — an absent field normalizes to null too).
    const maxPer = normalizeReplyCap(body.auto_reply_max_per_conversation)

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

    try {
      await validateAiCredentials({
        id: 'pending',
        name,
        slug,
        description,
        isReceptionist: isFirstAgent,
        provider: credential.provider,
        model,
        apiKey: credential.apiKey,
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
      return bad('Could not validate this model with your configured API key.')
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
        model,
        system_prompt: systemPrompt,
        is_active: isActive,
        auto_reply_enabled: autoReplyEnabled,
        auto_reply_max_per_conversation: maxPer,
        handoff_agent_id: handoffAgentId,
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
