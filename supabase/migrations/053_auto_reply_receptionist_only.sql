-- ============================================================
-- 053_auto_reply_receptionist_only.sql — auto_reply_enabled becomes a
-- receptionist-only concept
--
-- `dispatchInboundToAiReply` (src/lib/ai/auto-reply.ts) only ever reads
-- `auto_reply_enabled` off the RECEPTIONIST — it's the sole fallback
-- for a cold/unpinned conversation (`loadReceptionistAgent`). A pinned
-- agent (reached via a transfer or an automation/flow's "activate AI
-- agent" step) bypasses the flag entirely by design. So a specialist
-- (non-receptionist) agent's own `auto_reply_enabled` was already
-- inert — flipping it did nothing — which was confusing enough in
-- practice (an admin could turn it on for a specialist and see no
-- effect, and the inbox's "AI is live" banner read it as if it did).
--
-- Product decision: multi-agent means specialists are reached by
-- explicit routing (the receptionist's judgment, or an
-- automation/flow) — never by fielding cold inbounds on their own.
-- Only the receptionist may have `auto_reply_enabled = true`, enforced
-- at the DB level so no future code path can silently drift from it.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- Backfill: clear the flag on any specialist that happened to have it
-- set (inert already, this just makes the stored data honest).
UPDATE ai_agents
SET auto_reply_enabled = false
WHERE is_receptionist = false
  AND auto_reply_enabled = true;

ALTER TABLE ai_agents DROP CONSTRAINT IF EXISTS ai_agents_auto_reply_receptionist_only;

ALTER TABLE ai_agents
  ADD CONSTRAINT ai_agents_auto_reply_receptionist_only
  CHECK (is_receptionist OR NOT auto_reply_enabled);
