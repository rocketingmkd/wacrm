import type { Conversation, Contact, Tag } from "@/types";

/**
 * Conversation select that embeds the contact plus its tags, so the Inbox
 * can filter conversations by contact tag without a second round-trip.
 * `contact_tags(tags(*))` returns the join rows; {@link normalizeConversation}
 * flattens them onto `contact.tags`.
 */
export const CONVERSATION_SELECT =
  "*, contact:contacts(*, contact_tags(tags(*)))";

/**
 * Rows per request when loading the inbox. The list opens with one block
 * and fetches the next as the user scrolls (`.range`). Must stay below
 * PostgREST's `max_rows` (default 1000) or a "full" block would look short
 * and stop the paging early.
 */
export const CONVERSATIONS_PAGE_SIZE = 100;

/** While a tab/filter is active, keep loading until it shows at least this many. */
export const FILTERED_MIN_VISIBLE = 30;

/** A block smaller than the page size means the server has no more rows. */
export function blockHasMore(rowsInBlock: number): boolean {
  return rowsInBlock >= CONVERSATIONS_PAGE_SIZE;
}

function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * Inbox order: most recent message first, conversations without a message
 * date last (Postgres DESC would put NULL first), `created_at` desc as the
 * tiebreaker. Mirrors the server query so a client-side re-sort after a
 * realtime event gives the same order as a fresh load.
 */
export function compareConversations(
  a: Pick<Conversation, "last_message_at" | "created_at">,
  b: Pick<Conversation, "last_message_at" | "created_at">,
): number {
  const am = timeOf(a.last_message_at);
  const bm = timeOf(b.last_message_at);
  if (am !== bm) {
    if (am === null) return 1;
    if (bm === null) return -1;
    return bm - am;
  }
  return (timeOf(b.created_at) ?? 0) - (timeOf(a.created_at) ?? 0);
}

/**
 * Returns a new array in inbox order (stable for ties). `pinnedId` keeps one
 * dateless conversation (a "Nova conversa" the user has open) at the top
 * instead of letting the re-sort push it to the end while it is on screen.
 */
export function sortConversations<
  T extends Pick<Conversation, "id" | "last_message_at" | "created_at">,
>(list: T[], pinnedId?: string | null): T[] {
  const sorted = [...list].sort(compareConversations);
  if (!pinnedId) return sorted;
  const i = sorted.findIndex((c) => c.id === pinnedId);
  if (i <= 0 || timeOf(sorted[i].last_message_at) !== null) return sorted;
  const [pinned] = sorted.splice(i, 1);
  return [pinned, ...sorted];
}

/**
 * Merge a freshly fetched block into the current list without duplicating.
 * `preferIncoming: true` (resync) lets the server copy win; false (scroll
 * paging) keeps the copy already in state, which realtime may have made
 * fresher than the row the offset query just read. Rows only in `current`
 * (hydrated by realtime, or a brand-new chat) are kept.
 */
export function mergeConversations(
  current: Conversation[],
  incoming: Conversation[],
  { preferIncoming, pinnedId }: { preferIncoming: boolean; pinnedId?: string | null },
): Conversation[] {
  const byId = new Map<string, Conversation>();
  for (const c of current) byId.set(c.id, c);
  for (const c of incoming) {
    if (preferIncoming || !byId.has(c.id)) byId.set(c.id, c);
  }
  return sortConversations([...byId.values()], pinnedId);
}

export interface LoadMoreInput {
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  /** Search text typed: results must cover the whole inbox. */
  searching: boolean;
  /** A tab, tag or company filter is narrowing the list. */
  filtering: boolean;
  filteredCount: number;
}

/**
 * Whether the list should fetch the next block on its own (without a scroll).
 * Search needs every conversation; a narrowing filter needs enough matches to
 * fill the screen. Plain scrolling is handled by the end-of-list sentinel.
 */
export function shouldAutoLoadMore(i: LoadMoreInput): boolean {
  if (!i.hasMore || i.loading || i.loadingMore) return false;
  if (i.searching) return true;
  return i.filtering && i.filteredCount < FILTERED_MIN_VISIBLE;
}

/** Raw shape returned by {@link CONVERSATION_SELECT} before flattening. */
type RawContact = Contact & { contact_tags?: { tags: Tag | null }[] };
type RawConversation = Omit<Conversation, "contact"> & {
  contact?: RawContact | null;
};

/**
 * Flatten the embedded `contact_tags(tags(*))` join into `contact.tags`.
 * Safe to call on rows fetched with {@link CONVERSATION_SELECT}; a row with
 * no contact (e.g. a freshly-inserted conversation) passes through untouched.
 */
export function normalizeConversation(raw: RawConversation): Conversation {
  const rawContact = raw.contact;
  if (!rawContact) return raw as Conversation;

  const { contact_tags, ...contact } = rawContact;
  return {
    ...raw,
    contact: {
      ...contact,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tags)
        .filter((t): t is Tag => t != null),
    },
  };
}

export function normalizeConversations(
  rows: RawConversation[],
): Conversation[] {
  return rows.map(normalizeConversation);
}

export interface ContactFilters {
  /** Tag ids; a conversation matches if its contact has ANY of them (OR). */
  tagIds: string[];
  /** Exact company match, or null for no company filter. */
  company: string | null;
}

/**
 * Whether a conversation passes the contact-based Inbox filters (issue #272).
 * Empty `tagIds` and null `company` are no-ops, so the default (no filters)
 * always matches. Tags use OR logic, consistent with Broadcast audiences.
 */
export function matchesContactFilters(
  conversation: Conversation,
  { tagIds, company }: ContactFilters,
): boolean {
  if (tagIds.length > 0) {
    const contactTagIds = conversation.contact?.tags ?? [];
    if (!contactTagIds.some((t) => tagIds.includes(t.id))) return false;
  }

  if (company !== null && conversation.contact?.company?.trim() !== company) {
    return false;
  }

  return true;
}
