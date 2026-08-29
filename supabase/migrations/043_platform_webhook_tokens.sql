-- ============================================================
-- 043_platform_webhook_tokens.sql — DB-backed, UI-rotatable webhook
-- auth tokens for platform integrations (Rocketing Pay first).
--
-- Problem: ROCKETING_PAY_WEBHOOK_TOKEN was a plain environment
-- variable — only rotatable by SSHing into the VPS, editing .env,
-- and redeploying. Staff asked for the same "generate in the UI,
-- shown once, never again" flow the CRM already has for API keys
-- (migration 026, src/lib/api-keys/keys.ts) and outbound webhook
-- secrets (migration 028).
--
-- `integration` is a free-text primary key (not an enum) so a future
-- integration can get its own row without a schema migration — one
-- row per external system's webhook, each independently rotatable.
-- Only the SHA-256 hash is stored (fast hash is correct here for the
-- same reason as api_keys: this is full-entropy random data, not a
-- user-chosen password — see the header of keys.ts). `token_prefix`
-- is a short DISPLAY-ONLY fragment (never enough to brute-force the
-- rest) so staff can recognize "yes, a token exists" without ever
-- seeing the secret again after generation.
--
-- RLS: enabled, ZERO policies — same as account_billing/
-- platform_settings. Only the service role (the /platform API routes
-- and the billing webhook route itself) ever reads or writes this.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_webhook_tokens (
  integration           text PRIMARY KEY,
  token_hash            text NOT NULL,
  token_prefix          text NOT NULL,
  generated_at           timestamptz NOT NULL DEFAULT now(),
  generated_by_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE platform_webhook_tokens ENABLE ROW LEVEL SECURITY;
-- No policies — service role only.
