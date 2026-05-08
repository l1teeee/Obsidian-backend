-- Token usage log
CREATE TABLE IF NOT EXISTS token_usage (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  user_id       CHAR(36)     NOT NULL,
  workspace_id  CHAR(36)     NULL,
  tool          VARCHAR(50)  NOT NULL,
  model         VARCHAR(100) NOT NULL DEFAULT '',
  input_tokens  INT          NOT NULL DEFAULT 0,
  output_tokens INT          NOT NULL DEFAULT 0,
  total_tokens  INT          NOT NULL DEFAULT 0,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_user_created (user_id, created_at),
  INDEX idx_tool_created (tool, created_at),
  INDEX idx_created_at   (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Monthly token limits per plan (0 = unlimited)
CREATE TABLE IF NOT EXISTS token_limits (
  plan          VARCHAR(20) NOT NULL,
  monthly_limit INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (plan)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO token_limits (plan, monthly_limit) VALUES
  ('free',       10000),
  ('starter',    50000),
  ('pro',        200000),
  ('enterprise', 0);
