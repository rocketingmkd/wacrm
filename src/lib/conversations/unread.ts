import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Count one more unread inbound message on a conversation.
 *
 * Done in the database (`increment_conversation_unread`, migration 081)
 * so two messages processed at the same moment each add one. A read of
 * the count followed by a write of count + 1 lets both read N and both
 * write N + 1, losing a message.
 *
 * If the function isn't there yet (migration not applied) or the call
 * fails, fall back to that read-then-write using the count the caller
 * already has: a rare lost count beats not counting the message at all.
 */
export async function incrementUnread(
  db: SupabaseClient,
  conversationId: string,
  currentCount: number | null | undefined
): Promise<void> {
  const { error } = await db.rpc('increment_conversation_unread', {
    p_conversation_id: conversationId,
  })
  if (!error) return

  console.error('[unread] atomic increment failed, falling back to read-then-write:', error)
  const { error: fallbackError } = await db
    .from('conversations')
    .update({ unread_count: (currentCount ?? 0) + 1 })
    .eq('id', conversationId)
  if (fallbackError) console.error('[unread] fallback update failed:', fallbackError)
}
