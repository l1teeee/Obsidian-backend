-- AI Settings per workspace
CREATE TABLE IF NOT EXISTS ai_settings (
  id                  VARCHAR(36)  NOT NULL PRIMARY KEY,
  workspace_id        VARCHAR(36)  NOT NULL UNIQUE,
  persona             TEXT         NULL COMMENT 'Brand/creator identity — who you are',
  brand_voice         TEXT         NULL COMMENT 'Tone, style, writing personality',
  target_audience     TEXT         NULL COMMENT 'Who the content is written for',
  content_pillars     TEXT         NULL COMMENT 'Main topics / themes covered',
  hashtag_strategy    TEXT         NULL COMMENT 'How hashtags are used (niche, broad, count)',
  example_posts       TEXT         NULL COMMENT 'Sample posts that represent desired style',
  avoid               TEXT         NULL COMMENT 'Words, topics or styles to avoid',
  custom_instructions TEXT         NULL COMMENT 'Free-form extra instructions for the AI',
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
