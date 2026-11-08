/**
 * Forward-only delivery status.
 *
 * Meta's status webhooks arrive out of order and get replayed: a `sent`
 * can land after the `read` of the same message. A status must therefore
 * only ever move up its ladder, never back down.
 *
 * `failed` is not a rung. It is a terminal side branch that is valid only
 * from the first two states (`pending`/`sending`, then `sent`). Once Meta
 * has delivered, or the user has read or replied, a later "failed" event
 * is a bug in Meta's pipeline or a spoof attempt and is ignored.
 */

export type StatusLadder = readonly string[];

/** `messages.status` (the column's CHECK allows these plus `failed`). */
export const MESSAGE_STATUS_LADDER = ['sending', 'sent', 'delivered', 'read'] as const;

/** `broadcast_recipients.status`. */
export const RECIPIENT_STATUS_LADDER = ['pending', 'sent', 'delivered', 'read', 'replied'] as const;

/** Can a row at `current` move to `incoming` on this ladder? */
export function isValidStatusTransition(
  ladder: StatusLadder,
  current: string,
  incoming: string
): boolean {
  if (incoming === 'failed') {
    return current === ladder[0] || current === ladder[1];
  }
  if (current === 'failed') return false; // failed is terminal

  const incomingLevel = ladder.indexOf(incoming);
  if (incomingLevel < 0) return false; // not a status this ladder knows
  const currentLevel = ladder.indexOf(current);
  if (currentLevel < 0) return true; // unknown current: accept anything on the ladder
  return incomingLevel > currentLevel;
}

/**
 * Every status a row may currently hold for a move to `incoming` to be
 * valid. Empty when `incoming` is not a status the ladder knows. Used as
 * `.in('status', ...)` on the UPDATE itself, so the transition is checked
 * atomically instead of by a read followed by a write that a concurrent
 * webhook could slip between.
 */
export function statusesBefore(ladder: StatusLadder, incoming: string): string[] {
  return ladder.filter((status) => isValidStatusTransition(ladder, status, incoming));
}
