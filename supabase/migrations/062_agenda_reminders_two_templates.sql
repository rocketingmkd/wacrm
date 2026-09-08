-- ============================================================
-- 062_agenda_reminders_two_templates.sql — one template per kind
--
-- Migration 061 shipped with a single `agenda_reminder_settings.
-- template_id` shared by both the 24h and the 2h reminder. Product
-- decision (07/09): the two reminders serve different purposes, not
-- just different timing — the first is a confirmation request
-- ("are you still coming?"), the second is a plain heads-up shortly
-- before the appointment — so they need distinct copy, which means
-- distinct approved WhatsApp templates.
--
-- Splits `template_id` into `first_template_id` / `second_template_id`,
-- mirroring the existing `first_offset_minutes` / `second_offset_minutes`
-- pair. No data migration needed: the settings table has zero rows in
-- production as of this migration (the Lembretes tab shipped hours
-- ago and nobody has saved it yet) — still copying the old value
-- forward defensively in case that changes before this runs.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE agenda_reminder_settings
  ADD COLUMN IF NOT EXISTS first_template_id uuid REFERENCES message_templates(id) ON DELETE SET NULL;

ALTER TABLE agenda_reminder_settings
  ADD COLUMN IF NOT EXISTS second_template_id uuid REFERENCES message_templates(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agenda_reminder_settings' AND column_name = 'template_id'
  ) THEN
    UPDATE agenda_reminder_settings
    SET first_template_id = COALESCE(first_template_id, template_id),
        second_template_id = COALESCE(second_template_id, template_id)
    WHERE template_id IS NOT NULL;

    ALTER TABLE agenda_reminder_settings DROP COLUMN template_id;
  END IF;
END $$;
