-- ============================================================
-- 081_increment_conversation_unread.sql
--
-- Atomic increment of conversations.unread_count. Called via PostgREST
-- RPC from the inbound webhook (official and group paths).
--
-- Before this, the webhook did a read-modify-write:
--   UPDATE conversations SET unread_count = <cached + 1> WHERE id = ...
-- so two inbound messages for the same conversation processed at the
-- same moment (a customer sending a burst, or Meta retrying a delivery)
-- could both read N and both write N+1, permanently losing a count.
--
-- Same pattern as 007_automations_increment_counter.sql.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION increment_conversation_unread(p_conversation_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE conversations
  SET unread_count = COALESCE(unread_count, 0) + 1
  WHERE id = p_conversation_id;
$$;

-- Only the service role needs to call this (the webhook uses the
-- service-role client). Lock anon / authenticated out so a signed-in
-- user can't inflate someone else's unread badge via RPC.
REVOKE ALL ON FUNCTION increment_conversation_unread(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION increment_conversation_unread(UUID) FROM anon;
REVOKE ALL ON FUNCTION increment_conversation_unread(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION increment_conversation_unread(UUID) TO service_role;
