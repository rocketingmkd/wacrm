-- ============================================================
-- 048_deal_stage_trigger.sql — "Card moved to stage" automation trigger
--
-- Feature: a new automation trigger (`deal_stage_changed`) that fires
-- when a deal card enters a chosen pipeline stage, plus a new step
-- (`move_deal`) that moves the triggering deal to another stage. Used
-- to build follow-up cadences that live in a single "Follow up" column.
--
-- Schema impact is minimal: `automations.trigger_type` and
-- `automation_steps.step_type` are free-text TEXT columns with no CHECK
-- constraint, so the new values ride on the existing columns.
--
-- The one change needed: a cadence must be able to STOP mid-wait (card
-- left the trigger stage, or the customer replied). The engine cancels
-- such a parked run at wait-resume time and needs a terminal status
-- distinct from the normal 'done'/'failed'. Add 'cancelled'.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE automation_pending_executions
  DROP CONSTRAINT IF EXISTS automation_pending_executions_status_check;

ALTER TABLE automation_pending_executions
  ADD CONSTRAINT automation_pending_executions_status_check
  CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled'));
