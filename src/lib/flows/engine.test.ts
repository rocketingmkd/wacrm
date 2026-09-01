import { describe, it, expect } from "vitest";
import {
  matchReplyId,
  matchesKeywordTrigger,
  matchesEventTrigger,
  selectEntryFlow,
  selectEntryFlowForEvent,
  isAutoAdvancing,
  isSuspending,
  isTerminal,
  evaluateConditionPredicate,
} from "./engine";
import type { FlowEvent, FlowTriggerType } from "./types";

describe("matchReplyId", () => {
  it("returns null for nodes without options", () => {
    expect(
      matchReplyId({ node_type: "start", config: { next_node_key: "x" } }, "y"),
    ).toBeNull();
    expect(
      matchReplyId({ node_type: "send_message", config: {} }, "y"),
    ).toBeNull();
    expect(matchReplyId({ node_type: "end", config: {} }, "y")).toBeNull();
  });

  it("matches the buttons array on a send_buttons node", () => {
    const node = {
      node_type: "send_buttons",
      config: {
        text: "Pick one",
        buttons: [
          { reply_id: "yes", title: "Yes", next_node_key: "confirmed" },
          { reply_id: "no", title: "No", next_node_key: "declined" },
        ],
      },
    };
    expect(matchReplyId(node, "yes")).toBe("confirmed");
    expect(matchReplyId(node, "no")).toBe("declined");
  });

  it("returns null when no button reply_id matches", () => {
    const node = {
      node_type: "send_buttons",
      config: {
        text: "Pick",
        buttons: [
          { reply_id: "a", title: "A", next_node_key: "to_a" },
          { reply_id: "b", title: "B", next_node_key: "to_b" },
        ],
      },
    };
    expect(matchReplyId(node, "c")).toBeNull();
    expect(matchReplyId(node, "")).toBeNull();
  });

  it("searches across all sections in a send_list node", () => {
    const node = {
      node_type: "send_list",
      config: {
        text: "Pick an order",
        button_label: "View",
        sections: [
          {
            title: "Recent",
            rows: [
              { reply_id: "o1", title: "Order 1", next_node_key: "ord_1" },
            ],
          },
          {
            title: "Older",
            rows: [
              { reply_id: "o2", title: "Order 2", next_node_key: "ord_2" },
              { reply_id: "o3", title: "Order 3", next_node_key: "ord_3" },
            ],
          },
        ],
      },
    };
    expect(matchReplyId(node, "o1")).toBe("ord_1");
    expect(matchReplyId(node, "o2")).toBe("ord_2");
    expect(matchReplyId(node, "o3")).toBe("ord_3");
    expect(matchReplyId(node, "o99")).toBeNull();
  });

  it("returns null when send_list has no sections / empty sections", () => {
    expect(
      matchReplyId(
        { node_type: "send_list", config: { text: "x", sections: [] } },
        "x",
      ),
    ).toBeNull();
    expect(
      matchReplyId(
        {
          node_type: "send_list",
          config: { text: "x", sections: [{ rows: [] }] },
        },
        "x",
      ),
    ).toBeNull();
  });
});

describe("matchesKeywordTrigger", () => {
  it("returns false for empty text", () => {
    expect(matchesKeywordTrigger("", { keywords: ["hi"] })).toBe(false);
  });

  it("returns false when keywords array is empty", () => {
    expect(matchesKeywordTrigger("anything", { keywords: [] })).toBe(false);
  });

  it("default match_type='contains' does case-insensitive substring", () => {
    const cfg = { keywords: ["support"] };
    expect(matchesKeywordTrigger("I need SUPPORT please", cfg)).toBe(true);
    expect(matchesKeywordTrigger("Support is great", cfg)).toBe(true);
    expect(matchesKeywordTrigger("Help me", cfg)).toBe(false);
  });

  it("match_type='exact' compares the whole string case-insensitively", () => {
    const cfg = { keywords: ["help"], match_type: "exact" as const };
    expect(matchesKeywordTrigger("help", cfg)).toBe(true);
    expect(matchesKeywordTrigger("HELP", cfg)).toBe(true);
    expect(matchesKeywordTrigger("help me", cfg)).toBe(false);
  });

  it("case_sensitive=true preserves case", () => {
    const cfg = {
      keywords: ["Support"],
      case_sensitive: true,
    };
    expect(matchesKeywordTrigger("I need Support", cfg)).toBe(true);
    expect(matchesKeywordTrigger("I need support", cfg)).toBe(false);
  });

  it("matches any one of multiple keywords", () => {
    const cfg = { keywords: ["help", "support", "issue"] };
    expect(matchesKeywordTrigger("I have an issue", cfg)).toBe(true);
    expect(matchesKeywordTrigger("I need Help!", cfg)).toBe(true);
    expect(matchesKeywordTrigger("nothing to see here", cfg)).toBe(false);
  });

  it("skips empty strings in the keywords array", () => {
    const cfg = { keywords: ["", "support", ""] };
    expect(matchesKeywordTrigger("support center", cfg)).toBe(true);
    expect(matchesKeywordTrigger("nope", cfg)).toBe(false);
  });
});

