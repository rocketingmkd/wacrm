-- ============================================================
-- 063_whatsapp_unofficial_sessions.sql — Evolution (unofficial) session per account
--
-- Hybrid transport plan (2026-10-15): the official Cloud API stays the
-- default for everything, including 100% of broadcasts. An unofficial
-- Evolution session is used ONLY to (a) open a conversation when the
-- 24h window is closed and (b) groups. This table holds one session
-- per account. It is opt-in: `enabled` defaults to false and can only
-- be turned on after the admin accepts the ban-risk notice
-- (`risk_accepted_at`).
--
-- The Evolution server URL and global API key live in the app env
-- (EVOLUTION_API_URL / EVOLUTION_API_KEY), not here: tenants never see
-- them. Only the per-account instance name is stored.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_unofficial_sessions (
  account_id        uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  instance_name     text NOT NULL UNIQUE,
  status            text NOT NULL DEFAULT 'disconnected'
                      CHECK (status IN ('disconnected', 'connecting', 'connected')),
  -- Number the session is paired with (digits only). Must be the same
  -- number as the official config, otherwise a reply would open the
  -- window on the wrong number.
  phone             text,
  -- Opt-in switch. Off by default; the UI only allows turning it on
  -- after the risk notice is accepted.
  enabled           boolean NOT NULL DEFAULT false,
  risk_accepted_at  timestamptz,
  risk_accepted_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Guard rails for the reopening flow (enforced in a later phase).
  max_per_lead      smallint NOT NULL DEFAULT 2 CHECK (max_per_lead >= 1),
  daily_limit       integer  NOT NULL DEFAULT 30 CHECK (daily_limit >= 1),
  connected_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Can't be enabled without the risk notice accepted.
  CONSTRAINT unofficial_enabled_requires_risk
    CHECK (enabled = false OR risk_accepted_at IS NOT NULL)
);

ALTER TABLE whatsapp_unofficial_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_unofficial_sessions_select ON whatsapp_unofficial_sessions;
CREATE POLICY whatsapp_unofficial_sessions_select ON whatsapp_unofficial_sessions FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS whatsapp_unofficial_sessions_insert ON whatsapp_unofficial_sessions;
CREATE POLICY whatsapp_unofficial_sessions_insert ON whatsapp_unofficial_sessions FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS whatsapp_unofficial_sessions_update ON whatsapp_unofficial_sessions;
CREATE POLICY whatsapp_unofficial_sessions_update ON whatsapp_unofficial_sessions FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS whatsapp_unofficial_sessions_delete ON whatsapp_unofficial_sessions;
CREATE POLICY whatsapp_unofficial_sessions_delete ON whatsapp_unofficial_sessions FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS whatsapp_unofficial_sessions_updated_at ON whatsapp_unofficial_sessions;
CREATE TRIGGER whatsapp_unofficial_sessions_updated_at
  BEFORE UPDATE ON whatsapp_unofficial_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
