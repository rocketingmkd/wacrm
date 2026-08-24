-- ============================================================
-- 039_bsuid_support
--
-- WhatsApp Business-Scoped User IDs (BSUID). Meta's usernames
-- feature means a sender's phone number can be entirely absent from
-- the inbound webhook (`messages[].from` and `contacts[].wa_id` both
-- omitted) when the customer hasn't shared a phone number, hasn't
-- interacted with this business phone number in the last 30 days,
-- and isn't in the business's contact book. In that case the only
-- identity Meta gives us is `messages[].from_user_id` /
-- `contacts[].user_id` (the BSUID) plus, optionally,
-- `contacts[].profile.username`.
--
-- Until now `contacts.phone` was NOT NULL — a contact literally
-- could not exist without a phone number. This migration relaxes
-- that so a BSUID-only contact can be created, and adds the columns
-- to store the BSUID + username. At least one identity (phone or
-- wa_user_id) is still required — see the CHECK constraint below.
-- ============================================================

ALTER TABLE contacts ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS wa_user_id TEXT,
  ADD COLUMN IF NOT EXISTS wa_username TEXT;

ALTER TABLE contacts
  DROP CONSTRAINT IF EXISTS contacts_identity_check;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_identity_check
  CHECK (phone IS NOT NULL OR wa_user_id IS NOT NULL);

-- Same shape as the phone_normalized unique index from migration 022:
-- a partial unique index so multiple contacts can have a NULL
-- wa_user_id (the common case — most contacts are phone-only) while
-- still preventing two contacts in the same account from claiming
-- the same BSUID.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_wa_user_id
  ON contacts (account_id, wa_user_id)
  WHERE wa_user_id IS NOT NULL;
