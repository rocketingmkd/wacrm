-- ============================================================
-- 065_unofficial_allow_cold_open.sql — opt-in to open brand-new conversations
--
-- The unofficial session was limited to contacts who had already
-- written to the account. "Nova conversa" (type a number, like the
-- WhatsApp Business app) needs to message numbers with no history, which
-- is the riskiest use of an unofficial session, so it gets its own
-- switch, off by default, on top of `enabled`. The per-lead and daily
-- limits still apply.
--
-- Idempotent.
-- ============================================================

ALTER TABLE whatsapp_unofficial_sessions
  ADD COLUMN IF NOT EXISTS allow_cold_open boolean NOT NULL DEFAULT false;
