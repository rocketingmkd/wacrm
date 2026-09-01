import { supabaseAdmin } from './admin-client'
import { loadAiAgent, loadReceptionistAgent } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPrompt, type TransferableAgent } from './defaults'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { engineSendText } from '@/lib/flows/meta-send'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { isAccountWriteLocked } from '@/lib/billing/write-lock'
import type { AiConfig, ChatMessage } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'

/** How many agent-to-agent transfers one inbound message may trigger
 *  in a single dispatch before we give up and hand off to a human
 *  instead — prevents two mis-configured agents from ping-ponging a
 *  conversation forever on the account's own BYO key. */
const MAX_TRANSFER_HOPS = 3

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
}

interface ConversationRow {
  assigned_agent_id: string | null
  ai_autoreply_disabled: boolean
  ai_reply_count: number
  active_ai_agent_id: string | null
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any → silent no-op):
 *   - the account is billing write-locked (trial lapsed, expired, canceled)
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - no agent is on duty (no active/receptionist agent, or it's off)
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 *
 * Multi-agent: which agent replies is `conversations.active_ai_agent_id`
 * (falling back to the account's receptionist when unset). If that
 * agent decides to transfer (`[[TRANSFER:<slug>]]`), the conversation
 * is re-dispatched internally to the target agent in the SAME
 * invocation — up to `MAX_TRANSFER_HOPS` times — so the customer gets
 * the right agent's answer in one interaction rather than waiting for
 * their next message. Exceeding the hop limit degrades to a human
 * handoff instead of silently dropping the message.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  try {
    const db = supabaseAdmin()

    // This engine runs entirely on the service-role client, which
    // bypasses RLS — is_account_member()'s write-lock never runs for
    // it, so a billing-locked account must be checked explicitly here.
    if (await isAccountWriteLocked(db, accountId)) return

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count, active_ai_agent_id')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    const conversation = conv as ConversationRow
    if (conversation.assigned_agent_id) return // a human owns this thread
    if (conversation.ai_autoreply_disabled) return // handed off / turned off here

    const agent = conversation.active_ai_agent_id
      ? (await loadAiAgent(db, accountId, conversation.active_ai_agent_id)) ??
        (await loadReceptionistAgent(db, accountId))
      : await loadReceptionistAgent(db, accountId)
    if (!agent || !agent.autoReplyEnabled) return

    // Deterministic, user-configured responders win over the LLM — the
    // caller already excludes messages a Flow consumed. Message-level
    // automations (`new_message_received` / `keyword_match`) are
    // dispatched independently for this same inbound and may send their
    // own reply, so if the account has any active one we stand down to
    // avoid double-texting the customer. (Relationship triggers like
    // `first_inbound_message` don't count — they're not per-message
    // auto-responders.)
    const { data: autoResponders } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(1)
    if (autoResponders && autoResponders.length > 0) return

    // Cheap early-out; the authoritative cap check is the atomic claim
    // inside runAgentTurn (this read can race a concurrent inbound).
    if (conversation.ai_reply_count >= agent.autoReplyMaxPerConversation) return

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
      )
      return
    }

    await runAgentTurn(db, {
      accountId,
      conversationId,
      contactId,
      configOwnerUserId,
      agent,
      messages,
      replyCount: conversation.ai_reply_count ?? 0,
      hopsRemaining: MAX_TRANSFER_HOPS,
    })
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}

interface ActivateAgentArgs {
  accountId: string
  conversationId: string
  contactId: string
  /** Sender-of-record for the outbound send's audit columns. */
  configOwnerUserId: string
  /** The `ai_agents.id` to hand the conversation to. */
  agentId: string
}

/**
 * Explicit "activate this AI agent now" entry point — the Automations
 * `activate_ai_agent` step and the Flows `activate_ai_agent` node both
 * call this. Unlike `dispatchInboundToAiReply` (which reacts silently
 * to an inbound message), this is a deliberate action the account
 * owner configured: it takes the conversation away from whoever holds
 * it (a human, or no one) and has the named agent send its opening
 * reply immediately — there being an unanswered customer message is
 * the whole point of the step, so this throws (rather than silently
 * no-opping) on every failure mode, and the automation/flow engine's
 * own step-failure handling surfaces it.
 */
