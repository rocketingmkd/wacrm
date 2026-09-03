-- ============================================================
-- 054_agenda_pipeline.sql — dedicated scheduling pipeline
--
-- New "Agenda" tab: a pipeline flagged `is_scheduling` holds
-- appointment cards (one deal per compromisso), separate from the
-- account's regular sales pipeline(s) — same board/DnD/automations
-- machinery, just a different pipeline. At most one per account
-- (mirrors the `ai_agents_one_receptionist` pattern from migration
-- 044): the partial unique index only prevents having two, the app
-- layer decides whether zero is valid (the Agenda page auto-seeds one
-- on first visit if missing).
--
-- `deals.scheduled_at` is the compromisso's date+time — nullable
-- since it's meaningless on a regular sales deal, required in
-- practice for anything on the scheduling pipeline. Feeds both the
-- Agenda tab's day/week list view and (future work) the reminder
-- cadence's date-anchored wait.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE pipelines
  ADD COLUMN IF NOT EXISTS is_scheduling boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS pipelines_one_scheduling
  ON pipelines(account_id) WHERE is_scheduling;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

-- Powers the Agenda list view's "what's coming up" query (order by
-- scheduled_at within one pipeline). Partial: most deals across the
-- account are ordinary sales deals with no scheduled_at at all.
CREATE INDEX IF NOT EXISTS idx_deals_scheduled_at
  ON deals(pipeline_id, scheduled_at)
  WHERE scheduled_at IS NOT NULL;
