-- ============================================================
-- 058_contact_ai_summary.sql — a single evolving "AI note" per contact
--
-- Migration 056 shipped the AI's [[NOTE: ...]] as an INSERT into
-- contact_notes on every turn the model emitted one. Because the model
-- re-states its running summary as a conversation develops, one lead
-- produced several near-duplicate notes, mixed in with the human notes
-- list.
--
-- New model: one summary row per contact, REPLACED (not appended) each
-- time the model records a note. Lives on `contacts` so the existing
-- `contacts_select` RLS covers reads and `select('*')` picks it up
-- with no query changes; the auto-reply engine writes it via the
-- service-role client. Surfaced in the UI behind a dedicated "Nota IA"
-- button, separate from the human notes list.
--
--   ai_summary            — the text the model produced (its full
--                           current picture, not a delta)
--   ai_summary_updated_at  — when it was last replaced
--   ai_summary_agent       — display name of the agent that wrote it,
--                           for the "IA · <agent>" label in the popup
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS ai_summary text,
  ADD COLUMN IF NOT EXISTS ai_summary_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_summary_agent text;

COMMENT ON COLUMN contacts.ai_summary IS
  'Single evolving summary the AI auto-reply agents keep on this contact via [[NOTE: ...]] — replaced, never appended. Shown behind the "Nota IA" button. Migration 058 (supersedes the contact_notes inserts from 056).';

-- One-off cleanup: fold the most recent 056-era AI note (if any) into
-- the new column, then drop those inserts so they stop cluttering the
-- human notes list. Matches the exact prefix recordAiNote wrote.
UPDATE contacts c
SET
  -- strip the "🤖 IA · <agent>\n\n" prefix — the new popup renders the
  -- agent + timestamp as its own header
  ai_summary = regexp_replace(sub.note_text, E'^🤖 IA · [^\n]*\n\n', ''),
  ai_summary_updated_at = sub.created_at,
  ai_summary_agent = NULLIF(split_part(split_part(sub.note_text, E'\n', 1), ' IA · ', 2), '')
FROM (
  SELECT DISTINCT ON (contact_id)
    contact_id, note_text, created_at
  FROM contact_notes
  WHERE note_text LIKE '🤖 IA · %'
  ORDER BY contact_id, created_at DESC
) sub
WHERE sub.contact_id = c.id
  AND c.ai_summary IS NULL;

DELETE FROM contact_notes WHERE note_text LIKE '🤖 IA · %';
