-- ============================================================
-- 067_report_overview.sql: aggregates behind the Relatórios page
--
-- One call returns everything the page shows for a period, computed in
-- SQL so the browser never downloads thousands of messages:
--   totals       messages in/out, how many were AI generated
--   per_day      inbound vs outbound per local day
--   response     time to FIRST reply of each customer burst (capped at
--                24h), overall and for humans only, avg + median
--   deals        created / won / lost in the period, open now, won value
--   stages       open deals per pipeline stage (sales pipelines only)
--   csat         ratings sent / answered, average, score distribution
--   agents       per teammate: assigned conversations with activity,
--                inbound messages, human replies, deals won
--
-- SECURITY INVOKER: every table read goes through RLS; the explicit
-- is_account_member(..., 'admin') check makes a non-admin fail fast
-- instead of getting an empty report.
--
-- Won/lost deals are dated by `updated_at` (deals keep no separate
-- closed_at), which is when the status last changed.
--
-- Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION report_overview(
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

  WITH msgs AS (
    SELECT m.id,
           m.conversation_id,
           m.sender_type,
           m.ai_generated,
           m.created_at,
           c.assigned_agent_id,
           LAG(m.sender_type) OVER (
             PARTITION BY m.conversation_id ORDER BY m.created_at, m.id
           ) AS prev_sender
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.account_id = p_account
      AND m.created_at >= p_from
      AND m.created_at <  p_to
  ),
  totals AS (
    SELECT count(*)                                           AS total,
           count(*) FILTER (WHERE sender_type = 'customer')   AS inbound,
           count(*) FILTER (WHERE sender_type <> 'customer')  AS outbound,
           count(*) FILTER (WHERE ai_generated IS TRUE)       AS ai_messages
    FROM msgs
  ),
  per_day AS (
    SELECT to_char(created_at AT TIME ZONE p_tz, 'YYYY-MM-DD') AS day,
           count(*) FILTER (WHERE sender_type = 'customer')   AS inbound,
           count(*) FILTER (WHERE sender_type <> 'customer')  AS outbound
    FROM msgs
    GROUP BY 1
  ),
  bursts AS (
    SELECT id, conversation_id, created_at
    FROM msgs
    WHERE sender_type = 'customer'
      AND (prev_sender IS NULL OR prev_sender <> 'customer')
  ),
  resp AS (
    SELECT EXTRACT(EPOCH FROM (n.created_at - b.created_at))::float8 AS secs,
           (n.sender_type = 'agent')                                  AS by_human
    FROM bursts b
    CROSS JOIN LATERAL (
      SELECT m2.created_at, m2.sender_type
      FROM messages m2
      WHERE m2.conversation_id = b.conversation_id
        AND m2.sender_type IN ('agent', 'bot')
        AND m2.created_at > b.created_at
      ORDER BY m2.created_at
      LIMIT 1
    ) n
    WHERE n.created_at - b.created_at < interval '24 hours'
  ),
  response AS (
    SELECT count(*)                                                        AS samples,
           avg(secs)                                                       AS avg_secs,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY secs)               AS median_secs,
           count(*) FILTER (WHERE by_human)                                AS human_samples,
           avg(secs) FILTER (WHERE by_human)                               AS human_avg_secs,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY secs)
             FILTER (WHERE by_human)                                       AS human_median_secs
    FROM resp
  ),
  sales_deals AS (
    SELECT d.*
    FROM deals d
    JOIN pipelines p ON p.id = d.pipeline_id
    WHERE d.account_id = p_account
      AND COALESCE(p.is_scheduling, false) = false
  ),
  deal_totals AS (
    SELECT count(*) FILTER (WHERE created_at >= p_from AND created_at < p_to)       AS created,
           count(*) FILTER (WHERE status = 'won'  AND updated_at >= p_from AND updated_at < p_to) AS won,
           COALESCE(sum(value) FILTER (WHERE status = 'won' AND updated_at >= p_from AND updated_at < p_to), 0) AS won_value,
           count(*) FILTER (WHERE status = 'lost' AND updated_at >= p_from AND updated_at < p_to) AS lost,
           count(*) FILTER (WHERE status = 'open')                                  AS open_now,
           COALESCE(sum(value) FILTER (WHERE status = 'open'), 0)                   AS open_value
    FROM sales_deals
  ),
  stage_rows AS (
    SELECT s.id, s.name, s.color, s.position, pl.name AS pipeline,
           count(d.id)                  AS deals,
           COALESCE(sum(d.value), 0)    AS value
    FROM pipeline_stages s
    JOIN pipelines pl ON pl.id = s.pipeline_id
    LEFT JOIN sales_deals d ON d.stage_id = s.id AND d.status = 'open'
    WHERE pl.account_id = p_account
      AND COALESCE(pl.is_scheduling, false) = false
    GROUP BY s.id, s.name, s.color, s.position, pl.name
  ),
  csat_rows AS (
    SELECT * FROM csat_responses
    WHERE account_id = p_account AND sent_at >= p_from AND sent_at < p_to
  ),
  csat AS (
    SELECT count(*)                                         AS sent,
           count(*) FILTER (WHERE answered_at IS NOT NULL)  AS answered,
           avg(score) FILTER (WHERE answered_at IS NOT NULL) AS avg_score,
           count(*) FILTER (WHERE score = 1) AS s1,
           count(*) FILTER (WHERE score = 2) AS s2,
           count(*) FILTER (WHERE score = 3) AS s3,
           count(*) FILTER (WHERE score = 4) AS s4,
           count(*) FILTER (WHERE score = 5) AS s5
    FROM csat_rows
  ),
  agent_msgs AS (
    SELECT assigned_agent_id AS user_id,
           count(DISTINCT conversation_id)                       AS conversations,
           count(*) FILTER (WHERE sender_type = 'customer')      AS inbound,
           count(*) FILTER (WHERE sender_type = 'agent')         AS replies
    FROM msgs
    WHERE assigned_agent_id IS NOT NULL
    GROUP BY assigned_agent_id
  ),
  agent_deals AS (
    SELECT assigned_to AS user_id,
           count(*)                  AS won,
           COALESCE(sum(value), 0)   AS won_value
    FROM sales_deals
    WHERE status = 'won' AND updated_at >= p_from AND updated_at < p_to
      AND assigned_to IS NOT NULL
    GROUP BY assigned_to
  ),
  agents AS (
    SELECT pr.user_id,
           COALESCE(NULLIF(pr.full_name, ''), pr.email) AS name,
           COALESCE(am.conversations, 0) AS conversations,
           COALESCE(am.inbound, 0)       AS inbound,
           COALESCE(am.replies, 0)       AS replies,
           COALESCE(ad.won, 0)           AS won,
           COALESCE(ad.won_value, 0)     AS won_value
    FROM profiles pr
    LEFT JOIN agent_msgs  am ON am.user_id = pr.user_id
    LEFT JOIN agent_deals ad ON ad.user_id = pr.user_id
    WHERE pr.account_id = p_account
  )
  SELECT jsonb_build_object(
    'totals',   (SELECT to_jsonb(t) FROM totals t),
    'per_day',  COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.day) FROM per_day x), '[]'::jsonb),
    'response', (SELECT to_jsonb(r) FROM response r),
    'deals',    (SELECT to_jsonb(d) FROM deal_totals d),
    'stages',   COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.pipeline, s.position) FROM stage_rows s), '[]'::jsonb),
    'csat',     (SELECT to_jsonb(c) FROM csat c),
    'agents',   COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.won DESC, a.replies DESC, a.name) FROM agents a), '[]'::jsonb)
  )
  INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION report_overview(uuid, timestamptz, timestamptz, text) TO authenticated;
