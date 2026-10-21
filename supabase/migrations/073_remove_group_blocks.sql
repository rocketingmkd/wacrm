-- ============================================================
-- 073_remove_group_blocks.sql — undo 072
--
-- Deleting a WhatsApp group in the CRM now makes the number LEAVE the
-- group on WhatsApp (like deleting a group in WhatsApp itself), so
-- nothing more arrives from it and the "remember deleted groups" block
-- list of 072 is no longer needed. It would also get in the way of
-- testing: a group deleted before this change stayed hidden even though
-- the number was still in it.
--
-- Drops the trigger, its function and the (empty or near-empty) table.
-- Idempotent — safe to run multiple times.
-- ============================================================

DROP TRIGGER IF EXISTS contacts_remember_deleted_group ON contacts;
DROP FUNCTION IF EXISTS remember_deleted_whatsapp_group();
DROP TABLE IF EXISTS whatsapp_group_blocks;
