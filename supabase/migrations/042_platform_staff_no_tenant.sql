-- ============================================================
-- 042_platform_staff_no_tenant.sql — platform-staff logins never get
-- a customer tenant account.
--
-- Problem: handle_new_user() (017, extended by 041) fires for EVERY
-- new auth.users row unconditionally — it can't tell "a customer just
-- signed up" apart from "we just created a management-only login for
-- Rocketing staff" via the Admin API. The first platform-staff account
-- (admin@gmail.com) ended up with a full customer account + profile +
-- trial, which is wrong: staff manage customers, they aren't one, and
-- they showed up as a row in their own /platform/accounts list.
--
-- Fix: handle_new_user() now checks
-- `raw_user_meta_data->>'platform_staff' = 'true'` first and returns
-- immediately if set, skipping account/profile/billing provisioning
-- entirely. Staff logins are still created out-of-band (Supabase
-- Admin API `POST /auth/v1/admin/users` with
-- `user_metadata: { platform_staff: true }`, then a direct SQL grant
-- into `platform_admins` as supabase_admin — no UI, by design, same
-- as the platform_admins grant itself) — this is opt-in and cannot
-- affect a normal customer signup, which never sets that key.
--
-- Idempotent — safe to re-run.
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
  -- Platform-staff logins (management-only, created via the Admin API
  -- with this metadata flag) never get a tenant — they're not a
  -- customer. See src/lib/auth/platform.ts.
  IF NEW.raw_user_meta_data->>'platform_staff' = 'true' THEN
    RETURN NEW;
  END IF;

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
