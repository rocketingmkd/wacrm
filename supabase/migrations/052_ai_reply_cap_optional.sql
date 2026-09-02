-- ============================================================
-- 052_ai_reply_cap_optional.sql — the per-conversation auto-reply
-- cap becomes optional
--
-- `ai_agents.auto_reply_max_per_conversation` was NOT NULL DEFAULT 3,
-- CHECK BETWEEN 1 AND 20 (migration 029, on the old `ai_configs`). In
-- practice not every use case wants a cap — an agent conducting a real
-- conversation shouldn't stop dead after 3 turns. Make NULL mean
-- "no limit", widen the allowed range for those who do want one, and
-- teach the atomic slot-claim function to treat NULL as unlimited.
--
-- Existing rows keep their current number, so behaviour is unchanged
-- for every agent already configured. New agents are created with NULL
-- (no cap) by the API.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- Drop whatever CHECK constraint currently guards the column (its name
-- carries over from the `ai_configs` era — `ai_configs_auto_reply_...`).
DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT c.conname INTO v_conname
  FROM pg_constraint c
  WHERE c.conrelid = 'ai_agents'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%auto_reply_max_per_conversation%';
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE ai_agents DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE ai_agents
  ALTER COLUMN auto_reply_max_per_conversation DROP NOT NULL;

ALTER TABLE ai_agents
  ALTER COLUMN auto_reply_max_per_conversation DROP DEFAULT;

ALTER TABLE ai_agents
  ADD CONSTRAINT ai_agents_auto_reply_max_per_conversation_check
  CHECK (
    auto_reply_max_per_conversation IS NULL
    OR auto_reply_max_per_conversation BETWEEN 1 AND 500
  );

-- NULL max_replies → unlimited. The `+ 1` still happens so the count
-- keeps climbing (the engine uses it for "how many has the bot sent"),
-- it just never gates.
CREATE OR REPLACE FUNCTION public.claim_ai_reply_slot(
  conversation_id uuid,
  max_replies integer
)
RETURNS boolean AS $$
  WITH claimed AS (
    UPDATE conversations
    SET ai_reply_count = ai_reply_count + 1
    WHERE id = conversation_id
      AND (max_replies IS NULL OR ai_reply_count < max_replies)
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;
