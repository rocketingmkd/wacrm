-- ============================================================
-- 075_google_ads_conversions.sql: send sales results to Google Ads
--
-- Uses the Google Data Manager API (events:ingest) with the lead's gclid.
--
--   google_ads_connections  per account: the OAuth client the account owner
--                           created in Google Cloud (client id + encrypted
--                           secret), the encrypted refresh token and the
--                           Google Ads account the conversions go to.
--                           RLS on with NO policies: only the server
--                           (service role) reads it, so the secret and the
--                           token never reach the browser.
--   conversion_settings     + google_enabled, google_validate_only
--   conversion_rules        + google_action_id (the Google Ads conversion
--                           action that receives this rule's event)
--   conversion_events       one row per deal, rule AND destination, so the
--                           same deal can go to Meta and to Google.
--
-- Everything starts OFF: google_enabled defaults to false and
-- google_validate_only to true (Google validates, nothing is imported).
--
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS google_ads_connections (
  account_id         uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  client_id          text NOT NULL,
  client_secret_enc  text NOT NULL,
  refresh_token_enc  text,
  -- Google Ads account that receives the conversions (digits only).
  customer_id        text,
  -- Manager (MCC) account used to reach customer_id, when there is one.
  login_customer_id  text,
  connected_at       timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE google_ads_connections ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
ALTER TABLE conversion_settings
  ADD COLUMN IF NOT EXISTS google_enabled       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS google_validate_only boolean NOT NULL DEFAULT true;

ALTER TABLE conversion_rules
  ADD COLUMN IF NOT EXISTS google_action_id text;

-- ------------------------------------------------------------
-- One event per deal, rule and destination.
DO $$
DECLARE
  old_name text;
BEGIN
  SELECT c.conname INTO old_name
  FROM pg_constraint c
  WHERE c.conrelid = 'conversion_events'::regclass
    AND c.contype = 'u'
    AND (
      SELECT array_agg(a.attname::text ORDER BY a.attname)
      FROM unnest(c.conkey) k
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k
    ) = ARRAY['account_id', 'deal_id', 'rule_id'];
  IF old_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE conversion_events DROP CONSTRAINT %I', old_name);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversion_events_deal_rule_dest
  ON conversion_events(account_id, deal_id, rule_id, destination);

-- ------------------------------------------------------------
-- Enqueue on deal changes: Meta rows when Meta is on, Google rows when
-- Google is on and the rule has a Google conversion action.
CREATE OR REPLACE FUNCTION enqueue_conversion_events() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta_on   boolean;
  google_on boolean;
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

    SELECT COALESCE(s.meta_enabled, false), COALESCE(s.google_enabled, false)
      INTO meta_on, google_on
    FROM conversion_settings s
    WHERE s.account_id = NEW.account_id;

    IF NOT COALESCE(meta_on, false) AND NOT COALESCE(google_on, false) THEN
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
    SELECT NEW.account_id, NEW.id, NEW.contact_id, r.id, d.destination, r.event_name,
           CASE WHEN r.send_value THEN NEW.value END,
           COALESCE(NEW.currency, 'BRL')
    FROM conversion_rules r
    CROSS JOIN (VALUES ('meta'), ('google')) AS d(destination)
    WHERE r.account_id = NEW.account_id
      AND r.enabled
      AND (
        (d.destination = 'meta' AND COALESCE(meta_on, false))
        OR
        (d.destination = 'google' AND COALESCE(google_on, false)
           AND r.google_action_id IS NOT NULL)
      )
      AND (
        (r.stage_id IS NOT NULL AND r.stage_id = NEW.stage_id
           AND (TG_OP = 'INSERT' OR r.stage_id IS DISTINCT FROM OLD.stage_id))
        OR
        (r.on_status IS NOT NULL AND r.on_status = NEW.status
           AND (TG_OP = 'INSERT' OR r.on_status IS DISTINCT FROM OLD.status))
      )
    ON CONFLICT (account_id, deal_id, rule_id, destination) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_conversion_events failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
