-- ============================================================
-- 038_whatsapp_coexistence.sql
--
-- Real WhatsApp Business App Coexistence support (not just the
-- standard Embedded Signup that creates/picks a fresh WABA).
--
--   1. whatsapp_config gains flags to track the Coexistence-specific
--      lifecycle: is this number a Coexistence connection, when did
--      onboarding finish (start of the 24h sync window Meta gives
--      before the customer must be offboarded and redone), and have
--      the one-time contacts/history syncs already run.
--
--   2. messages.origin distinguishes rows that did NOT originate from
--      a normal Cloud API send/receive:
--        'whatsapp_app'    — mirrored from the customer's own
--                            WhatsApp Business app (smb_message_echoes)
--        'history_import'  — backfilled from the one-time `history`
--                            webhook sync
--      NULL (the default) keeps meaning what it always meant: a
--      regular Cloud API message. No CHECK constraint — deliberately
--      open-ended so a future origin doesn't require a migration.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS is_coexistence BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contacts_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS history_synced_at TIMESTAMPTZ;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS origin TEXT;

-- Speeds up the dedup check the history-import handler runs before
-- every insert (chunks can be redelivered by Meta).
CREATE INDEX IF NOT EXISTS idx_messages_origin_history
  ON messages(conversation_id)
  WHERE origin = 'history_import';
