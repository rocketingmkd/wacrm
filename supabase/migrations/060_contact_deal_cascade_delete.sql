-- ============================================================
-- 060_contact_deal_cascade_delete.sql — deleting a contact or a deal
-- now takes the other one down with it, in both directions
--
-- Product decision (reverses part of migration 057, which deliberately
-- preserved an orphaned deal — value/stage intact, contact_id/
-- conversation_id set to NULL — when its contact was deleted): the
-- user wants a contact and its Kanban card(s) to always go together.
--
--   1. Deleting a contact deletes every deal it has, in every
--      pipeline/funnel (not just one) — `deals_contact_id_fkey` flips
--      from ON DELETE SET NULL to ON DELETE CASCADE.
--   2. Deleting a deal deletes its contact too — a trigger, since a
--      plain FK can't cascade "up" from child to parent. This also
--      wipes that contact's conversations/messages (existing cascade)
--      and, transitively via (1), any OTHER deal that contact had in
--      a different pipeline. Deliberately unconditional: chosen over
--      the safer "only if this was its last deal" alternative.
--
-- Both directions fire on the SAME contact_id within one transaction
-- when they chain (e.g. deleting a deal deletes its contact, which
-- cascades to the contact's other deals, which re-fires this trigger
-- for each) — safe, because by the time the nested trigger's own
-- `DELETE FROM contacts` runs, the row is already gone from this
-- transaction's view and the statement just affects zero rows.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_contact_id_fkey;
ALTER TABLE deals
  ADD CONSTRAINT deals_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION delete_contact_on_deal_delete()
RETURNS trigger AS $$
BEGIN
  IF OLD.contact_id IS NOT NULL THEN
    DELETE FROM contacts WHERE id = OLD.contact_id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_deal_deleted_delete_contact ON deals;
CREATE TRIGGER on_deal_deleted_delete_contact
  AFTER DELETE ON deals
  FOR EACH ROW
  EXECUTE FUNCTION delete_contact_on_deal_delete();
