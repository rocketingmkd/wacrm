-- ============================================================
-- 041_platform_billing.sql — Platform billing (trials + paid plans)
--
-- Turns wacrm from "every account has full access forever" into a
-- SaaS with a free trial and paid plans, billed externally by
-- Rocketing Pay (a Bearer-token webhook, see
-- src/app/api/billing/webhook/route.ts). Also introduces a
-- cross-tenant "platform admin" role (Rocketing staff) for a new
-- /platform panel that manages every account's billing state.
--
-- What this migration does
--   1. account_billing — one row per account, billing status/plan/
--      trial/period. NOT columns on `accounts` (see below).
--   2. is_account_member_role() — the pure role-rank check, split out
--      of is_account_member() so two pre-existing admin-level SELECT
--      policies can keep reading without tripping the new write-lock.
--   3. account_write_locked() — true when a trial has lapsed or the
--      account is expired/canceled. No cron: it compares
--      trial_ends_at against NOW() at evaluation time.
--   4. is_account_member() — CREATE OR REPLACE on the EXISTING
--      signature from 017. Write-checks (min_role >= 'agent') now
--      also require the account NOT be write_locked. Every RLS
--      policy in the app already routes through this one function
--      (~60 write policies, ~30 read policies), so this single
--      change is what makes the whole app read-only for a locked
--      account — no other policy needs to be touched.
--   5. platform_settings — singleton row, default_trial_days.
--   6. handle_new_user — CREATE OR REPLACE to also seed the new
--      account's account_billing row (status='trialing').
--   7. platform_admins — Rocketing staff flag. Deliberately NOT a
--      column on `profiles` (profiles_update lets a user edit their
--      own row — a privilege column there would be a one-line
--      self-promotion). RLS on, zero policies, REVOKE ALL from every
--      PostgREST-reachable role, and a trigger that refuses any
--      write whose current_user isn't supabase_admin — not even the
--      service-role key can grant platform admin through the app.
--   8. billing_webhook_logs — every Rocketing Pay webhook attempt.
--      The unique partial index on idempotency_key IS the
--      idempotency mechanism (insert first; a 23505 means duplicate).
--   9. platform_audit_log — every manual staff action from /platform.
--  10. platform_account_overview — the read model /platform lists
--      from (service-role only).
--
-- Why account_billing is its own table, not columns on `accounts`:
--   accounts_update (017) is `is_account_member(id, 'admin')`. If
--   trial_ends_at lived on `accounts`, any account admin could
--   self-extend their own trial from the browser console. Billing
--   state needs to be unreachable from the client entirely —
--   account_billing has RLS ON with NO write policies at all, so
--   only the service role (the webhook + the /platform API routes)
--   can ever touch it.
--
-- Backfill safety: every EXISTING account gets status='active', never
-- 'trialing' — otherwise this migration would instantly write-lock
-- every account already in production the moment it runs.
--
-- account_write_locked() fails OPEN (false) when no account_billing
-- row exists at all. A missing row (trigger race, hand-inserted
-- account, or the app deploying before this migration runs) must
-- never brick a real account — see also isAccountWriteLocked() in
-- src/lib/billing/write-lock.ts, which treats "function/relation
-- doesn't exist yet" the same way for the reverse ordering mistake
-- (app deployed before this migration).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- TYPES
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'billing_status_enum') THEN
    CREATE TYPE billing_status_enum AS ENUM
      ('trialing', 'active', 'past_due', 'expired', 'canceled');
  END IF;
END $$;

