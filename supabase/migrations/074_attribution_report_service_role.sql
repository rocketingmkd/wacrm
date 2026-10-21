-- ============================================================
-- 074_attribution_report_service_role.sql
--
-- GET /api/v1/traffic serves the "Origem do tráfego" report to an API key.
-- An API key runs on the service-role client, which has no auth.uid(), so
-- the admin check in attribution_report() rejected it. This re-creates the
-- function from 068 with TWO changes:
--   1. the service role passes the admin check (the route fixes p_account
--      from the key, never from the caller);
--   2. the "untracked" count skips WhatsApp groups (070): a group is a
--      contact but not a lead, so it must not show up as "sem origem".
-- The body is otherwise identical to 068; keep the two in sync.
--
-- Idempotent.
-- ============================================================

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
  -- The service role (public API key, already scoped to p_account by the
  -- caller) has no auth.uid(), so it is allowed explicitly.
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT is_account_member(p_account, 'admin') THEN
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
      AND NOT c.is_group
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