describe("node classification helpers", () => {
  it("isAutoAdvancing covers start + send_message + send_media + condition + set_tag", () => {
    expect(isAutoAdvancing("start")).toBe(true);
    expect(isAutoAdvancing("send_message")).toBe(true);
    expect(isAutoAdvancing("send_media")).toBe(true);
    expect(isAutoAdvancing("condition")).toBe(true);
    expect(isAutoAdvancing("set_tag")).toBe(true);
    expect(isAutoAdvancing("send_buttons")).toBe(false);
    expect(isAutoAdvancing("send_list")).toBe(false);
    expect(isAutoAdvancing("collect_input")).toBe(false);
    expect(isAutoAdvancing("handoff")).toBe(false);
    expect(isAutoAdvancing("end")).toBe(false);
  });

  it("isSuspending covers the input-requiring nodes", () => {
    expect(isSuspending("send_buttons")).toBe(true);
    expect(isSuspending("send_list")).toBe(true);
    expect(isSuspending("collect_input")).toBe(true);
    expect(isSuspending("start")).toBe(false);
    expect(isSuspending("send_message")).toBe(false);
    expect(isSuspending("condition")).toBe(false);
    expect(isSuspending("set_tag")).toBe(false);
    expect(isSuspending("handoff")).toBe(false);
    expect(isSuspending("end")).toBe(false);
  });

  it("isTerminal covers handoff + activate_ai_agent + end", () => {
    expect(isTerminal("handoff")).toBe(true);
    expect(isTerminal("activate_ai_agent")).toBe(true);
    expect(isTerminal("end")).toBe(true);
    expect(isTerminal("start")).toBe(false);
    expect(isTerminal("send_buttons")).toBe(false);
    expect(isTerminal("condition")).toBe(false);
  });

  it("the three classifications are mutually exclusive for known node types", () => {
    const types = [
      "start",
      "send_message",
      "send_buttons",
      "send_list",
      "send_media",
      "collect_input",
      "condition",
      "set_tag",
      "handoff",
      "activate_ai_agent",
      "end",
    ];
    for (const t of types) {
      const flags = [isAutoAdvancing(t), isSuspending(t), isTerminal(t)];
      // Exactly one of the three should be true for every known node.
      expect(flags.filter(Boolean).length).toBe(1);
    }
  });
});

describe("evaluateConditionPredicate", () => {
  it("present: true when subject has a value", () => {
    expect(
      evaluateConditionPredicate({
        operator: "present",
        subjectValue: "alice@example.com",
        configValue: undefined,
      }),
    ).toBe(true);
  });

  it("present: false when subject is undefined or empty", () => {
    expect(
      evaluateConditionPredicate({
        operator: "present",
        subjectValue: undefined,
        configValue: undefined,
      }),
    ).toBe(false);
    expect(
      evaluateConditionPredicate({
        operator: "present",
        subjectValue: "",
        configValue: undefined,
      }),
    ).toBe(false);
  });

  it("absent: inverse of present", () => {
    expect(
      evaluateConditionPredicate({
        operator: "absent",
        subjectValue: undefined,
        configValue: undefined,
      }),
    ).toBe(true);
    expect(
      evaluateConditionPredicate({
        operator: "absent",
        subjectValue: "x",
        configValue: undefined,
      }),
    ).toBe(false);
  });

  it("equals: exact string comparison; case-sensitive", () => {
    expect(
      evaluateConditionPredicate({
        operator: "equals",
        subjectValue: "VIP",
        configValue: "VIP",
      }),
    ).toBe(true);
    expect(
      evaluateConditionPredicate({
        operator: "equals",
        subjectValue: "vip",
        configValue: "VIP",
      }),
    ).toBe(false);
  });

  it("equals: undefined subject never matches (even against empty)", () => {
    expect(
      evaluateConditionPredicate({
        operator: "equals",
        subjectValue: undefined,
        configValue: "",
      }),
    ).toBe(false);
  });

  it("contains: substring match", () => {
    expect(
      evaluateConditionPredicate({
        operator: "contains",
        subjectValue: "support@example.com",
        configValue: "@example.com",
      }),
    ).toBe(true);
    expect(
      evaluateConditionPredicate({
        operator: "contains",
        subjectValue: "support@other.com",
        configValue: "@example.com",
      }),
    ).toBe(false);
  });

  it("contains: undefined subject never matches", () => {
    expect(
      evaluateConditionPredicate({
        operator: "contains",
        subjectValue: undefined,
        configValue: "anything",
      }),
    ).toBe(false);
  });
});

