-- Migration 022: Reset max_sessions so plan-based limits apply
--
-- max_sessions = NULL means "use the plan default" (handled in auth.service.ts).
-- Users with an explicit override keep their value.
-- Plan defaults (from PLAN_SESSION_LIMITS in auth.service.ts):
--   starter    → 2
--   pro        → 5
--   enterprise → 10
--   (no plan)  → 1

-- Allow NULL in max_sessions (was NOT NULL in migration 014)
ALTER TABLE users MODIFY COLUMN max_sessions TINYINT UNSIGNED NULL DEFAULT NULL;

-- Reset all explicitly-set values that match the old hard default (1)
-- so the plan-based logic takes over. Users with custom overrides (> 1) keep them.
UPDATE users SET max_sessions = NULL WHERE max_sessions = 1;
