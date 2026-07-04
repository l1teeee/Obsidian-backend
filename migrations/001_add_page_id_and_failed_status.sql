-- Run once against your Railway MySQL database before deploying the cron job.
ALTER TABLE posts
  ADD COLUMN page_id VARCHAR(64) NULL AFTER media_urls,
  MODIFY COLUMN status ENUM('draft', 'scheduled', 'published', 'inactive', 'deleted', 'failed') NOT NULL DEFAULT 'draft';
