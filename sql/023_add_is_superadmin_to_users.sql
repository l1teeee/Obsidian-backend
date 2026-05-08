-- Migration 023: add is_superadmin flag to users
-- Added programmatically by initAdminTables() but also needs a migration file.
ALTER TABLE users
  ADD COLUMN is_superadmin TINYINT(1) NOT NULL DEFAULT 0 AFTER is_admin;
