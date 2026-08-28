-- ============================================================
-- 040_conversation_insights.sql
--
-- "Gerente IA" copilot — an AI reading of each active conversation the
-- seller sees inline in the inbox (temperature, what the customer
-- wants, open questions, suggested next actions, suggested pipeline
-- stage). One cached row per conversation, refreshed on a trigger
-- (seller opens the thread / new customer message after a gap) rather
-- than on every message, so the model spend stays bounded.
--
--   1. conversation_insights — the cached analysis. `payload` is the
--      full structured JSON the engine (src/lib/ai/copilot.ts) returns;
--      `msg_count_at_gen` is how many messages the conversation had
--      when this was generated, so a refresh is a no-op until the
--      thread actually moved.
--
--   2. ai_usage_log.mode gains 'copilot' so copilot LLM calls show up
--      in the same BYO-key spend view as draft / auto_reply.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS conversation_insights (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- One insight row per conversation; a refresh UPSERTs on this.
  conversation_id   UUID NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
  -- Tenancy — every read is scoped to the caller's account via RLS,
  -- mirroring conversations/messages.
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Full structured analysis from the copilot engine. Shape lives in
  -- code (CopilotInsight in src/lib/ai/copilot.ts), deliberately not
  -- constrained here so the engine can add fields without a migration.
  payload           JSONB NOT NULL,
  -- Message count at generation time. The refresh path compares this
  -- to the live count and skips the LLM call when nothing changed.
  msg_count_at_gen  INTEGER NOT NULL DEFAULT 0,
  provider          TEXT,
  model             TEXT,
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_insights_account
  ON conversation_insights(account_id);

ALTER TABLE conversation_insights ENABLE ROW LEVEL SECURITY;

-- Read: any member of the owning account (sellers see it on their
-- threads; admins/owners see it on all). Writes come only from the
-- service role (the copilot route + the webhook trigger), so there is
-- deliberately no INSERT/UPDATE policy for authenticated users.
DROP POLICY IF EXISTS conversation_insights_select ON conversation_insights;
CREATE POLICY conversation_insights_select ON conversation_insights
  FOR SELECT USING (is_account_member(account_id));

-- Widen ai_usage_log.mode to include the copilot.
ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'copilot'));
