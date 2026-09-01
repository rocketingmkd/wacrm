-- ============================================================
-- 049_activate_ai_agent_node.sql — "Activate AI agent" flow node
--
-- Feature: a new terminal Flows node type (`activate_ai_agent`) that
-- hands the conversation to a chosen AI agent (ai_agents.id) and has
-- it send its opening reply immediately — the AI counterpart of the
-- existing `handoff` node. Runtime behaviour lives in
-- `activateAgentAndReply` (src/lib/ai/auto-reply.ts), called from both
-- the Flows engine and the Automations engine's matching
-- `activate_ai_agent` step.
--
-- Schema impact: `automation_steps.step_type` is a free-text TEXT
-- column with no CHECK constraint, so the Automations side needs no
-- migration. `flow_nodes.node_type` DOES have a CHECK constraint
-- (migration 010) — widen it to allow the new value.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE flow_nodes
  DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;

ALTER TABLE flow_nodes
  ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_buttons',
    'send_list',
    'send_message',
    'send_media',
    'collect_input',
    'condition',
    'set_tag',
    'handoff',
    'activate_ai_agent',
    'http_fetch',
    'end'
  ));
