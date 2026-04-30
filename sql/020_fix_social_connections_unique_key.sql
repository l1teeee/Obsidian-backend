-- Migration 020: Fix social_connections unique key to support multiple FB pages per user
--
-- Problem: uq_user_platform_account uses (user_id, platform, platform_account_id).
-- platform_account_id = Facebook user ID, which is the SAME for all pages owned by
-- that user. Reconnecting with 2 pages caused the 2nd page to overwrite the 1st via
-- ON DUPLICATE KEY UPDATE instead of inserting a new row.
--
-- Fix: include page_id in the unique key so each page gets its own row.
-- page_id can be NULL for personal accounts (no pages) — MySQL allows multiple NULLs
-- in unique keys, and personal account inserts are handled via explicit UPDATE in code,
-- not via ON DUPLICATE KEY, so they do not create phantom duplicates.

ALTER TABLE social_connections
  DROP INDEX uq_user_platform_account,
  ADD UNIQUE KEY uq_user_platform_account_page (user_id, platform, platform_account_id, page_id);
