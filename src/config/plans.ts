// Single source of truth for plan tiers and their limits.
// null means unlimited. Adjust numbers here — nothing else hardcodes them.

export interface PlanLimits {
  maxConnections:   number | null;
  postsPerMonth:    number | null;
  aiTokensPerMonth: number | null;
  maxSessions:      number;
}

export const PLANS: Record<'starter' | 'pro' | 'enterprise', PlanLimits> = {
  starter:    { maxConnections: 3,    postsPerMonth: 50,   aiTokensPerMonth: 50_000,  maxSessions: 2 },
  pro:        { maxConnections: 10,   postsPerMonth: 500,  aiTokensPerMonth: 500_000, maxSessions: 5 },
  enterprise: { maxConnections: null, postsPerMonth: null, aiTokensPerMonth: null,    maxSessions: 10 },
};

export type PlanName = keyof typeof PLANS;

// Trial users operate with this tier's limits
export const TRIAL_PLAN: PlanName = 'pro';
export const TRIAL_DAYS = 14;

export function isPlanName(value: unknown): value is PlanName {
  return typeof value === 'string' && value in PLANS;
}