-- ============================================================
-- ACCOUNT_BILLING
-- ============================================================
CREATE TABLE IF NOT EXISTS account_billing (
  account_id                uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  status                    billing_status_enum NOT NULL DEFAULT 'trialing',
  -- Plan slug from ROCKETING_PAY_PRODUCT_PLAN_MAP (src/lib/billing/rocketing-pay.ts).
  -- NULL while trialing — no plan has been purchased yet.
  plan                      text,
  trial_ends_at             timestamptz,
  -- Set from data.proxima_cobranca on approved/renewal events.
  current_period_end        timestamptz,
  external_product_id       text,
  external_subscription_id  text,
  -- Lower-cased. The match key the webhook uses to find this account
  -- when the checkout email differs from the account owner's email.
  external_customer_email   text,
  last_payment_at           timestamptz,
  last_payment_amount       numeric(12, 2),
  last_payment_method       text,
  -- Set the first time a charge fails; cleared on the next successful
  -- charge. Distinguishes "just went past_due" from "been past_due a
  -- while" for the /platform UI, without needing a separate log query.
  past_due_since            timestamptz,
  notes                     text,
  updated_by_user_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_billing_status ON account_billing(status);
CREATE INDEX IF NOT EXISTS idx_account_billing_email
  ON account_billing(external_customer_email)
  WHERE external_customer_email IS NOT NULL;

ALTER TABLE account_billing ENABLE ROW LEVEL SECURITY;
-- Read-only for the account's own members: the dashboard (useAuth,
-- src/hooks/use-auth.tsx) reads this directly so the trial/past-due
-- banner and button-disabling can work client-side without a bespoke
-- API route — a customer seeing their own plan/trial/status is not a
-- security concern. NO write policy exists for authenticated/anon at
-- all, in either direction — only the service role (the webhook +
-- the /platform API routes) can ever write this table, so an account
-- admin still cannot self-extend their own trial from devtools.
CREATE POLICY account_billing_select ON account_billing FOR SELECT
  USING (is_account_member(account_id));

DROP TRIGGER IF EXISTS set_updated_at ON account_billing;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON account_billing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- is_account_member_role() — the pure rank check, split out of
-- is_account_member() below so the two pre-existing admin-level
-- SELECT policies (account_invitations, ai_usage_log) can keep
-- reading on a write-locked account instead of being incorrectly
-- treated as write paths. Body is byte-identical to the pre-041
-- is_account_member() from 017_account_sharing.sql:136.
-- ============================================================
CREATE OR REPLACE FUNCTION is_account_member_role(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND CASE p.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  );
$$;

ALTER FUNCTION is_account_member_role(UUID, account_role_enum) OWNER TO supabase_admin;
GRANT EXECUTE ON FUNCTION is_account_member_role(UUID, account_role_enum) TO authenticated, service_role;

-- ============================================================
-- account_write_locked() — true iff the account may not write.
--
-- FAILS OPEN (returns FALSE) when no account_billing row exists.
-- A trigger race, a hand-inserted account, or a deploy-ordering
-- mistake (app live before this migration) must never lock out a
-- real, paying account.
-- ============================================================
CREATE OR REPLACE FUNCTION account_write_locked(target_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT b.status IN ('expired', 'canceled')
        OR (
          b.status = 'trialing'
          AND b.trial_ends_at IS NOT NULL
          AND b.trial_ends_at <= NOW()
        )
    FROM account_billing b
    WHERE b.account_id = target_account_id
  ), FALSE);
$$;

ALTER FUNCTION account_write_locked(UUID) OWNER TO supabase_admin;
GRANT EXECUTE ON FUNCTION account_write_locked(UUID) TO authenticated, service_role;

-- ============================================================
-- is_account_member() — CREATE OR REPLACE on the EXISTING signature
-- from 017. No policy needs to change: every one of the ~90 RLS
-- policies across the app already calls this function by name, so
-- redefining its body is the entire blast radius for "read-only on a
-- locked account" — except the two admin-level SELECT policies
-- below, which must keep working for a locked account's own admin to
-- see what happened (billing history, invitations).
--
-- IMPORTANT — do not blindly re-run `ALTER FUNCTION ... OWNER TO`
-- against a live database without first checking the CURRENT owner
-- (`\df+ is_account_member`). CREATE OR REPLACE preserves the
-- existing owner; only re-assign it if you've confirmed doing so is
-- safe for this SECURITY DEFINER function in this environment.
-- ============================================================
CREATE OR REPLACE FUNCTION is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_account_member_role(target_account_id, min_role)
     AND CASE
           WHEN min_role = 'viewer' THEN TRUE
           ELSE NOT account_write_locked(target_account_id)
         END;
$$;

GRANT EXECUTE ON FUNCTION is_account_member(UUID, account_role_enum) TO authenticated, service_role;

