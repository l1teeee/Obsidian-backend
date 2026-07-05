import { describe, it, expect } from 'vitest';
import { deriveSubscriptionState, SubscriptionFields } from './subscription-state';

const NOW = new Date('2026-07-04T12:00:00Z');

function row(overrides: Partial<SubscriptionFields> = {}): SubscriptionFields {
  return { plan: null, plan_status: null, trial_ends_at: null, paid_until: null, is_admin: 0, ...overrides };
}

describe('deriveSubscriptionState', () => {
  it('active subscription → active with its plan', () => {
    const state = deriveSubscriptionState(row({ plan: 'starter', plan_status: 'active' }), NOW);
    expect(state.status).toBe('active');
    expect(state.effectivePlan).toBe('starter');
  });

  it('trial in progress → trialing with the trial tier', () => {
    const state = deriveSubscriptionState(
      row({ plan_status: 'trialing', trial_ends_at: new Date('2026-07-10T12:00:00Z') }), NOW,
    );
    expect(state.status).toBe('trialing');
    expect(state.effectivePlan).toBe('pro');
    expect(state.trialDaysLeft).toBe(6);
  });

  it('expired trial without subscription → blocked', () => {
    const state = deriveSubscriptionState(
      row({ plan_status: 'trialing', trial_ends_at: new Date('2026-07-01T12:00:00Z') }), NOW,
    );
    expect(state.status).toBe('blocked');
    expect(state.effectivePlan).toBeNull();
  });

  it('cancelled with paid period remaining → keeps access', () => {
    const state = deriveSubscriptionState(
      row({ plan: 'pro', plan_status: 'cancelled', paid_until: new Date('2026-12-01T00:00:00Z') }), NOW,
    );
    expect(state.status).toBe('cancelled');
    expect(state.effectivePlan).toBe('pro');
  });

  it('cancelled with paid period over → blocked', () => {
    const state = deriveSubscriptionState(
      row({ plan: 'pro', plan_status: 'cancelled', paid_until: new Date('2026-07-01T00:00:00Z') }), NOW,
    );
    expect(state.status).toBe('blocked');
  });

  it('suspended (payment failure) → blocked even with future paid_until', () => {
    const state = deriveSubscriptionState(
      row({ plan: 'pro', plan_status: 'suspended', paid_until: new Date('2026-12-01T00:00:00Z') }), NOW,
    );
    expect(state.status).toBe('blocked');
  });

  it('admin → always active as enterprise', () => {
    const state = deriveSubscriptionState(row({ is_admin: 1 }), NOW);
    expect(state.status).toBe('active');
    expect(state.effectivePlan).toBe('enterprise');
  });

  it('unknown plan name with active status → blocked', () => {
    const state = deriveSubscriptionState(row({ plan: 'studio', plan_status: 'active' }), NOW);
    expect(state.status).toBe('blocked');
  });

  it('trial ending exactly now → blocked (boundary)', () => {
    const state = deriveSubscriptionState(row({ trial_ends_at: NOW }), NOW);
    expect(state.status).toBe('blocked');
  });

  it('active subscription ignores an expired trial', () => {
    const state = deriveSubscriptionState(
      row({ plan: 'enterprise', plan_status: 'active', trial_ends_at: new Date('2026-06-01T00:00:00Z') }), NOW,
    );
    expect(state.status).toBe('active');
    expect(state.effectivePlan).toBe('enterprise');
    expect(state.trialDaysLeft).toBeNull();
  });
});
