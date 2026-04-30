-- Migration 021: Scope social connections to workspaces
--
-- Adds workspace_id so that platform connections belong to a specific workspace.
-- Each workspace can have its own set of connected accounts.
--
-- Existing rows are assigned to the user's oldest workspace so no data is lost.
-- The unique key is updated to include workspace_id so the same account can be
-- connected in multiple workspaces independently.

ALTER TABLE social_connections
  ADD COLUMN workspace_id VARCHAR(16) NULL AFTER user_id,
  ADD INDEX idx_social_conn_workspace (workspace_id),
  ADD CONSTRAINT fk_social_conn_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE SET NULL;

-- Assign existing connections to the user's oldest workspace
UPDATE social_connections
SET workspace_id = (
  SELECT id FROM workspaces
  WHERE user_id = social_connections.user_id
  ORDER BY created_at ASC
  LIMIT 1
)
WHERE workspace_id IS NULL;

-- Replace the unique key to include workspace_id.
-- user_id must be first so the FK fk_social_conn_user keeps a supporting index.
-- Adding idx_social_conn_user in the same statement lets MySQL drop the old
-- unique key without complaining about the FK.
ALTER TABLE social_connections
  ADD INDEX idx_social_conn_user (user_id),
  DROP INDEX uq_user_platform_account_page,
  ADD UNIQUE KEY uq_workspace_platform_account_page
    (user_id, workspace_id, platform, platform_account_id, page_id);
