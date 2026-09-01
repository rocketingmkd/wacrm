-- ============================================================
-- 050_flow_event_triggers.sql — 4 new Flow trigger types
--
-- Feature: Flows reach trigger parity with Automations for 4 of its
-- 9 trigger types — `new_message_received` (any inbound text, no
-- keyword needed), `new_contact_created` (narrower than
-- `first_inbound_message`: only when the webhook just auto-created
-- the contact from this exact message), `tag_added` (a specific tag
-- was added to the contact), `deal_stage_changed` (a deal entered a
-- specific pipeline stage). The last two are Flows' first-ever
-- non-message-driven entry points, dispatched via the new
-- `dispatchEventToFlows` (src/lib/flows/engine.ts) from
-- `src/lib/contacts/tag-events.ts` and
-- `src/app/api/deals/[id]/stage/route.ts` — mirroring how
-- Automations' `runAutomationsForTrigger` already gets called from
-- those same two places.
--
-- Schema impact: `automations.trigger_type` is free-text TEXT (per
-- migration 048's header comment), so the Automations side needed no
-- migration for these same 4 values. `flows.trigger_type` DOES have a
-- CHECK constraint (migration 010) — widen it. `trigger_config` is
-- already JSONB NOT NULL DEFAULT '{}', so no column changes.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE flows
  DROP CONSTRAINT IF EXISTS flows_trigger_type_check;

ALTER TABLE flows
  ADD CONSTRAINT flows_trigger_type_check
  CHECK (trigger_type IN (
    'keyword',
    'new_message_received',
    'new_contact_created',
    'first_inbound_message',
    'tag_added',
    'deal_stage_changed',
    'manual'
  ));
