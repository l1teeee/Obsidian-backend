-- Social connections: stores OAuth tokens for connected Facebook/Instagram accounts
CREATE TABLE IF NOT EXISTS social_connections (
  id                  VARCHAR(36)  NOT NULL PRIMARY KEY,
  user_id             VARCHAR(36)  NOT NULL,
  platform            ENUM('facebook', 'instagram') NOT NULL,
  platform_account_id VARCHAR(255) NOT NULL,
  account_name        VARCHAR(255) NOT NULL,
  account_picture     VARCHAR(512) NULL,
  access_token        TEXT         NOT NULL,
  token_expires_at    DATETIME     NULL,
  page_id             VARCHAR(255) NULL,   -- FB Page ID (used for both FB and IG posting)
  page_name           VARCHAR(255) NULL,
  ig_business_id      VARCHAR(255) NULL,   -- IG Business Account ID (if instagram)
  scopes              VARCHAR(512) NOT NULL DEFAULT '',
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_user_platform_account (user_id, platform, platform_account_id),
  CONSTRAINT fk_social_conn_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
