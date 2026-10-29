import { describe, it, expect } from "vitest";
import {
  CONVERSATIONS_PAGE_SIZE,
  FILTERED_MIN_VISIBLE,
  blockHasMore,
  compareConversations,
  mergeConversations,
  shouldAutoLoadMore,
  sortConversations,
} from "./conversations";
import type { Conversation } from "@/types";

const conv = (id: string, last: string | undefined, created: string) => ({
  id,
  last_message_at: last,
  created_at: created,
});

describe("sortConversations", () => {
  it("puts the most recent message first", () => {
    const sorted = sortConversations([
      conv("old", "2026-10-01T10:00:00Z", "2026-09-01T00:00:00Z"),
      conv("new", "2026-10-28T10:00:00Z", "2026-09-02T00:00:00Z"),
      conv("mid", "2026-10-15T10:00:00Z", "2026-09-03T00:00:00Z"),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["new", "mid", "old"]);
  });

  it("puts conversations without a message date last", () => {
    const sorted = sortConversations([
      conv("none", undefined, "2026-10-28T00:00:00Z"),
      conv("dated", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["dated", "none"]);
  });

  it("breaks ties by created_at desc, including among undated rows", () => {
    const sorted = sortConversations([
      conv("a", undefined, "2026-10-01T00:00:00Z"),
      conv("b", undefined, "2026-10-20T00:00:00Z"),
      conv("c", "2026-10-05T00:00:00Z", "2026-08-01T00:00:00Z"),
      conv("d", "2026-10-05T00:00:00Z", "2026-09-01T00:00:00Z"),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["d", "c", "b", "a"]);
  });

  it("compares dates by instant, not by string", () => {
    // Same instant in different offsets: falls through to created_at.
    expect(
      compareConversations(
        conv("a", "2026-10-28T10:00:00+00:00", "2026-01-01T00:00:00Z"),
        conv("b", "2026-10-28T07:00:00-03:00", "2026-02-01T00:00:00Z"),
      ),
    ).toBeGreaterThan(0);
  });

  it("does not mutate the input and a message bumps a chat to the top", () => {
    const input = [
      conv("a", "2026-10-28T10:00:00Z", "2026-01-01T00:00:00Z"),
      conv("b", "2026-10-27T10:00:00Z", "2026-01-01T00:00:00Z"),
    ];
    const bumped = sortConversations(
      input.map((c) =>
        c.id === "b" ? { ...c, last_message_at: "2026-10-28T11:00:00Z" } : c,
      ),
    );
    expect(bumped.map((c) => c.id)).toEqual(["b", "a"]);
    expect(input.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

const full = (id: string, last: string | undefined, created: string, extra = {}) =>
  ({
    ...conv(id, last, created),
    user_id: "u",
    contact_id: "ct",
    status: "open",
    unread_count: 0,
    updated_at: "",
    ...extra,
  }) as Conversation;

describe("sortConversations pinnedId", () => {
  it("keeps an open dateless conversation on top", () => {
    const list = [
      conv("dated", "2026-10-28T00:00:00Z", "2026-01-01T00:00:00Z"),
      conv("fresh", undefined, "2026-10-28T12:00:00Z"),
    ];
    expect(sortConversations(list).map((c) => c.id)).toEqual(["dated", "fresh"]);
    expect(sortConversations(list, "fresh").map((c) => c.id)).toEqual([
      "fresh",
      "dated",
    ]);
  });

  it("does not pin a conversation that already has a message date", () => {
    const list = [
      conv("new", "2026-10-28T00:00:00Z", "2026-01-01T00:00:00Z"),
      conv("old", "2026-10-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    ];
    expect(sortConversations(list, "old").map((c) => c.id)).toEqual(["new", "old"]);
  });
});

describe("mergeConversations", () => {
  const current = [
    full("a", "2026-10-28T10:00:00Z", "2026-01-01T00:00:00Z", { unread_count: 3 }),
    full("b", "2026-10-27T10:00:00Z", "2026-01-01T00:00:00Z"),
  ];
  const incoming = [
    full("b", "2026-10-27T10:00:00Z", "2026-01-01T00:00:00Z", { unread_count: 9 }),
    full("c", "2026-10-26T10:00:00Z", "2026-01-01T00:00:00Z"),
  ];

  it("appends a page without duplicating and keeps the copy in state", () => {
    const out = mergeConversations(current, incoming, { preferIncoming: false });
    expect(out.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(out.find((c) => c.id === "b")?.unread_count).toBe(0);
  });

  it("on resync the server copy wins and extra local rows survive", () => {
    const local = [...current, full("new", undefined, "2026-10-28T12:00:00Z")];
    const out = mergeConversations(local, incoming, { preferIncoming: true });
    expect(out.map((c) => c.id)).toEqual(["a", "b", "c", "new"]);
    expect(out.find((c) => c.id === "b")?.unread_count).toBe(9);
  });

  it("pins the open dateless chat through a merge", () => {
    const local = [...current, full("new", undefined, "2026-10-28T12:00:00Z")];
    const out = mergeConversations(local, incoming, {
      preferIncoming: true,
      pinnedId: "new",
    });
    expect(out[0].id).toBe("new");
  });
});

describe("paging decisions", () => {
  it("only a full block means there may be more", () => {
    expect(blockHasMore(CONVERSATIONS_PAGE_SIZE)).toBe(true);
    expect(blockHasMore(CONVERSATIONS_PAGE_SIZE - 1)).toBe(false);
    expect(blockHasMore(0)).toBe(false);
  });

  const base = {
    hasMore: true,
    loading: false,
    loadingMore: false,
    searching: false,
    filtering: false,
    filteredCount: 100,
  };

  it("does not auto-load for plain scrolling", () => {
    expect(shouldAutoLoadMore(base)).toBe(false);
  });

  it("loads everything while searching", () => {
    expect(shouldAutoLoadMore({ ...base, searching: true })).toBe(true);
  });

  it("loads more while a filter leaves the list short, then stops", () => {
    const f = { ...base, filtering: true };
    expect(shouldAutoLoadMore({ ...f, filteredCount: FILTERED_MIN_VISIBLE - 1 })).toBe(true);
    expect(shouldAutoLoadMore({ ...f, filteredCount: FILTERED_MIN_VISIBLE })).toBe(false);
  });

  it("never loads at the end, while loading, or with a request in flight", () => {
    const s = { ...base, searching: true };
    expect(shouldAutoLoadMore({ ...s, hasMore: false })).toBe(false);
    expect(shouldAutoLoadMore({ ...s, loading: true })).toBe(false);
    expect(shouldAutoLoadMore({ ...s, loadingMore: true })).toBe(false);
  });
});
