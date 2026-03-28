-- Migration 006: add role, country and profile_completed to users
ALTER TABLE users
  ADD COLUMN role              VARCHAR(100)   NULL        AFTER name,
  ADD COLUMN country           VARCHAR(100)   NULL        AFTER role,
  ADD COLUMN profile_completed TINYINT(1) NOT NULL DEFAULT 0 AFTER country;
