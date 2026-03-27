-- Migration 004: Add 'inactive' and 'deleted' to posts status ENUM (soft delete support)
ALTER TABLE posts
  MODIFY COLUMN status
    ENUM('draft','scheduled','published','inactive','deleted')
    NOT NULL DEFAULT 'draft';
