ALTER TABLE users
  ADD COLUMN sessions_invalidated_at TIMESTAMP NULL DEFAULT NULL AFTER max_sessions;