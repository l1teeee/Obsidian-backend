// Pure derivation of a user's subscription/trial state.
// Keep this file free of db/env imports so it stays unit-testable.
import { PlanName, TRIAL_PLAN, isPlanName } from '../../config/plans';

export type SubscriptionStatus = 'trialing' | 'active' | 'cancelled' | 'blocked';

export interface SubscriptionFields {
  plan:          string | null;
  plan_status:   string | null;
  trial_ends_at: Date | null;
  paid_until:    Date | null;
  is_admin:      number;
}

export interface SubscriptionState {
  status:        SubscriptionStatus;
  plan:          PlanName | null;
  effectivePlan: PlanName | null;
  trialEndsAt:   Date | null;
  trialDaysLeft: number | null;
  paidUntil:     Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function deriveSubscriptionState(
  row: SubscriptionFields,
  now: Date = new Date(),
): SubscriptionState {
  const plan        = isPlanName(row.plan) ? row.plan : null;
  const trialEndsAt = row.trial_ends_at;
  const paidUntil   = row.paid_until;
  const trialActive = trialEndsAt !== null && trialEndsAt.getTime() > now.getTime();

  const base = {
    plan,
    trialEndsAt,
    trialDaysLeft: trialActive
      ? Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS)
      : null,
    paidUntil,
  };

  if (row.is_admin) {
    return { ...base, status: 'active', effectivePlan: 'enterprise' };
  }
  if (row.plan_status === 'active' && plan) {
    return { ...base, status: 'active', effectivePlan: plan };
  }
  // Cancelled subscriptions keep access until the end of the paid period
  if (
    row.plan_status === 'cancelled' && plan &&
    paidUntil !== null && paidUntil.getTime() > now.getTime()
  ) {
    return { ...base, status: 'cancelled', effectivePlan: plan };
  }
  if (trialActive) {
    return { ...base, status: 'trialing', effectivePlan: TRIAL_PLAN };
  }
  return { ...base, status: 'blocked', effectivePlan: null };
}
