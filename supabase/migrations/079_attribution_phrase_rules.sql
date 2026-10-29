-- ============================================================
-- 079_attribution_phrase_rules.sql: origin of traffic by message phrase
--
-- Some leads reach WhatsApp with a phrase pre-filled by the client's
-- site ("Oi, vim pelo site e quero um orçamento") and carry neither a
-- Click to WhatsApp referral nor a [#CODE] tracking code. A rule maps a
-- phrase to a source and a campaign name:
--
--   phrase   text looked for in the customer's messages; compared
--            case-insensitively and without accents (done in the app,
--            see src/lib/tracking/phrase-rules.ts)
--   source   same values as lead_attribution.source
--   label    campaign name, copied to lead_attribution.utm_campaign
--
-- Used by the Copiloto "Origem por frase" card (dry run + apply over
-- existing contacts) and by the WhatsApp webhook on new conversations.
-- Applying a rule only ever INSERTs lead_attribution rows for contacts
-- that have none yet (first touch wins), always with the service role.
--
-- Members read their account's rules; admins manage them.
--
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS attribution_phrase_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  phrase      text NOT NULL CHECK (char_length(btrim(phrase)) BETWEEN 3 AND 200),
  source      text NOT NULL CHECK (source IN ('meta_ctwa', 'meta_site', 'google', 'other')),
  label       text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 255),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attribution_phrase_rules_account
  ON attribution_phrase_rules(account_id);

ALTER TABLE attribution_phrase_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attribution_phrase_rules_select ON attribution_phrase_rules;
CREATE POLICY attribution_phrase_rules_select ON attribution_phrase_rules
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS attribution_phrase_rules_insert ON attribution_phrase_rules;
CREATE POLICY attribution_phrase_rules_insert ON attribution_phrase_rules
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS attribution_phrase_rules_update ON attribution_phrase_rules;
CREATE POLICY attribution_phrase_rules_update ON attribution_phrase_rules
  FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS attribution_phrase_rules_delete ON attribution_phrase_rules;
CREATE POLICY attribution_phrase_rules_delete ON attribution_phrase_rules
  FOR DELETE USING (is_account_member(account_id, 'admin'));

NOTIFY pgrst, 'reload schema';
