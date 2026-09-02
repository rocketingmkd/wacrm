import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Notify the account's team that the AI stopped auto-replying on a
 * conversation and it needs a human.
 *
 * Why this exists: the AI engine only sets `conversations.assigned_agent_id`
 * on handoff when the answering agent has a `handoffAgentId` (a specific
 * human queue). Without one, the thread just goes quiet — the
 * `on_conversation_assigned` trigger (migration 027) never fires, so no
 * one is told. This fills that gap by writing an `ai_handed_off`
 * notification for every owner/admin/agent on the account.
 *
 * When a queue WAS assigned, that trigger already notified the right
 * person — we skip, to avoid double-pinging.
 *
 * Best-effort: swallows and logs its own errors. Runs on the service-
 * role client, which bypasses the `notifications` insert RLS (rows are
 * otherwise trigger-only).
 */
export async function notifyHandoffToTeam(
  db: SupabaseClient,
  args: {
    accountId: string
    conversationId: string
    contactId: string
    /** The human queue the engine assigned, if any. Set → skip. */
    assignedAgentId: string | null
    /** `conversations.ai_handoff_summary` — the note the bot left. */
    summary: string | null
  },
): Promise<void> {
  try {
    if (args.assignedAgentId) return

    const { data: members, error: membersErr } = await db
      .from('profiles')
      .select('user_id')
      .eq('account_id', args.accountId)
      .in('account_role', ['owner', 'admin', 'agent'])
    if (membersErr) {
      console.error('[ai handoff] member lookup failed:', membersErr)
      return
    }
    if (!members || members.length === 0) return

    const { data: contact } = await db
      .from('contacts')
      .select('name, phone')
      .eq('id', args.contactId)
      .maybeSingle()
    const who = contact?.name || contact?.phone || 'um contato'

    const body = args.summary
      ? `Conversa com ${who}. ${args.summary}`
      : `A IA encerrou o atendimento automático da conversa com ${who}.`

    const rows = members.map((m) => ({
      account_id: args.accountId,
      user_id: m.user_id as string,
      type: 'ai_handed_off',
      conversation_id: args.conversationId,
      contact_id: args.contactId,
      actor_user_id: null,
      title: 'IA transferiu para atendimento humano',
      body,
    }))

    const { error: insErr } = await db.from('notifications').insert(rows)
    if (insErr) console.error('[ai handoff] notification insert failed:', insErr)
  } catch (err) {
    console.error('[ai handoff] notifyHandoffToTeam failed:', err)
  }
}
