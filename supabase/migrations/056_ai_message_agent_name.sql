-- ============================================================
-- 056_ai_message_agent_name.sql — record WHICH AI agent sent each
-- auto-reply message.
--
-- Until now an AI-generated message only carried `ai_generated = true`
-- (migration 033), so the inbox badge could say "IA" but not which of
-- the account's several agents (receptionist, comercial, suporte, …)
-- actually produced it. With silent agent-to-agent transfers there is
-- no visible cue at all that a handoff happened — the next reply just
-- appears. Snapshotting the agent's display name on the message row
-- lets the bubble badge read "IA · Comercial", so an operator can see
-- the routing working (or not) in real time.
--
-- Denormalized on purpose: it's a snapshot label (like the sender name
-- on a printed receipt), not a live FK. A later agent rename does not,
-- and should not, rewrite the badge on messages the old-named agent
-- already sent. `select('*')` in the inbox message fetch + the realtime
-- payload both pick this column up with zero query changes.
--
-- NULL for every non-AI send (human agent, Flow, automation) — the
-- badge only renders when `ai_generated = true` anyway.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS ai_agent_name text;

COMMENT ON COLUMN messages.ai_agent_name IS
  'Display name of the AI agent that generated this message, snapshotted at send time. NULL for human/Flow/automation sends. Drives the "IA · <agent>" inbox badge (migration 056).';
