-- ============================================================
-- 078_conversations_last_message_backfill.sql
--
-- Conversations created without a message (resolve-conversation insert)
-- have last_message_at NULL. The Inbox now sorts NULL last, but filling
-- the column keeps the "time ago" label and other readers consistent.
--
-- Backfill with created_at. Idempotent: only touches NULL rows.
-- NOT APPLIED automatically: review and run by hand.
-- ============================================================

UPDATE public.conversations
SET last_message_at = created_at
WHERE last_message_at IS NULL;
