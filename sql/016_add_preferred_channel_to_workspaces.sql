-- Migration 016 — Add preferred_channel to workspaces
-- Stores the user-selected preferred social channel per workspace.
-- NULL = no manual preference (auto-detect applies when published posts >= 10).
-- Valid values: 'ig', 'fb', 'li'

ALTER TABLE workspaces
  ADD COLUMN preferred_channel VARCHAR(10) NULL DEFAULT NULL;
