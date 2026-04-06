-- Session management: device tracking + per-user session limit
ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS device_info VARCHAR(500) NULL AFTER token;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS max_sessions TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER profile_completed;
