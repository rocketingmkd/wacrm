-- ============================================================
-- 066_csat_responses.sql: customer satisfaction ratings (CSAT)
--
-- An agent sends the customer a link from the conversation header
-- ("Enviar avaliação"). The customer opens the public page
-- /csat/<token>, picks 1 to 5 stars and optionally leaves a comment.
--
-- Account members can read and create rows (RLS). The customer answer
-- is written by the server with the service role after validating the
-- token, so there is no UPDATE policy for authenticated users.
--
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS csat_responses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id  uuid REFERENCES conversations(id) ON DELETE SET NULL,
  contact_id       uuid REFERENCES contacts(id) ON DELETE SET NULL,
  -- Unguessable, URL-safe token carried by the public link.
  token            text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  score            smallint CHECK (score IS NULL OR score BETWEEN 1 AND 5),
  comment          text,
  sent_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at          timestamptz NOT NULL DEFAULT now(),
  answered_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_csat_responses_account_sent
  ON csat_responses(account_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_csat_responses_conversation
  ON csat_responses(conversation_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_csat_responses_contact
  ON csat_responses(contact_id, sent_at DESC);

ALTER TABLE csat_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS csat_responses_select ON csat_responses;
CREATE POLICY csat_responses_select ON csat_responses FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS csat_responses_insert ON csat_responses;
CREATE POLICY csat_responses_insert ON csat_responses FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS csat_responses_delete ON csat_responses;
CREATE POLICY csat_responses_delete ON csat_responses FOR DELETE
  USING (is_account_member(account_id, 'agent'));
