-- ============================================================
-- 077_copilot_radar.sql
--
-- "Copiloto IA" radar: an account-wide view of conversations that need
-- attention, in three kinds:
--
--   bottleneck   a customer is waiting for an answer (rule based, no AI)
--   quality      the customer shows frustration (AI reading)
--   opportunity  clear buying intent not closed yet / a lead going cold
--                (AI reading)
--
-- Read-only: the radar never sends a message and never moves a card.
--
--   1. copilot_insights   — one OPEN row per (conversation, kind); a
--      member resolves it from the radar. Writes that create / refresh
--      rows come only from the service role (the scan), members may
--      only resolve (UPDATE) their account's rows.
--   2. copilot_radar_state — per-conversation cache of the last AI
--      reading, keyed by the text-message count at analysis time, so a
--      scan skips the LLM call for conversations that did not move.
--      Service role only (RLS on, no policies).
--   3. copilot_scan_runs  — one row per scan, for the "last analysis"
--      line and to show why the AI step was skipped.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS copilot_insights (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('bottleneck', 'quality', 'opportunity')),
  severity         TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'critical')),
  title            TEXT NOT NULL,
  description      TEXT,
  -- Raw facts behind the insight (waiting since, AI signals, ...).
  evidence         JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_at      TIMESTAMPTZ,
  -- NULL when the scan itself closed it (the customer got an answer).
  resolved_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most one open insight per conversation and kind.
CREATE UNIQUE INDEX IF NOT EXISTS uq_copilot_insights_open
  ON copilot_insights(conversation_id, kind)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_copilot_insights_account
  ON copilot_insights(account_id, created_at DESC);

ALTER TABLE copilot_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS copilot_insights_select ON copilot_insights;
CREATE POLICY copilot_insights_select ON copilot_insights
  FOR SELECT USING (is_account_member(account_id));

-- Resolving is the only member-side write; it cannot move a row to
-- another account (WITH CHECK repeats the membership test).
DROP POLICY IF EXISTS copilot_insights_resolve ON copilot_insights;
CREATE POLICY copilot_insights_resolve ON copilot_insights
  FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS copilot_radar_state (
  conversation_id  UUID PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  msg_count        INTEGER NOT NULL DEFAULT 0,
  signals          JSONB NOT NULL DEFAULT '{}'::jsonb,
  analyzed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_copilot_radar_state_account
  ON copilot_radar_state(account_id);

ALTER TABLE copilot_radar_state ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS copilot_scan_runs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  triggered_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- ok: AI step ran; skipped: AI not set up; error: the provider failed.
  ai_status         TEXT NOT NULL CHECK (ai_status IN ('ok', 'skipped', 'error')),
  ai_error          TEXT,
  conversations_analyzed INTEGER NOT NULL DEFAULT 0,
  insights_created  INTEGER NOT NULL DEFAULT 0,
  insights_resolved INTEGER NOT NULL DEFAULT 0,
  provider          TEXT,
  model             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_copilot_scan_runs_account
  ON copilot_scan_runs(account_id, created_at DESC);

ALTER TABLE copilot_scan_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS copilot_scan_runs_select ON copilot_scan_runs;
CREATE POLICY copilot_scan_runs_select ON copilot_scan_runs
  FOR SELECT USING (is_account_member(account_id));