-- The only two pre-041 policies that used is_account_member(..., 'admin')
-- for a *read* path, not a write path. Left on is_account_member() they
-- would incorrectly go blind the moment an account is write-locked, even
-- though "see your own pending invitations" and "see your own AI spend"
-- are exactly what a locked-out admin needs while sorting out payment.
DROP POLICY IF EXISTS account_invitations_select ON account_invitations;
CREATE POLICY account_invitations_select ON account_invitations FOR SELECT
  USING (is_account_member_role(account_id, 'admin'));

DROP POLICY IF EXISTS ai_usage_log_select ON ai_usage_log;
CREATE POLICY ai_usage_log_select ON ai_usage_log FOR SELECT
  USING (is_account_member_role(account_id, 'admin'));

-- ============================================================
-- PLATFORM_SETTINGS — singleton row. A table (not an env var)
-- because staff edit default_trial_days from /platform without a
-- redeploy. Service-role only — no policies, all grants revoked.
-- ============================================================
CREATE TABLE IF NOT EXISTS platform_settings (
  id                  smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_trial_days  integer NOT NULL DEFAULT 7 CHECK (default_trial_days BETWEEN 0 AND 365),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
INSERT INTO platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_settings FROM anon, authenticated;

-- ============================================================
-- HANDLE_NEW_USER — CREATE OR REPLACE to also seed account_billing.
-- Kept inside the SAME function body (same EXCEPTION WHEN OTHERS
-- wrapper as 017) so a billing hiccup degrades to "no trial row yet"
-- (account_write_locked fails open) rather than breaking signup.
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
  v_trial_days INTEGER;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  SELECT default_trial_days INTO v_trial_days FROM public.platform_settings WHERE id = 1;

  INSERT INTO public.account_billing (account_id, status, trial_ends_at, external_customer_email)
  VALUES (
    v_account_id,
    'trialing',
    NOW() + make_interval(days => COALESCE(v_trial_days, 7)),
    LOWER(NEW.email)
  )
  ON CONFLICT (account_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile/billing for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- Trigger itself is unchanged (still on_auth_user_created → handle_new_user);
-- CREATE OR REPLACE above is enough, no DROP/CREATE TRIGGER needed.

-- ============================================================
-- BACKFILL — every account that predates this migration is 'active',
-- never 'trialing'. Getting this wrong write-locks all of production
-- the instant this migration runs.
-- ============================================================
INSERT INTO account_billing (account_id, status, external_customer_email)
SELECT a.id, 'active', LOWER(p.email)
FROM accounts a
LEFT JOIN profiles p ON p.user_id = a.owner_user_id
ON CONFLICT (account_id) DO NOTHING;

-- ============================================================
-- PLATFORM_ADMINS — Rocketing staff flag. Separate table, not a
-- profiles column (see header). RLS on, zero policies, ALL grants
-- revoked from every PostgREST-reachable role — unreachable from the
-- app entirely, in either direction. Granted only via direct SQL as
-- supabase_admin:
--
--   INSERT INTO platform_admins (user_id, note)
--   SELECT id, 'Leandro — founder' FROM auth.users WHERE email = '...';
-- ============================================================
CREATE TABLE IF NOT EXISTS platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_admins FROM anon, authenticated, service_role;

-- Belt-and-braces: even a leaked service-role key cannot grant staff
-- through this trigger, because the app never runs as supabase_admin.
CREATE OR REPLACE FUNCTION enforce_platform_admin_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION
      'platform_admins is managed out-of-band; grant it via psql as supabase_admin'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS enforce_platform_admin_immutable ON platform_admins;
CREATE TRIGGER enforce_platform_admin_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON platform_admins
  FOR EACH ROW EXECUTE FUNCTION enforce_platform_admin_immutable();

CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM platform_admins pa WHERE pa.user_id = auth.uid());
$$;

ALTER FUNCTION is_platform_admin() OWNER TO supabase_admin;
GRANT EXECUTE ON FUNCTION is_platform_admin() TO authenticated, service_role;

-- ============================================================
-- BILLING_WEBHOOK_LOGS — every Rocketing Pay webhook attempt,
-- success or failure. The unique partial index on idempotency_key IS
-- the idempotency mechanism: the webhook route inserts the log row
-- FIRST, and a 23505 unique-violation means "already processed,
-- don't reapply" (see src/app/api/billing/webhook/route.ts).
-- Service-role only.
-- ============================================================
CREATE TABLE IF NOT EXISTS billing_webhook_logs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at              timestamptz NOT NULL DEFAULT now(),
  account_id               uuid REFERENCES accounts(id) ON DELETE SET NULL,
  email                    text,
  event                    text,
  resolved_status          text,
  -- activated|renewed|trial_set|past_due|locked|ignored|no_account|
  -- auth_failed|invalid|duplicate
  action                   text NOT NULL,
  outcome                  text NOT NULL CHECK (outcome IN ('success', 'ignored', 'error')),
  error_message            text,
  idempotency_key          text,
  external_transaction_id  text,
  external_product_id      text,
  amount                   numeric(12, 2),
  payload                  jsonb,
  headers                  jsonb
);

