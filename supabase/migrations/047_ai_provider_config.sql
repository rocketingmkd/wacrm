-- ============================================================
-- 047_ai_provider_config.sql — one shared BYO credential per account,
-- instead of one per agent.
--
-- Follow-up to the multi-agent design (044-046): in practice an
-- account has ONE provider key it pays for, and every agent should use
-- it — re-entering the same key for a 2nd/3rd agent was pure friction,
-- not a real need (an agent's own MODEL can still differ; that stays
-- on ai_agents). This moves provider/api_key/embeddings_api_key off
-- ai_agents onto a new one-row-per-account table.
--
-- Backfill: as of this migration, production has zero ai_agents rows
-- (the multi-agent feature shipped without any client having created
-- an agent yet), so the backfill below is a defensive no-op, not the
-- primary path — it exists so this migration is still correct if run
-- against an environment that DOES have agents (e.g. a future staging
-- DB seeded from a backup). Picks each account's receptionist as the
-- source of truth (guaranteed unique per account, migration 044's
-- partial index) since every agent on an account was meant to share
-- one key.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_provider_config (
  account_id           uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  provider             text NOT NULL CHECK (provider IN ('openai', 'anthropic')),
  api_key              text NOT NULL,
  embeddings_api_key   text,
  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_provider_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_provider_config_select ON ai_provider_config;
CREATE POLICY ai_provider_config_select ON ai_provider_config FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_provider_config_insert ON ai_provider_config;
CREATE POLICY ai_provider_config_insert ON ai_provider_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_provider_config_update ON ai_provider_config;
CREATE POLICY ai_provider_config_update ON ai_provider_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_provider_config_delete ON ai_provider_config;
CREATE POLICY ai_provider_config_delete ON ai_provider_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_ai_provider_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_provider_config_updated_at ON ai_provider_config;
CREATE TRIGGER ai_provider_config_updated_at
  BEFORE UPDATE ON ai_provider_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ai_provider_config_updated_at();

-- Backfill (see header) — one credential row per account, sourced from
-- its receptionist. ON CONFLICT DO NOTHING: a re-run, or an account
-- that (implausibly) already has a row, is left untouched rather than
-- clobbered.
INSERT INTO ai_provider_config (account_id, provider, api_key, embeddings_api_key, created_by, created_at)
SELECT a.account_id, a.provider, a.api_key, a.embeddings_api_key, a.created_by, a.created_at
FROM ai_agents a
WHERE a.is_receptionist
ON CONFLICT (account_id) DO NOTHING;

-- Now that credentials live in ai_provider_config, drop them from
-- ai_agents. `model` stays — it's still a legitimate per-agent choice.
ALTER TABLE ai_agents DROP COLUMN IF EXISTS provider;
ALTER TABLE ai_agents DROP COLUMN IF EXISTS api_key;
ALTER TABLE ai_agents DROP COLUMN IF EXISTS embeddings_api_key;
