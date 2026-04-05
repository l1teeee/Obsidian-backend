-- Store the Facebook User Access Token separately from the Page Access Token.
-- The User Token (long-lived, ~60 days) has pages_read_engagement and read_insights,
-- which NPE Page Tokens don't inherit. Needed for reading post metrics.
ALTER TABLE social_connections
  ADD COLUMN user_access_token TEXT DEFAULT NULL AFTER access_token;
