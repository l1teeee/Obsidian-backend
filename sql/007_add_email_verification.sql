ALTER TABLE users
  ADD COLUMN email_verified            TINYINT(1)   NOT NULL DEFAULT 0    AFTER password_hash,
  ADD COLUMN email_verification_token  VARCHAR(64)  NULL                  AFTER email_verified;
