-- ============================================================
-- 057_deals_conversation_fk_set_null.sql — deleting a conversation
-- (or the contact it belongs to) must not be blocked by a deal that
-- points back at it.
--
-- `deals.conversation_id` has referenced `conversations(id)` with NO
-- explicit ON DELETE since 001_initial_schema, i.e. ON DELETE NO
-- ACTION. It stayed dormant because nothing populated the column —
-- until the AI kanban sync (migration 051, live since 2026-09-02)
-- started creating / linking deal cards with `conversation_id` set.
--
-- Now: deleting a contact cascades to its `conversations` (that FK is
-- ON DELETE CASCADE), that cascade hits `deals_conversation_id_fkey`,
-- NO ACTION raises a foreign-key violation, and the whole delete is
-- rolled back — the Contacts tab just shows "failed to delete".
--
-- Fix: ON DELETE SET NULL, mirroring `deals_contact_id_fkey` (already
-- SET NULL). A deal is a pipeline record with its own value, stage and
-- history — it should outlive the conversation that spawned it and
-- simply lose the backref. `deals.conversation_id` is already
-- nullable, so no data change is needed.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_conversation_id_fkey;

ALTER TABLE deals
  ADD CONSTRAINT deals_conversation_id_fkey
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;
