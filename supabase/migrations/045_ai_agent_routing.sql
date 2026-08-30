-- ============================================================
-- 045_ai_agent_routing.sql — which AI agent is "on duty" for a
-- conversation, and which agent generated a given usage log row.
--
-- `conversations.active_ai_agent_id` is distinct from
-- `assigned_agent_id` (a HUMAN, auth.users.id) — this one points at
-- `ai_agents.id`. NULL means "not yet decided", and the dispatcher
-- (src/lib/ai/auto-reply.ts) resolves that to the account's
-- receptionist agent at read time rather than backfilling every row
-- here — cheaper, and correct even for conversations created before
-- this migration ran.
--
-- `ai_usage_log.agent_id` is nullable and NOT backfilled — there is
-- no way to know which "agent" (a concept that didn't exist yet)
-- pre-migration spend belongs to. New rows populate it going forward.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS active_ai_agent_id uuid REFERENCES ai_agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_active_ai_agent
  ON conversations(active_ai_agent_id)
  WHERE active_ai_agent_id IS NOT NULL;

ALTER TABLE ai_usage_log
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES ai_agents(id) ON DELETE SET NULL;
