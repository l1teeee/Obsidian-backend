-- Migration 009: Add plan field to users table
-- plan controls which features/nav items are available in the dashboard.
-- Default 'starter' — upgrade via billing system when implemented.

ALTER TABLE users
  ADD COLUMN plan ENUM('starter', 'pro', 'enterprise') NOT NULL DEFAULT 'starter'
  AFTER country;
