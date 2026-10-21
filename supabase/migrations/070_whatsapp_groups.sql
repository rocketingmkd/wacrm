-- ============================================================
-- 070_whatsapp_groups.sql — WhatsApp groups received through Evolution
--
-- Phase 4 of the unofficial (Evolution) session. The official Cloud API
-- never delivers group traffic, so groups arrive through the Evolution
-- webhook instead. Scope is deliberately small: follow and reply in a
-- few small groups the admin picks. A group is NOT a lead.
--
-- Shape:
--   - A group is stored as a contact (is_group = true) with its own
--     conversation, so the inbox, realtime, unread counts and the
--     public API keep working unchanged. `phone` holds the numeric part
--     of the group JID (it satisfies the NOT NULL + per-account unique
--     phone_normalized index and can never collide with a real number).
--   - messages gain sender_name / sender_phone: who spoke in the group.
--   - whatsapp_groups lists the groups the admin chose to follow. A
--     group that is not listed is ignored by the inbound webhook.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS is_group  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS group_jid text;

-- One contact per group per account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_group_jid
  ON contacts(account_id, group_jid)
  WHERE group_jid IS NOT NULL;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sender_name  text,
  ADD COLUMN IF NOT EXISTS sender_phone text;

CREATE TABLE IF NOT EXISTS whatsapp_groups (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  group_jid   text NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, group_jid)
);

ALTER TABLE whatsapp_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_groups_select ON whatsapp_groups;
CREATE POLICY whatsapp_groups_select ON whatsapp_groups FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS whatsapp_groups_insert ON whatsapp_groups;
CREATE POLICY whatsapp_groups_insert ON whatsapp_groups FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS whatsapp_groups_update ON whatsapp_groups;
CREATE POLICY whatsapp_groups_update ON whatsapp_groups FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS whatsapp_groups_delete ON whatsapp_groups;
CREATE POLICY whatsapp_groups_delete ON whatsapp_groups FOR DELETE
  USING (is_account_member(account_id, 'admin'));
