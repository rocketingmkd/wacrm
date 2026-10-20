-- ============================================================
-- 064_messages_transport.sql — which transport sent an outbound message
--
-- Phase 3 of the unofficial (Evolution) session: a conversation whose
-- 24h window is closed can be reopened with a free-form message sent
-- through the Evolution session. `messages.transport` records which
-- path an agent message took so the inbox can badge it ("via não
-- oficial") and so the guard rails (max per lead, daily cap) can count
-- unofficial sends.
--
-- Existing rows are all official. Idempotent.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS transport TEXT NOT NULL DEFAULT 'official';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'messages_transport_check'
  ) THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_transport_check
      CHECK (transport IN ('official', 'evolution'));
  END IF;
END $$;

-- Guard-rail counts and echo de-duplication only ever look at the
-- unofficial rows, so a partial index keeps them cheap.
CREATE INDEX IF NOT EXISTS idx_messages_transport_evolution
  ON messages(conversation_id, created_at DESC)
  WHERE transport = 'evolution';
