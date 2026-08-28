// ============================================================
// Copilot insight refresh — the orchestrator behind both entry points:
//   - POST /api/ai/copilot           (seller opened the thread / hit refresh)
//   - the WhatsApp webhook           (new customer message after a gap)
//
// Always runs on the SERVICE ROLE client: the webhook has no auth.uid(),
// and conversation_insights has no authenticated INSERT policy (writes
// are service-role only). The route verifies account ownership before
// calling in.
//
// Cost control lives here: an analysis is skipped entirely unless the
// conversation actually moved since the last one (msg_count_at_gen), or
// the caller forces it. On any provider failure we keep the previous
// insight rather than surfacing an error into the inbox.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { latestUserMessage } from './query'
import { logAiUsage } from './usage'
import { generateCopilotInsight, type CopilotContext, type CopilotInsight } from './copilot'
import { AiError } from './types'

export interface ConversationInsightRow {
  insight: CopilotInsight
  generatedAt: string
  msgCountAtGen: number
  provider: string | null
  model: string | null
}

interface RefreshArgs {
  conversationId: string
  /** Recompute even when the message count hasn't moved. */
  force?: boolean
}

/**
 * Fetch (and, when stale or forced, regenerate) the cached copilot
 * insight for a conversation. Returns null only when the conversation
 * doesn't exist or there's nothing to analyze yet AND no prior insight.
 */
export async function refreshConversationInsight(
  db: SupabaseClient,
  { conversationId, force = false }: RefreshArgs,
): Promise<ConversationInsightRow | null> {
  const { data: conversation, error: convErr } = await db
    .from('conversations')
    .select('id, account_id, contact_id')
    .eq('id', conversationId)
    .maybeSingle()
  if (convErr || !conversation) return null

  const accountId = conversation.account_id as string
  const contactId = conversation.contact_id as string | null

  const [{ count: liveCount }, { data: existingRow }] = await Promise.all([
    db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('content_type', 'text'),
    db
      .from('conversation_insights')
      .select('payload, generated_at, msg_count_at_gen, provider, model')
      .eq('conversation_id', conversationId)
      .maybeSingle(),
  ])

  const existing: ConversationInsightRow | null = existingRow
    ? {
        insight: existingRow.payload as CopilotInsight,
        generatedAt: existingRow.generated_at as string,
        msgCountAtGen: (existingRow.msg_count_at_gen as number) ?? 0,
        provider: (existingRow.provider as string) ?? null,
        model: (existingRow.model as string) ?? null,
      }
    : null

  const currentCount = liveCount ?? 0
  if (!force && existing && existing.msgCountAtGen >= currentCount) {
    return existing
  }

  // Not configured / master switch off → leave whatever's cached.
  const config = await loadAiConfig(db, accountId).catch(() => null)
  if (!config) return existing

  const messages = await buildConversationContext(db, conversationId).catch(() => [])
  if (messages.length === 0) return existing

  const context = await buildCopilotContext(db, {
    accountId,
    conversationId,
    contactId,
    businessPrompt: config.systemPrompt,
    latestQuestion: latestUserMessage(messages),
    embeddingsApiKey: config.embeddingsApiKey,
  })

  let insight: CopilotInsight
  let usage
  try {
    const result = await generateCopilotInsight({ config, messages, context })
    insight = result.insight
    usage = result.usage
  } catch (err) {
    if (err instanceof AiError) {
      console.error('[copilot] generation failed:', err.code, err.message)
      return existing
    }
    throw err
  }

  const { error: upsertErr } = await db.from('conversation_insights').upsert(
    {
      conversation_id: conversationId,
      account_id: accountId,
      payload: insight,
      msg_count_at_gen: currentCount,
      provider: config.provider,
      model: config.model,
      generated_at: new Date().toISOString(),
    },
    { onConflict: 'conversation_id' },
  )
  if (upsertErr) {
    console.error('[copilot] insight upsert failed:', upsertErr.message)
    return existing
  }

  try {
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'copilot',
      provider: config.provider,
      model: config.model,
      usage,
    })
  } catch (logErr) {
    console.error('[copilot] usage log skipped:', logErr)
  }

  return {
    insight,
    generatedAt: new Date().toISOString(),
    msgCountAtGen: currentCount,
    provider: config.provider,
    model: config.model,
  }
}

async function buildCopilotContext(
  db: SupabaseClient,
  args: {
    accountId: string
    conversationId: string
    contactId: string | null
    businessPrompt: string | null
    latestQuestion: string
    embeddingsApiKey: string | null
  },
): Promise<CopilotContext> {
  const { accountId, conversationId, contactId, businessPrompt, latestQuestion } = args

  const [pipelineRes, dealRes, tagsRes, knowledge] = await Promise.all([
    // Account's main (oldest) pipeline + its stages, in order. Mirrors
    // the "first pipeline" simplification used across the app.
    db
      .from('pipelines')
      .select('id')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
      .then(async ({ data: pipeline }) => {
        if (!pipeline?.id) return [] as { name: string }[]
        const { data: stages } = await db
          .from('pipeline_stages')
          .select('name, position')
          .eq('pipeline_id', pipeline.id)
          .order('position', { ascending: true })
        return (stages ?? []) as { name: string; position: number }[]
      }),
    db
      .from('deals')
      .select('value, currency, stage:pipeline_stages(name)')
      .eq('conversation_id', conversationId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    contactId
      ? db
          .from('contact_tags')
          .select('tags(name)')
          .eq('contact_id', contactId)
      : Promise.resolve({ data: [] as { tags: { name: string } | null }[] }),
    retrieveKnowledge(
      db,
      accountId,
      { embeddingsApiKey: args.embeddingsApiKey },
      latestQuestion,
    ).catch(() => [] as string[]),
  ])

  const stageNames = (pipelineRes as { name: string }[]).map((s) => s.name)

  const dealRow = dealRes.data as
    | { value: number; currency: string | null; stage: { name: string } | null }
    | null
  const deal = dealRow
    ? {
        stageName: dealRow.stage?.name ?? null,
        value: Number(dealRow.value) || 0,
        currency: dealRow.currency,
      }
    : null

  const contactTags = ((tagsRes.data ?? []) as { tags: { name: string } | null }[])
    .map((r) => r.tags?.name)
    .filter((n): n is string => Boolean(n))

  return { businessPrompt, stageNames, deal, contactTags, knowledge }
}
