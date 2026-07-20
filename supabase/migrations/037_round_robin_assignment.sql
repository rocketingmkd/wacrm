-- ============================================================
-- 037_round_robin_assignment
--
-- Optional automatic agent assignment for brand-new conversations.
-- When `round_robin_enabled` is on, the very first inbound message
-- from a contact (i.e. the moment its conversation row is created —
-- see `findOrCreateConversation` in the WhatsApp webhook) gets its
-- `assigned_agent_id` set to the next 'agent'-role member in line,
-- cycling through the roster in a stable order.
--
-- `round_robin_last_agent_id` is the rotation cursor: the agent who
-- received the previous auto-assignment. The next one is whoever
-- comes after them (by user_id) in the account's 'agent' roster,
-- wrapping around at the end. No FK — mirrors `conversations.
-- assigned_agent_id`, which also stores a bare auth.uid() with no
-- declared reference.
--
-- RLS: no change needed. The existing `accounts_update` policy
-- (017) already restricts writes to admins+, matching who should
-- flip this account-wide switch (see 021 for the same reasoning).
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS round_robin_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS round_robin_last_agent_id UUID;
