-- Migration 026: Add PayPal subscription fields to users
-- Adds paypal_subscription_id and plan_status for billing lifecycle tracking.
-- Also expands the plan ENUM to include 'studio' (aligned with frontend plan IDs).

ALTER TABLE users
  MODIFY COLUMN plan ENUM('starter', 'pro', 'studio', 'enterprise') NOT NULL DEFAULT 'starter',
  ADD COLUMN paypal_subscription_id VARCHAR(50)                                       NULL AFTER plan,
  ADD COLUMN plan_status            ENUM('active','cancelled','suspended','expired')  NULL AFTER paypal_subscription_id;

CREATE INDEX idx_users_paypal_subscription_id ON users (paypal_subscription_id);