// ============================================================
// selectEntryFlow / matchesEventTrigger / selectEntryFlowForEvent
//
// These back the 4 new Flow trigger types (new_message_received,
// new_contact_created, tag_added, deal_stage_changed). Fixtures are
// plain { trigger_type, trigger_config } objects in the same order
// findEntryFlow/dispatchEventToFlows pass them (created_at asc).
// ============================================================

interface Fixture {
  trigger_type: FlowTriggerType;
  trigger_config: Record<string, unknown>;
}

describe("selectEntryFlow", () => {
  it("a keyword match wins even when listed after a new_message_received catch-all (anti-shadowing guarantee)", () => {
    const flows: Fixture[] = [
      { trigger_type: "new_message_received", trigger_config: {} },
      { trigger_type: "keyword", trigger_config: { keywords: ["oi"] } },
    ];
    const result = selectEntryFlow(flows, {
      text: "oi tudo bem",
      isFirstInbound: false,
      wasContactCreated: false,
    });
    expect(result).toBe(flows[1]);
  });

  it("a keyword match wins even when listed after a first_inbound_message flow (deliberate behavior change vs the old flat created_at scan)", () => {
    const flows: Fixture[] = [
      { trigger_type: "first_inbound_message", trigger_config: {} },
      { trigger_type: "keyword", trigger_config: { keywords: ["oi"] } },
    ];
    const result = selectEntryFlow(flows, {
      text: "oi",
      isFirstInbound: true,
      wasContactCreated: false,
    });
    expect(result).toBe(flows[1]);
  });

  it("new_contact_created beats first_inbound_message when both would match", () => {
    const flows: Fixture[] = [
      { trigger_type: "first_inbound_message", trigger_config: {} },
      { trigger_type: "new_contact_created", trigger_config: {} },
    ];
    const result = selectEntryFlow(flows, {
      text: "hello",
      isFirstInbound: true,
      wasContactCreated: true,
    });
    expect(result).toBe(flows[1]);
  });

  it("first_inbound_message wins when wasContactCreated is false but isFirstInbound is true", () => {
    const flows: Fixture[] = [
      { trigger_type: "new_contact_created", trigger_config: {} },
      { trigger_type: "first_inbound_message", trigger_config: {} },
    ];
    const result = selectEntryFlow(flows, {
      text: "hello",
      isFirstInbound: true,
      wasContactCreated: false,
    });
    expect(result).toBe(flows[1]);
  });

  it("new_message_received only wins when nothing more specific matched", () => {
    const flows: Fixture[] = [
      { trigger_type: "keyword", trigger_config: { keywords: ["oi"] } },
      { trigger_type: "new_message_received", trigger_config: {} },
    ];
    const result = selectEntryFlow(flows, {
      text: "boa tarde",
      isFirstInbound: false,
      wasContactCreated: false,
    });
    expect(result).toBe(flows[1]);
  });

  it("within one tier, the earlier array position wins", () => {
    const flows: Fixture[] = [
      { trigger_type: "keyword", trigger_config: { keywords: ["oi"] } },
      { trigger_type: "keyword", trigger_config: { keywords: ["oi"] } },
    ];
    const result = selectEntryFlow(flows, {
      text: "oi",
      isFirstInbound: false,
      wasContactCreated: false,
    });
    expect(result).toBe(flows[0]);
  });

  it("never returns a manual-trigger flow, even when it's the only one", () => {
    const flows: Fixture[] = [{ trigger_type: "manual", trigger_config: {} }];
    const result = selectEntryFlow(flows, {
      text: "anything",
      isFirstInbound: true,
      wasContactCreated: true,
    });
    expect(result).toBeNull();
  });

  it("returns null when nothing matches", () => {
    const flows: Fixture[] = [
      { trigger_type: "keyword", trigger_config: { keywords: ["oi"] } },
    ];
    const result = selectEntryFlow(flows, {
      text: "boa tarde",
      isFirstInbound: false,
      wasContactCreated: false,
    });
    expect(result).toBeNull();
  });
});

