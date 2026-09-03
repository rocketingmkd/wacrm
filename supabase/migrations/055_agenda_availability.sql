-- ============================================================
-- 055_agenda_availability.sql — recurring hours, default duration,
-- and day-off/holiday exceptions for the scheduling agent
--
-- Feeds the (future) booking engine: before offering a slot, it reads
-- `availability_rules` for that weekday, subtracts any
-- `availability_exceptions` date, and cuts the remaining window into
-- `agenda_availability_settings.slot_duration_minutes` chunks, then
-- checks those against `deals.scheduled_at` on the Agenda pipeline
-- (migration 054) for conflicts. This migration only adds the
-- configuration surface — no booking logic yet.
--
-- Modeled after Cal.com's "Availability" page (per product decision):
--   - Working hours = a weekly recurring schedule, one row per
--     (weekday, time range) — multiple rows on the same weekday is
--     how a lunch-break gap is represented (e.g. 08:00-12:00 +
--     14:00-18:00), not a special case.
--   - Date overrides = specific calendar dates that are fully closed
--     regardless of the weekly schedule (holidays, days off). Kept to
--     "closed" only for now — Cal.com also supports custom hours on
--     an override date, not requested here; adding that later is a
--     column addition, not a redesign.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- agenda_availability_settings — one row per account
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agenda_availability_settings (
  account_id            uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  -- Default length of one bookable slot. Account-wide for now — every
  -- appointment type is the same "card on the Agenda pipeline" today,
  -- there's no per-service duration concept to hang this off yet.
  slot_duration_minutes integer NOT NULL DEFAULT 60
    CHECK (slot_duration_minutes > 0 AND slot_duration_minutes <= 480),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agenda_availability_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agenda_availability_settings_select ON agenda_availability_settings;
CREATE POLICY agenda_availability_settings_select ON agenda_availability_settings FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS agenda_availability_settings_insert ON agenda_availability_settings;
CREATE POLICY agenda_availability_settings_insert ON agenda_availability_settings FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS agenda_availability_settings_update ON agenda_availability_settings;
CREATE POLICY agenda_availability_settings_update ON agenda_availability_settings FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS agenda_availability_settings_delete ON agenda_availability_settings;
CREATE POLICY agenda_availability_settings_delete ON agenda_availability_settings FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS agenda_availability_settings_updated_at ON agenda_availability_settings;
CREATE TRIGGER agenda_availability_settings_updated_at
  BEFORE UPDATE ON agenda_availability_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- availability_rules — weekly recurring working hours
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS availability_rules (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- 0=Sunday..6=Saturday — matches JS `Date.getDay()`, same convention
  -- the Agenda calendar view already uses client-side.
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_availability_rules_account_day
  ON availability_rules(account_id, day_of_week);

ALTER TABLE availability_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS availability_rules_select ON availability_rules;
CREATE POLICY availability_rules_select ON availability_rules FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS availability_rules_insert ON availability_rules;
CREATE POLICY availability_rules_insert ON availability_rules FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS availability_rules_update ON availability_rules;
CREATE POLICY availability_rules_update ON availability_rules FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS availability_rules_delete ON availability_rules;
CREATE POLICY availability_rules_delete ON availability_rules FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- availability_exceptions — specific dates fully closed
-- (holidays, days off) regardless of the weekly schedule
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS availability_exceptions (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date        date NOT NULL,
  -- Optional human-readable reason ("Feriado nacional", "Férias") —
  -- purely informational, nothing reads it programmatically.
  label       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, date)
);

CREATE INDEX IF NOT EXISTS idx_availability_exceptions_account_date
  ON availability_exceptions(account_id, date);

ALTER TABLE availability_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS availability_exceptions_select ON availability_exceptions;
CREATE POLICY availability_exceptions_select ON availability_exceptions FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS availability_exceptions_insert ON availability_exceptions;
CREATE POLICY availability_exceptions_insert ON availability_exceptions FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS availability_exceptions_delete ON availability_exceptions;
CREATE POLICY availability_exceptions_delete ON availability_exceptions FOR DELETE
  USING (is_account_member(account_id, 'admin'));
