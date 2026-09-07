-- ============================================================
-- 061_agenda_reminders.sql — appointment reminder engine
--
-- Closes the gap left after migration 059 (the AI books a real
-- appointment): nothing ever reminded the customer or confirmed
-- attendance afterward. This migration adds the configuration surface
-- and the idempotency ledger for that reminder engine.
--
-- Deliberately does NOT store a computed `run_at` and does NOT add any
-- trigger on `deals` to recalculate one. The engine (application code,
-- next migration's sibling in src/lib/agenda/reminders.ts) derives
-- "is this reminder due" straight from `deals.scheduled_at` and
-- `agenda_reminder_settings` every time the cron runs — a reschedule
-- is just a new `scheduled_at`, which is automatically a new ledger
-- key below, no cancellation/recalculation code needed anywhere. This
-- is the earlier design (a `wait`-style pending-execution row with a
-- one-time computed `run_at`) deliberately rejected for this feature:
-- it doesn't survive a reschedule.
--
--   1. agenda_reminder_settings — one row per account (mirrors
--      agenda_availability_settings from migration 055): whether
--      reminders are on, up to two offsets before the appointment,
--      which approved template to send (or NULL to autodetect the
--      account's only APPROVED Utility template), which quick-reply
--      button index means "confirm" vs "reschedule", and which
--      pipeline_stages the appointment moves to after the reminder
--      sends / the customer confirms.
--
--   2. agenda_reminders — ledger, one row per (deal, kind,
--      scheduled_at) actually sent or attempted. Write-only via the
--      service role (no INSERT/UPDATE policy for members — same
--      pattern as `notifications`, migration 027); the UNIQUE
--      constraint is what makes two overlapping cron runs safe.
--
--   3. notifications.type gains 'agenda_reminder_reschedule' for the
--      "customer asked to reschedule and no can_schedule agent was
--      available" fallback — same widen pattern as migrations 051
--      and 059.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- agenda_reminder_settings — one row per account
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agenda_reminder_settings (
  account_id              uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  enabled                 boolean NOT NULL DEFAULT true,
  -- NULL = autodetect the account's one APPROVED Utility template
  -- shaped for this feature (3 body vars + 2 quick-reply buttons).
  template_id             uuid REFERENCES message_templates(id) ON DELETE SET NULL,
  -- Minutes before `deals.scheduled_at`. NULL turns that specific
  -- reminder off without disabling the whole feature.
  first_offset_minutes    integer DEFAULT 1440 CHECK (first_offset_minutes IS NULL OR first_offset_minutes > 0),
  second_offset_minutes   integer DEFAULT 120  CHECK (second_offset_minutes IS NULL OR second_offset_minutes > 0),
  -- Index into the template's own `buttons` array (message_templates.buttons)
  -- — which quick-reply button means "I'll be there" vs "let's reschedule".
  confirm_button_index    smallint NOT NULL DEFAULT 0 CHECK (confirm_button_index >= 0),
  reschedule_button_index smallint NOT NULL DEFAULT 1 CHECK (reschedule_button_index >= 0),
  -- Where the card goes right after a reminder sends, and right after
  -- the customer taps "confirm". NULL = leave the card where it is
  -- (e.g. account hasn't finished configuring the Agenda pipeline).
  stage_after_send_id     uuid REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  stage_after_confirm_id  uuid REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  -- Stages that stop the reminder engine for a card outright (e.g.
  -- "Realizado", "Não compareceu") — checked in addition to
  -- `scheduled_at` being in the future.
  stop_stage_ids          uuid[] NOT NULL DEFAULT '{}',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agenda_reminder_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agenda_reminder_settings_select ON agenda_reminder_settings;
CREATE POLICY agenda_reminder_settings_select ON agenda_reminder_settings FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS agenda_reminder_settings_insert ON agenda_reminder_settings;
CREATE POLICY agenda_reminder_settings_insert ON agenda_reminder_settings FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS agenda_reminder_settings_update ON agenda_reminder_settings;
CREATE POLICY agenda_reminder_settings_update ON agenda_reminder_settings FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS agenda_reminder_settings_delete ON agenda_reminder_settings;
CREATE POLICY agenda_reminder_settings_delete ON agenda_reminder_settings FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS agenda_reminder_settings_updated_at ON agenda_reminder_settings;
CREATE TRIGGER agenda_reminder_settings_updated_at
  BEFORE UPDATE ON agenda_reminder_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- agenda_reminders — send ledger / idempotency guard
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agenda_reminders (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id             uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('first', 'second')),
  -- Snapshot of deals.scheduled_at at send time. Part of the UNIQUE
  -- key below so a reschedule (new scheduled_at) is a brand new row,
  -- not a conflict with the old appointment's reminder.
  scheduled_at        timestamptz NOT NULL,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts            integer NOT NULL DEFAULT 0,
  error               text,
  whatsapp_message_id text,
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- The idempotency guard itself: two cron runs racing on the same
  -- due reminder both try to INSERT this row; only one wins.
  UNIQUE (deal_id, kind, scheduled_at)
);

CREATE INDEX IF NOT EXISTS idx_agenda_reminders_account ON agenda_reminders(account_id);
CREATE INDEX IF NOT EXISTS idx_agenda_reminders_deal ON agenda_reminders(deal_id);

ALTER TABLE agenda_reminders ENABLE ROW LEVEL SECURITY;

-- Read-only for members; every write comes from the cron route via
-- the service-role client (bypasses RLS), same as `notifications`.
DROP POLICY IF EXISTS agenda_reminders_select ON agenda_reminders;
CREATE POLICY agenda_reminders_select ON agenda_reminders FOR SELECT
  USING (is_account_member(account_id));

-- ------------------------------------------------------------
-- notifications.type — allow the reschedule-fallback notification
-- ------------------------------------------------------------
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'ai_handed_off', 'ai_booked_appointment', 'agenda_reminder_reschedule'));
