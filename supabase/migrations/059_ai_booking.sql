-- ============================================================
-- 059_ai_booking.sql — the AI agent books a real appointment
--
-- Until now the scheduling agent only ever talked: it confirmed a day
-- and time in the chat and wrote a note for a human to act on, but
-- nothing in `deals` ever got a `scheduled_at`. This migration adds
-- the surface for the AI to check real availability
-- (availability_rules/_exceptions from migration 055) and write the
-- appointment itself (`deals.scheduled_at` on the Agenda pipeline from
-- migration 054), plus an audit trail of every attempt so an admin can
-- see whether the agent actually consulted the calendar before
-- offering a time.
--
--   1. ai_agents.can_schedule — per-agent permission gate. Only an
--      agent with this on gets the availability block injected into
--      its prompt and is allowed to act on a [[BOOK: ...]] marker
--      (src/lib/ai/generate.ts). Off by default — an agent has to be
--      deliberately granted this, same spirit as auto_reply_enabled
--      being receptionist-only (migration 053).
--
--   2. ai_booking_attempts — one row per booking attempt (success or
--      failure), written only by the service role (the auto-reply
--      engine) — same read-only-for-members pattern as
--      conversation_insights (migration 040). `offered_slots` is the
--      literal answer to "did it consult the agenda first": the free
--      slots the engine computed right before validating this attempt.
--
--   3. A partial unique index on deals(pipeline_id, scheduled_at) so
--      two conversations racing for the same slot can't both win —
--      the second insert fails at the database, not just in
--      application logic. Cancelled/lost appointments free the slot
--      back up.
--
--   4. notifications.type gains 'ai_booked_appointment' so the team is
--      told whenever the AI books something on its own — mirrors how
--      migration 051 widened this for 'ai_handed_off'.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_agents
  ADD COLUMN IF NOT EXISTS can_schedule boolean NOT NULL DEFAULT false;

-- ------------------------------------------------------------
-- ai_booking_attempts — audit log, one row per attempt
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_booking_attempts (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id  uuid REFERENCES conversations(id) ON DELETE SET NULL,
  contact_id       uuid REFERENCES contacts(id) ON DELETE SET NULL,
  agent_id         uuid REFERENCES ai_agents(id) ON DELETE SET NULL,
  -- Snapshotted separately from agent_id: the agent can be renamed or
  -- deleted later and the log should still read sensibly.
  agent_name       text,
  requested_at     timestamptz NOT NULL,
  outcome          text NOT NULL CHECK (outcome IN ('booked', 'rejected', 'no_availability', 'error')),
  reason           text,
  deal_id          uuid REFERENCES deals(id) ON DELETE SET NULL,
  -- The free slots the engine computed right before validating this
  -- attempt — proof of whether it actually consulted the calendar.
  offered_slots    jsonb NOT NULL DEFAULT '[]',
  -- Raw [[BOOK: ...]] payload the model emitted, for debugging a
  -- malformed or unexpected request.
  payload          jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_booking_attempts_account_created
  ON ai_booking_attempts(account_id, created_at DESC);

ALTER TABLE ai_booking_attempts ENABLE ROW LEVEL SECURITY;

-- Read: any member of the owning account. Writes come only from the
-- service role (the auto-reply engine), so there is deliberately no
-- INSERT/UPDATE/DELETE policy for authenticated users — same pattern
-- as conversation_insights (migration 040).
DROP POLICY IF EXISTS ai_booking_attempts_select ON ai_booking_attempts;
CREATE POLICY ai_booking_attempts_select ON ai_booking_attempts
  FOR SELECT USING (is_account_member(account_id));

-- ------------------------------------------------------------
-- Anti-overbooking: at most one non-lost appointment per exact
-- timestamp on a given pipeline. Belt-and-suspenders — the engine
-- already re-checks availability right before writing, but only this
-- index closes the race between two conversations confirming the same
-- slot at the same instant.
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS deals_one_per_slot
  ON deals(pipeline_id, scheduled_at)
  WHERE scheduled_at IS NOT NULL AND status <> 'lost';

-- ------------------------------------------------------------
-- notifications.type — allow the AI booking notification
-- ------------------------------------------------------------
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'ai_handed_off', 'ai_booked_appointment'));
