// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/**
 * If the account has round-robin assignment turned on, assign
 * `conversationId` to the next 'agent'-role member in line and
 * advance the rotation cursor. No-op when the setting is off or the
 * account has no 'agent'-role members yet.
 *
 * Only meant to run once, right when a conversation is first
 * created (see the webhook's `convResult.created` branch) — it does
 * not check whether the conversation already has an assignee.
 */
export async function maybeAssignRoundRobin(
  db: Db,
  accountId: string,
  conversationId: string,
): Promise<void> {
  const { data: account, error: accountError } = await db
    .from('accounts')
    .select('round_robin_enabled, round_robin_last_agent_id')
    .eq('id', accountId)
    .maybeSingle()

  if (accountError) {
    console.error('[round-robin] account fetch failed:', accountError)
    return
  }
  if (!account?.round_robin_enabled) return

  // Stable order (by user_id) so "next after the cursor" is
  // well-defined even as members are added/removed between runs.
  const { data: agents, error: agentsError } = await db
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
    .eq('account_role', 'agent')
    .order('user_id', { ascending: true })

  if (agentsError) {
    console.error('[round-robin] agents fetch failed:', agentsError)
    return
  }
  if (!agents || agents.length === 0) return

  const lastIndex = agents.findIndex(
    (a: { user_id: string }) => a.user_id === account.round_robin_last_agent_id,
  )
  const nextAgent = agents[(lastIndex + 1) % agents.length]

  const { error: cursorError } = await db
    .from('accounts')
    .update({ round_robin_last_agent_id: nextAgent.user_id })
    .eq('id', accountId)
  if (cursorError) {
    console.error('[round-robin] cursor update failed:', cursorError)
  }

  const { error: assignError } = await db
    .from('conversations')
    .update({ assigned_agent_id: nextAgent.user_id })
    .eq('id', conversationId)
  if (assignError) {
    console.error('[round-robin] conversation assign failed:', assignError)
  }
}
