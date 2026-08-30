-- ============================================================
-- 044_ai_agents.sql — evolve `ai_configs` into `ai_agents` (multi-agent
-- AI reply system).
--
-- Problem: `ai_configs` was UNIQUE(account_id) — exactly one AI setup
-- per workspace, applied uniformly to every conversation. The product
-- is moving to N named agents per account (e.g. "Suporte", "Vendas"),
-- each with its own provider/model/prompt, that can transfer a
-- conversation between themselves or to a human. See the plan at
-- the time of this migration for the full design.
--
-- Approach: RENAME the existing table rather than create a new one +
-- migrate data — every column wacrm already has (provider, model,
-- api_key, system_prompt, is_active, auto_reply_enabled,
-- auto_reply_max_per_conversation, handoff_agent_id,
-- embeddings_api_key, created_by, created_at, updated_at) is exactly
-- what one agent needs. RENAME preserves the primary key, all
-- existing rows, and doesn't require touching any FK from another
-- table (confirmed: nothing references ai_configs.id today — only
-- ai_configs → accounts/auth.users outward FKs exist).
--
-- What changes:
--   1. Drop UNIQUE(account_id) — an account can now have many agents.
--   2. Add name / slug / description / is_receptionist.
--   3. Backfill: every pre-existing row (there should be very few —
--      zero in production as of this migration) becomes that
--      account's receptionist, named "Assistente" / slug "assistente"
--      — behaviourally IDENTICAL to today (single agent, no transfer
--      block in the prompt since there are no sibling agents yet).
--   4. UNIQUE(account_id, slug) + exactly one receptionist per
--      account (partial unique index).
--   5. RLS policies + the updated_at trigger, renamed to match
--      (same is_account_member() body as 029 — settings-class: any
--      member reads, admin+ writes).
--
-- Conversation routing (`conversations.active_ai_agent_id`) and
-- per-agent knowledge base / usage logging are separate follow-up
-- migrations (045, 046) — this one only reshapes the agent table
-- itself so it's independently deployable and verifiable.
--
-- Idempotent — safe to re-run.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'ai_configs' AND schemaname = 'public')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'ai_agents' AND schemaname = 'public')
  THEN
    ALTER TABLE ai_configs RENAME TO ai_agents;
  END IF;
END $$;

-- Drop the old one-per-account constraint. Idempotent guard since
-- ALTER TABLE ... DROP CONSTRAINT IF EXISTS handles a re-run cleanly.
ALTER TABLE ai_agents DROP CONSTRAINT IF EXISTS ai_configs_account_id_key;

ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS is_receptionist boolean NOT NULL DEFAULT false;

-- Backfill: any row that predates this migration becomes the
-- account's receptionist. Zero behavior change — one agent, no
-- siblings, the transfer-menu prompt block stays empty (see
-- buildSystemPrompt in src/lib/ai/defaults.ts).
UPDATE ai_agents
SET name = 'Assistente', slug = 'assistente', is_receptionist = true
WHERE name IS NULL;

ALTER TABLE ai_agents
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN slug SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_agents_account_slug_key'
  ) THEN
    ALTER TABLE ai_agents ADD CONSTRAINT ai_agents_account_slug_key UNIQUE (account_id, slug);
  END IF;
END $$;

-- Exactly one receptionist per account — the fixed agent that starts
-- every new conversation (routing decision: no rule engine, always
-- this one). Partial unique index enforces it at the DB level so a
-- buggy client can't silently create two.
CREATE UNIQUE INDEX IF NOT EXISTS ai_agents_one_receptionist
  ON ai_agents(account_id) WHERE is_receptionist;

-- ============================================================
-- RLS — same shape as 029, renamed. Settings-class: any member
-- (viewer+) reads the roster; only admin+ may create/update/delete.
-- ============================================================
DROP POLICY IF EXISTS ai_configs_select ON ai_agents;
DROP POLICY IF EXISTS ai_configs_insert ON ai_agents;
DROP POLICY IF EXISTS ai_configs_update ON ai_agents;
DROP POLICY IF EXISTS ai_configs_delete ON ai_agents;

DROP POLICY IF EXISTS ai_agents_select ON ai_agents;
CREATE POLICY ai_agents_select ON ai_agents FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_agents_insert ON ai_agents;
CREATE POLICY ai_agents_insert ON ai_agents FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_agents_update ON ai_agents;
CREATE POLICY ai_agents_update ON ai_agents FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_agents_delete ON ai_agents;
CREATE POLICY ai_agents_delete ON ai_agents FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- updated_at trigger — rename function + trigger to match. The old
-- trigger (bound to the old function name) is dropped and recreated
-- against the renamed table; RENAME TABLE alone does not rename
-- triggers/functions, so this is required, not cosmetic.
CREATE OR REPLACE FUNCTION public.update_ai_agents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_configs_updated_at ON ai_agents;
DROP TRIGGER IF EXISTS ai_agents_updated_at ON ai_agents;
CREATE TRIGGER ai_agents_updated_at
  BEFORE UPDATE ON ai_agents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ai_agents_updated_at();
