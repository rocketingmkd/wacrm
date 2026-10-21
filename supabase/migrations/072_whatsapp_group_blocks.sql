-- ============================================================
-- 072_whatsapp_group_blocks.sql — deleted groups stay deleted
--
-- Every group of the paired number enters the inbox on its own (070).
-- Deleting a group from the CRM must therefore be remembered, otherwise
-- its next message would bring it back. Deleting a group contact records
-- its JID here (trigger, so every delete path is covered: right-click,
-- bulk delete, API). The Evolution webhook ignores messages of a blocked
-- group; being ADDED to the group again clears the block.
--
-- No FK to accounts on purpose: the trigger also fires when an account
-- is deleted (cascade), and the orphan rows are harmless.
--
-- The webhook now also subscribes to GROUPS_UPSERT and
-- GROUP_PARTICIPANTS_UPDATE (a group appears as soon as the number is
-- added), so every session gets its webhook registered again.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_group_blocks (
  account_id uuid        NOT NULL,
  group_jid  text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, group_jid)
);

-- Service-role only: RLS on, no policies.
ALTER TABLE whatsapp_group_blocks ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION remember_deleted_whatsapp_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO whatsapp_group_blocks (account_id, group_jid)
  VALUES (OLD.account_id, OLD.group_jid)
  ON CONFLICT DO NOTHING;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS contacts_remember_deleted_group ON contacts;
CREATE TRIGGER contacts_remember_deleted_group
  AFTER DELETE ON contacts
  FOR EACH ROW
  WHEN (OLD.is_group AND OLD.group_jid IS NOT NULL)
  EXECUTE FUNCTION remember_deleted_whatsapp_group();

-- Re-register every webhook with the new event list.
UPDATE whatsapp_unofficial_sessions SET webhook_set_at = NULL;
