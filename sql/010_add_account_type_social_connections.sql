-- Add Instagram account type to social_connections
-- Values: BUSINESS | MEDIA_CREATOR | PERSONAL | NULL (for Facebook rows)
ALTER TABLE social_connections
  ADD COLUMN account_type VARCHAR(20) NULL
    COMMENT 'Instagram account type: BUSINESS, MEDIA_CREATOR, or PERSONAL';
