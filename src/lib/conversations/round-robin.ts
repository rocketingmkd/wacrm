// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** How many times to re-read the cursor after losing a race to another
 *  conversation that advanced it first. */
const CURSOR_ATTEMPTS = 3

export interface PickNextAgentOptions {
  /** Return null unless the account turned round-robin assignment on.
   *  Left off by callers that were asked to rotate explicitly (an
   *  automation step). */
  requireEnabled?: boolean
  /** When the account has no 'agent'-role member (a solo owner, or only
   *  admins), rotate over every member instead of returning null. */
  fallbackToAnyMember?: boolean
}

/**
 * The next member in line for the account's single rotation, advancing
 * the cursor (`accounts.round_robin_last_agent_id`). Every path that
 * rotates shares that one cursor, so conversations spread evenly no
 * matter whether the webhook or an automation assigns them.
 *
 * The cursor moves with a compare-and-swap: the update only applies if
 * nobody advanced it since it was read, otherwise the cursor is re-read
 * and the pick redone. Two conversations created at the same moment
 * therefore get different agents instead of both reading the same cursor
 * and landing on the same person.
 *
 * Members are ordered by user_id so "next after the cursor" is
 * well-defined even as members come and go between runs. Returns null
 * when nobody is eligible.
 */
export async function pickNextAgent(
  db: Db,
  accountId: string,
  options: PickNextAgentOptions = {},
): Promise<string | null> {
  const { requireEnabled = false, fallbackToAnyMember = false } = options

  let picked: string | null = null

  for (let attempt = 0; attempt < CURSOR_ATTEMPTS; attempt++) {
    const { data: account, error: accountError } = await db
      .from('accounts')
      .select('round_robin_enabled, round_robin_last_agent_id')
      .eq('id', accountId)
      .maybeSingle()

    if (accountError) {
      console.error('[round-robin] account fetch failed:', accountError)
      return null
    }
    if (requireEnabled && !account?.round_robin_enabled) return null

    const members = await loadEligibleMembers(db, accountId, fallbackToAnyMember)
    if (members.length === 0) return null

    const cursor: string | null = account?.round_robin_last_agent_id ?? null
    const lastIndex = members.indexOf(cursor as string)
    picked = members[(lastIndex + 1) % members.length]

    let advance = db
      .from('accounts')
      .update({ round_robin_last_agent_id: picked })
      .eq('id', accountId)
    advance =
      cursor === null
        ? advance.is('round_robin_last_agent_id', null)
        : advance.eq('round_robin_last_agent_id', cursor)
    const { data: advanced, error: cursorError } = await advance.select('id')

    if (cursorError) {
      // Couldn't move the cursor, but the pick itself is valid.
      console.error('[round-robin] cursor update failed:', cursorError)
      return picked
    }
    if (advanced && advanced.length > 0) return picked
    // Someone else advanced the cursor first: re-read and pick again.
  }

  // Heavy contention: hand back the last pick rather than leave the
  // conversation unassigned.
  return picked
}

async function loadEligibleMembers(
  db: Db,
  accountId: string,
  fallbackToAnyMember: boolean,
): Promise<string[]> {
  const base = () =>
    db
      .from('profiles')
      .select('user_id')
      .eq('account_id', accountId)

  const { data: agents, error: agentsError } = await base()
    .eq('account_role', 'agent')
    .order('user_id', { ascending: true })
  if (agentsError) {
    console.error('[round-robin] agents fetch failed:', agentsError)
    return []
  }
  if (agents && agents.length > 0) {
    return agents.map((a: { user_id: string }) => a.user_id)
  }
  if (!fallbackToAnyMember) return []

  const { data: members, error: membersError } = await base().order('user_id', {
    ascending: true,
  })
  if (membersError) {
    console.error('[round-robin] members fetch failed:', membersError)
    return []
  }
  return (members ?? []).map((m: { user_id: string }) => m.user_id)
}

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
  const nextAgentId = await pickNextAgent(db, accountId, { requireEnabled: true })
  if (!nextAgentId) return

  const { error: assignError } = await db
    .from('conversations')
    .update({ assigned_agent_id: nextAgentId })
    .eq('id', conversationId)
  if (assignError) {
    console.error('[round-robin] conversation assign failed:', assignError)
  }
}
