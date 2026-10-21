-- ============================================================
-- 071_unofficial_webhook_registered.sql — webhook registration marker
--
-- Groups now reach the CRM on their own (no per-group selection), so the
-- Evolution webhook is registered when the unofficial session is
-- activated instead of when groups are picked. This column records when
-- that registration last succeeded, so a session that was already active
-- before this change gets its webhook registered once, on the next load
-- of the settings card.
--
-- whatsapp_groups (070) is no longer read; it is left in place.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE whatsapp_unofficial_sessions
  ADD COLUMN IF NOT EXISTS webhook_set_at timestamptz;