export async function activateAgentAndReply(args: ActivateAgentArgs): Promise<string> {
  const { accountId, conversationId, contactId, configOwnerUserId, agentId } = args
  const db = supabaseAdmin()

  if (await isAccountWriteLocked(db, accountId)) {
    throw new Error('account is billing-locked')
  }

  const agent = await loadAiAgent(db, accountId, agentId)
  if (!agent) throw new Error('AI agent not found, inactive, or provider not configured')
  if (!agent.autoReplyEnabled) {
    throw new Error(`agent "${agent.name}" has auto-reply disabled`)
  }

  const { data: conv, error: convErr } = await db
    .from('conversations')
    .select('ai_reply_count')
    .eq('id', conversationId)
    .maybeSingle()
  if (convErr || !conv) throw new Error('conversation not found')

  const messages = await buildConversationContext(db, conversationId)
  if (messages.length === 0) {
    throw new Error('no messages in this conversation to reply to yet')
  }

  // Hand the thread to this agent before generating: takes it away
  // from a human (if any) and re-enables auto-reply (in case a prior
  // handoff had disabled it) so the send below — and any future
  // inbound — actually goes through the bot.
  await db
    .from('conversations')
    .update({
      active_ai_agent_id: agent.id,
      ai_autoreply_disabled: false,
      assigned_agent_id: null,
    })
    .eq('id', conversationId)

  await runAgentTurn(db, {
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    agent,
    messages,
    replyCount: (conv as { ai_reply_count: number | null }).ai_reply_count ?? 0,
    hopsRemaining: MAX_TRANSFER_HOPS,
  })

  return `agent "${agent.name}" activated`
}

interface TurnState {
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
  agent: AiConfig
  messages: ChatMessage[]
  /** The conversation's shared reply tally as of the start of this
   *  turn — incremented locally after a successful send so a transfer
   *  chain within one dispatch respects each agent's own cap against
   *  the running total, without an extra round-trip per hop. */
  replyCount: number
  hopsRemaining: number
}

/**
 * Run one agent's turn, following transfers (if any) up to
 * `hopsRemaining` before returning. Never throws — same contract as
 * `dispatchInboundToAiReply`. Also called directly by
 * `activateAgentAndReply` (Automations/Flows "activate AI agent"
 * step/node), which is why it's exported.
 */
