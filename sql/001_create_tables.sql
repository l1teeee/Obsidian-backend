CREATE TABLE IF NOT EXISTS users (
  id           INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  email        VARCHAR(255)    NOT NULL,
  password_hash VARCHAR(255)   NOT NULL,
  name         VARCHAR(100),
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED  NOT NULL,
  token      VARCHAR(512)  NOT NULL,
  expires_at DATETIME      NOT NULL,
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_refresh_tokens_token (token),
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS posts (
  id           INT UNSIGNED                                            NOT NULL AUTO_INCREMENT,
  user_id      INT UNSIGNED                                            NOT NULL,
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
  INDEX idx_posts_user_status (user_id, status),
  INDEX idx_posts_user_platform (user_id, platform)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
