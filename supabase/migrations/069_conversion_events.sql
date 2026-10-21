-- ============================================================
-- 069_conversion_events.sql: send sales results back to the ad platforms
--
--   conversion_settings  per account: Meta dataset (Pixel) id, on/off,
--                        optional test event code
--   conversion_rules     which deal stage (or the "won" status) fires
--                        which event (Lead, Purchase, ...)
--   conversion_events    queue + log. A trigger on deals adds a row when a
--                        deal enters a rule's stage; /api/conversions/cron
--                        sends the pending rows to Meta's Conversions API.
--
-- The trigger never blocks a deal update: any failure inside it is
-- logged as a warning and swallowed. One event per deal per rule
-- (unique key), so moving a deal back and forth does not double count.
--
-- `destination` is 'meta' today; 'google' is reserved for Google Ads
-- offline conversions.
--
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS conversion_settings (
  account_id       uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  meta_dataset_id  text,
  meta_enabled     boolean NOT NULL DEFAULT false,
  -- Events Manager "Test events" code; while set, events are only tests.
  meta_test_code   text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE conversion_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversion_settings_select ON conversion_settings;
CREATE POLICY conversion_settings_select ON conversion_settings FOR SELECT
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS conversion_settings_insert ON conversion_settings;
CREATE POLICY conversion_settings_insert ON conversion_settings FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS conversion_settings_update ON conversion_settings;
CREATE POLICY conversion_settings_update ON conversion_settings FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversion_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Exactly one trigger: a pipeline stage, or a deal status.
  stage_id    uuid REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  on_status   text CHECK (on_status IS NULL OR on_status = 'won'),
  event_name  text NOT NULL CHECK (event_name IN (
    'Lead', 'Contact', 'Schedule', 'CompleteRegistration', 'InitiateCheckout', 'Purchase'
  )),
  -- Include the deal value in the event (normally only for Purchase).
  send_value  boolean NOT NULL DEFAULT false,
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversion_rules_one_trigger CHECK (
    (stage_id IS NOT NULL AND on_status IS NULL) OR (stage_id IS NULL AND on_status IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_conversion_rules_account ON conversion_rules(account_id);

ALTER TABLE conversion_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversion_rules_select ON conversion_rules;
CREATE POLICY conversion_rules_select ON conversion_rules FOR SELECT
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS conversion_rules_write ON conversion_rules;
CREATE POLICY conversion_rules_write ON conversion_rules FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversion_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id         uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  rule_id         uuid NOT NULL REFERENCES conversion_rules(id) ON DELETE CASCADE,
  destination     text NOT NULL DEFAULT 'meta' CHECK (destination IN ('meta', 'google')),
  event_name      text NOT NULL,
  value           numeric(12,2),
  currency        text,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  -- pending → sent | skipped | failed (failed is retried until attempts run out)
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
  attempts        smallint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  detail          text,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, deal_id, rule_id)
);

CREATE INDEX IF NOT EXISTS idx_conversion_events_due
  ON conversion_events(next_attempt_at) WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_conversion_events_account_created
  ON conversion_events(account_id, created_at DESC);

ALTER TABLE conversion_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversion_events_select ON conversion_events;
CREATE POLICY conversion_events_select ON conversion_events FOR SELECT
  USING (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- Enqueue on deal changes. SECURITY DEFINER: the person moving the deal
-- has no write access to the queue.
CREATE OR REPLACE FUNCTION enqueue_conversion_events() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    IF NEW.account_id IS NULL THEN
      RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id
       AND NEW.status   IS NOT DISTINCT FROM OLD.status THEN
      RETURN NEW;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM conversion_settings s
      WHERE s.account_id = NEW.account_id AND s.meta_enabled
    ) THEN
      RETURN NEW;
    END IF;

    -- Appointment pipelines are not sales.
    IF EXISTS (
      SELECT 1 FROM pipelines p
      WHERE p.id = NEW.pipeline_id AND COALESCE(p.is_scheduling, false)
    ) THEN
      RETURN NEW;
    END IF;

    INSERT INTO conversion_events
      (account_id, deal_id, contact_id, rule_id, destination, event_name, value, currency)
    SELECT NEW.account_id, NEW.id, NEW.contact_id, r.id, 'meta', r.event_name,
           CASE WHEN r.send_value THEN NEW.value END,
           COALESCE(NEW.currency, 'BRL')
    FROM conversion_rules r
    WHERE r.account_id = NEW.account_id
      AND r.enabled
      AND (
        (r.stage_id IS NOT NULL AND r.stage_id = NEW.stage_id
           AND (TG_OP = 'INSERT' OR r.stage_id IS DISTINCT FROM OLD.stage_id))
        OR
        (r.on_status IS NOT NULL AND r.on_status = NEW.status
           AND (TG_OP = 'INSERT' OR r.on_status IS DISTINCT FROM OLD.status))
      )
    ON CONFLICT (account_id, deal_id, rule_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_conversion_events failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_conversion_events ON deals;
CREATE TRIGGER trg_enqueue_conversion_events
  AFTER INSERT OR UPDATE OF stage_id, status ON deals
  FOR EACH ROW EXECUTE FUNCTION enqueue_conversion_events();

NOTIFY pgrst, 'reload schema';
