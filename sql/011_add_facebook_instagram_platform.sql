-- Migration 011: Add 'facebook' and 'instagram' to posts platform ENUM
-- 'meta' kept for backwards compatibility with existing posts
ALTER TABLE posts
  MODIFY COLUMN platform
    ENUM('meta','linkedin','youtube','facebook','instagram')
    NOT NULL;