export async function runAgentTurn(db: SupabaseClient, state: TurnState): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId, agent, messages, replyCount } =
    state

  if (replyCount >= agent.autoReplyMaxPerConversation) return // this agent's cap is already spent

  // Ground the reply in this agent's own knowledge base (best-effort).
  const knowledge = await retrieveKnowledge(
    db,
    accountId,
    agent.id,
    agent,
    latestUserMessage(messages),
  )

  const siblings = await loadTransferSiblings(db, accountId, agent.id)

  const systemPrompt = buildSystemPrompt({
    userPrompt: agent.systemPrompt,
    mode: 'auto_reply',
    knowledge,
    availableAgents: siblings,
  })

  const { text, handoff, transferToSlug, usage } = await generateReply({
    config: agent,
    systemPrompt,
    messages,
  })

  // Record token spend on the account's BYO key. Fire-and-forget so it
  // never adds latency to the customer-facing send: `logAiUsage`
  // swallows its own errors, so the floating promise can't reject.
  // Logged regardless of outcome — the provider call happened either way.
  void logAiUsage(db, {
    accountId,
    conversationId,
    mode: 'auto_reply',
    provider: agent.provider,
    model: agent.model,
    agentId: agent.id,
    usage,
  })

  const target = transferToSlug
    ? siblings.find((s) => s.slug === transferToSlug)
    : undefined

  if (target && state.hopsRemaining > 0) {
    let nextReplyCount = state.replyCount
    // The model may leave a short lead-in before the marker (e.g. "let
    // me get you the right person") — send it as a normal message if
    // so; a bare marker (empty text after parsing) sends nothing.
    if (text) {
      nextReplyCount = await claimAndSend(db, {
        accountId,
        conversationId,
        contactId,
        configOwnerUserId,
        text,
        maxReplies: agent.autoReplyMaxPerConversation,
        replyCountBefore: state.replyCount,
      })
    }

    await db
      .from('conversations')
      .update({ active_ai_agent_id: target.id })
      .eq('id', conversationId)

    const nextAgent = await loadAiAgent(db, accountId, target.id)
    // Defensive: siblings was filtered to active+auto_reply_enabled
    // agents moments ago, but a concurrent edit could have turned the
    // target off in between — fall back to a human handoff rather than
    // silently dropping the transfer.
    if (nextAgent && nextAgent.autoReplyEnabled) {
      // Re-fetch the transcript so the next agent sees the message
      // that was just sent (if any), not a stale copy.
      const nextMessages = text
        ? await buildConversationContext(db, conversationId)
        : state.messages
      await runAgentTurn(db, {
        ...state,
        agent: nextAgent,
        messages: nextMessages,
        replyCount: nextReplyCount,
        hopsRemaining: state.hopsRemaining - 1,
      })
      return
    }
  }

  const hopLimitExceeded = Boolean(target) && state.hopsRemaining <= 0

  if (handoff || hopLimitExceeded || !text) {
    // The model can't (or shouldn't) answer — or a transfer chain ran
    // out of hops — so stop auto-replying on this thread and hand it to
    // a human. We (a) pause the bot here (sticky until re-enabled), (b)
    // route the conversation to the CURRENT agent's configured handoff
    // target — null leaves it in the shared queue — and (c) leave a
    // short internal note so whoever picks it up has context. Assigning
    // fires the `on_conversation_assigned` trigger, which notifies the
    // agent.
    const summary = buildHandoffSummary({
      messages,
      replyCount: state.replyCount,
    })
    const update: Record<string, unknown> = {
      ai_autoreply_disabled: true,
      ai_handoff_summary: hopLimitExceeded
        ? `${summary} (transfer loop hit the ${MAX_TRANSFER_HOPS}-hop limit — routed to a human instead.)`
        : summary,
    }
    // Only set the assignee when a target is configured — the thread
    // is guaranteed unowned here: `dispatchInboundToAiReply` already
    // returned early if a human was assigned, and nothing in this
    // function's own path assigns one before this point.
    if (agent.handoffAgentId) {
      update.assigned_agent_id = agent.handoffAgentId
    }
    await db.from('conversations').update(update).eq('id', conversationId)
    return
  }

  await claimAndSend(db, {
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    text,
    maxReplies: agent.autoReplyMaxPerConversation,
    replyCountBefore: state.replyCount,
  })
}

/**
 * Atomically claim a reply slot and send, mirroring the pre-multi-agent
 * behaviour exactly: the cap check + increment happen in one UPDATE, so
 * concurrent inbounds can never overshoot the cap. If another inbound
 * just took the last slot, the claim fails and nothing is sent. Returns
 * the reply count to assume for the rest of this dispatch (incremented
 * only when the claim succeeded).
 */
async function claimAndSend(
  db: SupabaseClient,
  args: {
    accountId: string
    conversationId: string
    contactId: string
    configOwnerUserId: string
    text: string
    maxReplies: number
    replyCountBefore: number
  },
): Promise<number> {
  const { data: claimed, error: claimErr } = await db.rpc('claim_ai_reply_slot', {
    conversation_id: args.conversationId,
    max_replies: args.maxReplies,
  })
  if (claimErr) {
    // A real error here (vs. losing the cap race) is almost always a
    // deploy issue — e.g. `claim_ai_reply_slot` not EXECUTE-able by the
    // service role, or the migration not applied. Log it loudly: a
    // silent return makes "auto-reply never fires" undiagnosable.
    console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
    return args.replyCountBefore
  }
  if (claimed !== true) return args.replyCountBefore // lost the per-conversation cap race

  await engineSendText({
    accountId: args.accountId,
    userId: args.configOwnerUserId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    text: args.text,
    aiGenerated: true,
  })
  return args.replyCountBefore + 1
}

/** Active, auto-reply-enabled sibling agents this account's agent
 *  could transfer to — feeds both the transfer-menu prompt block and
 *  the dispatcher's slug→agent resolution. Naturally empty on a
 *  single-agent (Starter) account, which keeps behaviour identical to
 *  the pre-multi-agent bot with zero extra branching. */
async function loadTransferSiblings(
  db: SupabaseClient,
  accountId: string,
  currentAgentId: string,
): Promise<TransferableAgent[]> {
  const { data, error } = await db
    .from('ai_agents')
    .select('id, slug, name, description')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .eq('auto_reply_enabled', true)
    .neq('id', currentAgentId)
  if (error || !data) return []
  return data as TransferableAgent[]
}
