-- Add soft-delete support to social_connections
ALTER TABLE social_connections
  ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '1 = connected, 0 = disconnected (soft delete)';
