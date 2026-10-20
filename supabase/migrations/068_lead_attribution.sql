-- ============================================================
-- 068_lead_attribution.sql: where each lead came from (Meta / Google ads)
--
--   tracking_settings   one public key per account; identifies the account
--                       to the landing page script (safe to expose)
--   tracking_sessions   what the landing page script saw (UTMs, gclid,
--                       fbclid, ...) under a short code that travels inside
--                       the pre-filled WhatsApp message: "[#A1B2C3D4]"
--   lead_attribution    first touch of a contact: either the Click to
--                       WhatsApp `referral` sent by Meta, or the session
--                       found through the code in the first message
--
-- attribution_report() feeds the "Origem do tráfego" page.
--
-- Writes to tracking_sessions and lead_attribution happen with the
-- service role (public script endpoint and WhatsApp webhook), so those
-- tables have no insert policy for authenticated users.
--
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS tracking_settings (
  account_id  uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  public_key  text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tracking_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tracking_settings_select ON tracking_settings;
CREATE POLICY tracking_settings_select ON tracking_settings FOR SELECT
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS tracking_settings_insert ON tracking_settings;
CREATE POLICY tracking_settings_insert ON tracking_settings FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tracking_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  code         text NOT NULL UNIQUE,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  utm_term     text,
  utm_content  text,
  gclid        text,
  fbclid       text,
  fbc          text,
  fbp          text,
  landing_url  text,
  referrer     text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracking_sessions_account_created
  ON tracking_sessions(account_id, created_at DESC);

-- RLS on, no policies: only the service role reads or writes.
ALTER TABLE tracking_sessions ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_attribution (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id     uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  -- meta_ctwa: Click to WhatsApp ad · meta_site: Meta ad to a landing page
  -- google: Google Ads · other: UTMs from another source
  source         text NOT NULL CHECK (source IN ('meta_ctwa', 'meta_site', 'google', 'other')),
  -- Click to WhatsApp referral (Meta)
  ctwa_clid      text,
  ad_id          text,
  source_type    text,
  source_url     text,
  headline       text,
  body           text,
  -- Landing page session
  session_code   text,
  utm_source     text,
  utm_medium     text,
  utm_campaign   text,
  utm_term       text,
  utm_content    text,
  gclid          text,
  fbclid         text,
  fbc            text,
  fbp            text,
  landing_url    text,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- First touch wins: one row per contact.
  UNIQUE (account_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_attribution_account_seen
  ON lead_attribution(account_id, first_seen_at DESC);

ALTER TABLE lead_attribution ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_attribution_select ON lead_attribution;
CREATE POLICY lead_attribution_select ON lead_attribution FOR SELECT
  USING (is_account_member(account_id));

-- ------------------------------------------------------------
-- Report behind the "Origem do tráfego" page.
-- SECURITY INVOKER: reads go through RLS; admin check fails fast.
CREATE OR REPLACE FUNCTION attribution_report(
  p_account uuid,
  p_from    timestamptz,
  p_to      timestamptz,
  p_tz      text DEFAULT 'America/Sao_Paulo'
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT is_account_member(p_account, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH leads AS (
    SELECT a.*,
           COALESCE(NULLIF(a.utm_campaign, ''), NULLIF(a.headline, ''), a.ad_id, '(sem campanha)') AS campaign_label
    FROM lead_attribution a
    WHERE a.account_id = p_account
      AND a.first_seen_at >= p_from
      AND a.first_seen_at <  p_to
  ),
  lead_deals AS (
    SELECT l.id AS lead_id,
           count(d.id)                                              AS deals,
           count(d.id) FILTER (WHERE d.status = 'won')              AS won,
           COALESCE(sum(d.value) FILTER (WHERE d.status = 'won'), 0) AS won_value
    FROM leads l
    LEFT JOIN (
      SELECT dd.id, dd.contact_id, dd.status, dd.value
      FROM deals dd
      JOIN pipelines p ON p.id = dd.pipeline_id
      WHERE dd.account_id = p_account
        AND COALESCE(p.is_scheduling, false) = false
    ) d ON d.contact_id = l.contact_id
    GROUP BY l.id
  ),
  joined AS (
    SELECT l.*, ld.deals, ld.won, ld.won_value
    FROM leads l
    JOIN lead_deals ld ON ld.lead_id = l.id
  ),
  by_source AS (
    SELECT source,
           count(*)             AS leads,
           sum(deals)           AS deals,
           sum(won)             AS won,
           sum(won_value)       AS won_value
    FROM joined
    GROUP BY source
  ),
  by_campaign AS (
    SELECT source, campaign_label AS campaign,
           count(*)             AS leads,
           sum(deals)           AS deals,
           sum(won)             AS won,
           sum(won_value)       AS won_value
    FROM joined
    GROUP BY source, campaign_label
    ORDER BY count(*) DESC, campaign_label
    LIMIT 50
  ),
  per_day AS (
    SELECT to_char((first_seen_at AT TIME ZONE p_tz)::date, 'YYYY-MM-DD') AS day,
           source,
           count(*) AS leads
    FROM joined
    GROUP BY 1, 2
  ),
  recent AS (
    SELECT j.first_seen_at, j.source, j.campaign_label AS campaign, j.contact_id,
           c.name AS contact_name, j.won, j.won_value
    FROM joined j
    JOIN contacts c ON c.id = j.contact_id
    ORDER BY j.first_seen_at DESC
    LIMIT 20
  ),
  untracked AS (
    SELECT count(*) AS n
    FROM contacts c
    WHERE c.account_id = p_account
      AND c.created_at >= p_from
      AND c.created_at <  p_to
      AND NOT EXISTS (
        SELECT 1 FROM lead_attribution a
        WHERE a.account_id = p_account AND a.contact_id = c.id
      )
  )
  SELECT jsonb_build_object(
    'totals', (SELECT jsonb_build_object(
                 'leads', count(*),
                 'deals', COALESCE(sum(deals), 0),
                 'won', COALESCE(sum(won), 0),
                 'won_value', COALESCE(sum(won_value), 0)
               ) FROM joined),
    'untracked', (SELECT n FROM untracked),
    'by_source', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.leads DESC) FROM by_source s), '[]'::jsonb),
    'by_campaign', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM by_campaign c), '[]'::jsonb),
    'per_day', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.day) FROM per_day p), '[]'::jsonb),
    'recent', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM recent r), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

NOTIFY pgrst, 'reload schema';
