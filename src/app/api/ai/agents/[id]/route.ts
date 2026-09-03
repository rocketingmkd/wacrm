import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireWrite,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { validateAiCredentials } from '@/lib/ai/validate'
import { loadProviderConfig } from '@/lib/ai/config'
import { isValidAgentSlug } from '@/lib/ai/slug'
import { normalizeReplyCap } from '@/lib/ai/defaults'
import { AiError } from '@/lib/ai/types'

type Params = { params: Promise<{ id: string }> }

function bad(message: string, code?: string) {
  return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status: 400 })
}

const DETAIL_COLUMNS =
  'id, name, slug, description, is_receptionist, model, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id'

/**
 * GET /api/ai/agents/[id]
 *
 * Any member may read one agent's config so settings/inbox pickers can
 * show it. There's no per-agent credential anymore (migration 047 —
 * every agent shares the account's one provider key, see
 * /api/ai/provider) — only identity/behaviour fields.
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

    return NextResponse.json(data)
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/ai/agents/[id]  (admin+)
 *
 * Partial update. Only fields present in the body are touched (so a
 * toggle flip doesn't require resending the whole form). Re-validates
 * the model against the account's shared provider credential only when
 * the model actually changed.
 *
 * Receptionist promotion: `is_receptionist: true` unsets the account's
 * current receptionist first (the partial unique index would otherwise
 * reject having two — at most one, never enforced as "at least one").
 * `is_receptionist: false` is a plain demotion: the account is left
 * with none, which is a valid state — no agent auto-picks up a cold
 * inbound (`dispatchInboundToAiReply` degrades to "no agent on duty"
 * and the conversation just sits in the inbox for a human).
 *
 * `auto_reply_enabled` is a receptionist-only concept (migration 053):
 * a specialist agent is only ever reached by explicit routing (the
 * receptionist's own transfer judgment, or an automation/flow's
 * "activate AI agent" step), never by fielding a cold inbound on its
 * own — so turning this on is rejected unless the row already is, or
 * is becoming in this same request, the receptionist. Demoting or
 * promoting a receptionist clears/leaves this flag accordingly so the
 * DB's CHECK constraint is never the thing that catches it.
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

    const update: Record<string, unknown> = {}

    const demoting = 'is_receptionist' in body && body.is_receptionist === false
    const promoting = body.is_receptionist === true && !existing.is_receptionist
    // Resolves the row's `is_receptionist` value AFTER this request, so
    // the `auto_reply_enabled` gate below (a receptionist-only concept,
    // migration 053) sees the right answer even when both fields are
    // sent in the same PATCH.
    const willBeReceptionist = demoting ? false : promoting ? true : existing.is_receptionist

    if (demoting) {
      update.is_receptionist = false
      // Stops being meaningful the moment it's demoted — see migration
      // 053's DB constraint, which would reject leaving this true.
      update.auto_reply_enabled = false
    }

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
    if ('auto_reply_enabled' in body && !demoting) {
      const wantsOn = body.auto_reply_enabled === true
      if (wantsOn && !willBeReceptionist) {
        return bad(
          'Só o agente recepcionista pode ter Resposta automática — promova este agente primeiro.',
          'auto_reply_receptionist_only',
        )
      }
      update.auto_reply_enabled = wantsOn
    }
    if ('system_prompt' in body) {
      update.system_prompt =
        typeof body.system_prompt === 'string' && body.system_prompt.trim()
          ? body.system_prompt.trim()
          : null
    }
    if ('auto_reply_max_per_conversation' in body) {
      // null / '' / unparseable → no limit
      update.auto_reply_max_per_conversation = normalizeReplyCap(
        body.auto_reply_max_per_conversation,
      )
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

    if ('model' in body) {
      const model = typeof body.model === 'string' ? body.model.trim() : ''
      if (!model) return bad('model is required')
      if (model !== existing.model) {
        const credential = await loadProviderConfig(supabase, accountId)
        if (!credential) {
          return bad('Configure your provider API key first.', 'provider_not_configured')
        }
        try {
          await validateAiCredentials({
            id: existing.id,
            name: (update.name as string) ?? existing.name,
            slug: (update.slug as string) ?? existing.slug,
            description: null,
            isReceptionist: existing.is_receptionist,
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
          console.error('[ai/agents/[id] PATCH] validation error:', err)
          return bad('Could not validate this model with your configured API key.')
        }
      }
      update.model = model
    }

    // Receptionist promotion: demote the current one first so the
    // partial unique index (one receptionist per account) never sees
    // two true rows at once. Also clears its `auto_reply_enabled` —
    // migration 053's CHECK constraint would otherwise reject leaving
    // a non-receptionist row with it still true.
    if (promoting) {
      const { error: demoteErr } = await supabase
        .from('ai_agents')
        .update({ is_receptionist: false, auto_reply_enabled: false })
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
 * Deleting the receptionist is allowed — it leaves the account with no
 * receptionist (a valid state, see the PATCH doc comment above), same
 * end result as demoting it first. Deleting the account's only agent
 * is likewise allowed, leaving zero agents; every caller that resolves
 * "the agent for this conversation" already treats "no agent" as a
 * normal case (silent no-op for auto-reply, an empty state in the UI).
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireWrite('admin')
    const { id } = await params

    const { data: existing } = await supabase
      .from('ai_agents')
      .select('id')
      .eq('account_id', accountId)
      .eq('id', id)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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