CREATE INDEX IF NOT EXISTS idx_bwl_received ON billing_webhook_logs(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_bwl_account  ON billing_webhook_logs(account_id, received_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bwl_idem
  ON billing_webhook_logs(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE billing_webhook_logs ENABLE ROW LEVEL SECURITY;
-- No policies — service role only (the webhook route + /platform/webhooks).

-- ============================================================
-- PLATFORM_AUDIT_LOG — every manual staff action from /platform
-- (extend trial, set plan, force status, edit default_trial_days).
-- Service-role only.
-- ============================================================
CREATE TABLE IF NOT EXISTS platform_audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  account_id     uuid REFERENCES accounts(id) ON DELETE SET NULL,
  action         text NOT NULL,
  before         jsonb,
  after          jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pal_created ON platform_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pal_account ON platform_audit_log(account_id, created_at DESC);

ALTER TABLE platform_audit_log ENABLE ROW LEVEL SECURITY;
-- No policies — service role only.

-- ============================================================
-- PLATFORM_ACCOUNT_OVERVIEW — the read model the /platform account
-- list queries. Service-role only (view inherits no RLS of its own,
-- but nothing grants anon/authenticated SELECT on it).
--
-- Deliberately omits a "last activity" column: a correlated
-- MAX(messages.created_at) per account would scan the largest table
-- in the database on every page load of the list. Add it later as a
-- materialized/denormalized column if staff actually need it.
-- ============================================================
CREATE OR REPLACE VIEW platform_account_overview AS
SELECT
  a.id,
  a.name,
  a.created_at,
  ow.email AS owner_email,
  ow.full_name AS owner_name,
  b.status,
  b.plan,
  b.trial_ends_at,
  b.current_period_end,
  b.external_subscription_id,
  b.past_due_since,
  b.notes,
  (SELECT COUNT(*) FROM profiles p WHERE p.account_id = a.id) AS member_count,
  (SELECT COUNT(*) FROM contacts c WHERE c.account_id = a.id) AS contact_count
FROM accounts a
LEFT JOIN account_billing b ON b.account_id = a.id
LEFT JOIN profiles ow       ON ow.user_id  = a.owner_user_id;

REVOKE ALL ON platform_account_overview FROM anon, authenticated;

-- ============================================================
-- ROLLBACK (commented out — paste and run manually if this migration
-- needs to be reverted after deploy). Restores the pre-041 body of
-- is_account_member() verbatim from 017_account_sharing.sql:136.
-- Does NOT drop the new tables (safe to leave them; they're inert
-- once is_account_member() no longer reads account_write_locked()).
-- ============================================================
-- CREATE OR REPLACE FUNCTION is_account_member(
--   target_account_id UUID,
--   min_role account_role_enum DEFAULT 'viewer'
-- ) RETURNS BOOLEAN
-- LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
--   SELECT EXISTS (
--     SELECT 1 FROM profiles p
--     WHERE p.user_id = auth.uid()
--       AND p.account_id = target_account_id
--       AND CASE p.account_role
--             WHEN 'owner' THEN 4 WHEN 'admin' THEN 3
--             WHEN 'agent' THEN 2 WHEN 'viewer' THEN 1 END
--         >= CASE min_role
--             WHEN 'owner' THEN 4 WHEN 'admin' THEN 3
--             WHEN 'agent' THEN 2 WHEN 'viewer' THEN 1 END
--   );
-- $$;
