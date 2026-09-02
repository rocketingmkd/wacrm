-- ============================================================
-- 051_ai_kanban_config.sql — bind AI attendance to a pipeline
--
-- Feature: when the AI answers a conversation, the contact's card on a
-- chosen pipeline moves to an "AI" stage; when the AI hands the thread
-- to a human (or a human takes it over), the card moves to a "Human"
-- stage. Optionally, closing the conversation moves it to a "Done"
-- stage. One config row per account; the whole feature is a no-op for
-- accounts that never fill it in.
--
-- Also here (small, related): the AI handoff was invisible when the
-- answering agent had no handoff target configured — the thread just
-- went quiet. Widen `notifications.type` so the auto-reply engine can
-- write an `ai_handed_off` notification for the account's team.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- ai_kanban_config — one row per account
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_kanban_config (
  account_id      uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  -- The pipeline the AI operates on. Drop the config if the pipeline
  -- is deleted — a config pointing at a gone pipeline is meaningless.
  pipeline_id     uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  -- Stage a card sits in while the AI is handling the conversation.
  stage_ia_id     uuid REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  -- Stage a card moves to when the conversation goes to a human
  -- (AI handoff, or a human taking the thread over).
  stage_human_id  uuid REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  -- Optional: stage a card moves to when the conversation is closed.
  stage_done_id   uuid REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  -- Master switch. A row can exist (half-configured) without the sync
  -- running.
  enabled         boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_kanban_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_kanban_config_select ON ai_kanban_config;
CREATE POLICY ai_kanban_config_select ON ai_kanban_config FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_kanban_config_insert ON ai_kanban_config;
CREATE POLICY ai_kanban_config_insert ON ai_kanban_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_kanban_config_update ON ai_kanban_config;
CREATE POLICY ai_kanban_config_update ON ai_kanban_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_kanban_config_delete ON ai_kanban_config;
CREATE POLICY ai_kanban_config_delete ON ai_kanban_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS ai_kanban_config_updated_at ON ai_kanban_config;
CREATE TRIGGER ai_kanban_config_updated_at
  BEFORE UPDATE ON ai_kanban_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Speeds up the "find the deal for this conversation" lookup the sync
-- helper and the trigger below both do.
CREATE INDEX IF NOT EXISTS idx_deals_conversation
  ON deals(conversation_id)
  WHERE conversation_id IS NOT NULL;

-- ------------------------------------------------------------
-- notifications.type — allow the AI handoff notification
-- ------------------------------------------------------------
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'ai_handed_off'));

-- ------------------------------------------------------------
-- Move the card to the "human" stage on takeover
--
-- Fires whenever `conversations.assigned_agent_id` is set to a real
-- user (from unassigned, or reassigned). Covers every assignment entry
-- point at once — the inbox "Take over" button, the `assign_conversation`
-- automation step, and the AI engine's own handoff-to-a-queue path —
-- without each having to remember to move the card.
--
-- Deliberately does NOT re-dispatch the `deal_stage_changed` app event
-- (that lives in the Next route layer, not in SQL): entering the human
-- column is a terminal state for the AI cadence, not a trigger for
-- another one. The AI engine's own no-target handoff moves the card in
-- application code instead, where the event does fire.
--
-- SECURITY DEFINER + guarded EXCEPTION so a sync failure can never
-- block the assignment itself — same contract as
-- notify_conversation_assigned (migration 027).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_deal_stage_on_human_takeover()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg ai_kanban_config%ROWTYPE;
BEGIN
  SELECT * INTO v_cfg FROM ai_kanban_config WHERE account_id = NEW.account_id;
  IF NOT FOUND OR NOT v_cfg.enabled OR v_cfg.stage_human_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE deals
     SET stage_id = v_cfg.stage_human_id
   WHERE account_id = NEW.account_id
     AND pipeline_id = v_cfg.pipeline_id
     AND status = 'open'
     AND stage_id IS DISTINCT FROM v_cfg.stage_human_id
     AND (conversation_id = NEW.id OR contact_id = NEW.contact_id);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sync_deal_stage_on_human_takeover failed for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION sync_deal_stage_on_human_takeover() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_conversation_human_takeover ON conversations;
CREATE TRIGGER on_conversation_human_takeover
  AFTER UPDATE OF assigned_agent_id ON conversations
  FOR EACH ROW
  WHEN (
    NEW.assigned_agent_id IS NOT NULL
    AND NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id
  )
  EXECUTE FUNCTION sync_deal_stage_on_human_takeover();
