-- Migration 003: Replace sequential INT PKs with 16-char URL-safe UUIDs
-- WARNING: This drops all existing data. Run only in development.

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS account_metrics;
DROP TABLE IF EXISTS connected_accounts;
DROP TABLE IF EXISTS post_metrics;
DROP TABLE IF EXISTS workspaces;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  id            VARCHAR(16)  NOT NULL,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(100),
  first_login   TINYINT      NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE refresh_tokens (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    VARCHAR(16)  NOT NULL,
  token      VARCHAR(512) NOT NULL,
  expires_at DATETIME     NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_refresh_tokens_token (token),
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE workspaces (
  id         VARCHAR(16)  NOT NULL,
  user_id    VARCHAR(16)  NOT NULL,
  name       VARCHAR(100) NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_workspaces_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  INDEX idx_workspaces_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE posts (
  id           VARCHAR(16)                                             NOT NULL,
  user_id      VARCHAR(16)                                             NOT NULL,
  platform     ENUM('meta','linkedin','youtube')                       NOT NULL,
  post_type    ENUM('post','reel','story','video','carousel')          NOT NULL DEFAULT 'post',
  caption      TEXT,
  media_urls   TEXT,
  permalink    VARCHAR(500),
  status       ENUM('draft','scheduled','published')                   NOT NULL DEFAULT 'draft',
  scheduled_at DATETIME,
  published_at DATETIME,
  created_at   DATETIME                                                NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME                                                NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_posts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  INDEX idx_posts_user_status   (user_id, status),
  INDEX idx_posts_user_platform (user_id, platform)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
