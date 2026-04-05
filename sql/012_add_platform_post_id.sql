-- Migration 012: Store the Facebook Graph API post ID for metrics fetching
ALTER TABLE posts
  ADD COLUMN platform_post_id VARCHAR(100) DEFAULT NULL AFTER permalink;
