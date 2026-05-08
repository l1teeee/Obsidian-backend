-- Migration 024: Fix collation mismatch in admin tables
-- admin_invitations and role tables were created without explicit COLLATE,
-- causing MySQL 8 to use utf8mb4_0900_ai_ci while users uses utf8mb4_unicode_ci.
-- CONVERT TO rebuilds each table with the correct collation.

ALTER TABLE admin_invitations
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE plan_permissions
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE custom_roles
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE custom_role_permissions
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE user_custom_roles
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