describe("matchesEventTrigger", () => {
  it("tag_added: matches on exact tag id", () => {
    const flow: Fixture = { trigger_type: "tag_added", trigger_config: { tag_id: "t1" } };
    const event: FlowEvent = { type: "tag_added", tag_id: "t1" };
    expect(matchesEventTrigger(flow, event)).toBe(true);
  });

  it("tag_added: false on a different tag id", () => {
    const flow: Fixture = { trigger_type: "tag_added", trigger_config: { tag_id: "t1" } };
    const event: FlowEvent = { type: "tag_added", tag_id: "t2" };
    expect(matchesEventTrigger(flow, event)).toBe(false);
  });

  it("tag_added: false when the flow's tag_id is missing", () => {
    const flow: Fixture = { trigger_type: "tag_added", trigger_config: {} };
    const event: FlowEvent = { type: "tag_added", tag_id: "t1" };
    expect(matchesEventTrigger(flow, event)).toBe(false);
  });

  it("deal_stage_changed: matches on stage_id", () => {
    const flow: Fixture = {
      trigger_type: "deal_stage_changed",
      trigger_config: { stage_id: "s1" },
    };
    const event: FlowEvent = {
      type: "deal_stage_changed",
      deal_id: "d1",
      stage_id: "s1",
    };
    expect(matchesEventTrigger(flow, event)).toBe(true);
  });

  it("deal_stage_changed: false when both sides carry a differing pipeline_id", () => {
    const flow: Fixture = {
      trigger_type: "deal_stage_changed",
      trigger_config: { stage_id: "s1", pipeline_id: "p1" },
    };
    const event: FlowEvent = {
      type: "deal_stage_changed",
      deal_id: "d1",
      stage_id: "s1",
      pipeline_id: "p2",
    };
    expect(matchesEventTrigger(flow, event)).toBe(false);
  });

  it("deal_stage_changed: still matches when the flow has a pipeline_id but the event doesn't carry one (double-truthiness guard)", () => {
    const flow: Fixture = {
      trigger_type: "deal_stage_changed",
      trigger_config: { stage_id: "s1", pipeline_id: "p1" },
    };
    const event: FlowEvent = {
      type: "deal_stage_changed",
      deal_id: "d1",
      stage_id: "s1",
    };
    expect(matchesEventTrigger(flow, event)).toBe(true);
  });

  it("deal_stage_changed: false when the flow has no stage_id configured", () => {
    const flow: Fixture = { trigger_type: "deal_stage_changed", trigger_config: {} };
    const event: FlowEvent = {
      type: "deal_stage_changed",
      deal_id: "d1",
      stage_id: "s1",
    };
    expect(matchesEventTrigger(flow, event)).toBe(false);
  });

  it("false when the flow's trigger_type isn't the event's type", () => {
    const flow: Fixture = { trigger_type: "keyword", trigger_config: { keywords: ["oi"] } };
    const event: FlowEvent = { type: "tag_added", tag_id: "t1" };
    expect(matchesEventTrigger(flow, event)).toBe(false);
  });
});

describe("selectEntryFlowForEvent", () => {
  it("returns the earliest matching flow", () => {
    const flows: Fixture[] = [
      { trigger_type: "tag_added", trigger_config: { tag_id: "t1" } },
      { trigger_type: "tag_added", trigger_config: { tag_id: "t1" } },
    ];
    const event: FlowEvent = { type: "tag_added", tag_id: "t1" };
    expect(selectEntryFlowForEvent(flows, event)).toBe(flows[0]);
  });

  it("ignores flows of a different trigger_type even if their config happens to hold a matching id", () => {
    const flows: Fixture[] = [
      { trigger_type: "deal_stage_changed", trigger_config: { stage_id: "t1" } },
      { trigger_type: "tag_added", trigger_config: { tag_id: "t1" } },
    ];
    const event: FlowEvent = { type: "tag_added", tag_id: "t1" };
    expect(selectEntryFlowForEvent(flows, event)).toBe(flows[1]);
  });

  it("returns null when nothing matches", () => {
    const flows: Fixture[] = [
      { trigger_type: "tag_added", trigger_config: { tag_id: "t1" } },
    ];
    const event: FlowEvent = { type: "tag_added", tag_id: "t2" };
    expect(selectEntryFlowForEvent(flows, event)).toBeNull();
  });
});
