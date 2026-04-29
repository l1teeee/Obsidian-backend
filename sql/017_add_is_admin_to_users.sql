-- Migration 017: add is_admin flag to users
-- Separate from the job-title `role` column — this is authorization-only.
ALTER TABLE users
  ADD COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER plan;
