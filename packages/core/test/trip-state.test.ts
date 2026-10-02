import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, driverAvailabilityFor, isTerminal } from '../src/trip-state.js';
import { cancellationRate, customerCancellationFee } from '../src/cancellation.js';
import { evaluatePromotion } from '../src/promotion.js';

describe('trip state machine', () => {
  it('follows the happy path', () => {
    expect(canTransition('REQUESTED', 'SEARCHING', 'SYSTEM')).toBe(true);
    expect(canTransition('SEARCHING', 'DRIVER_ASSIGNED', 'DRIVER')).toBe(true);
    expect(canTransition('DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER')).toBe(true);
    expect(canTransition('DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'DRIVER')).toBe(true);
    expect(canTransition('DRIVER_ARRIVED', 'IN_PROGRESS', 'DRIVER')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'COMPLETED', 'DRIVER')).toBe(true);
  });

  it('blocks illegal moves', () => {
    expect(canTransition('SEARCHING', 'IN_PROGRESS', 'DRIVER')).toBe(false);
    expect(canTransition('IN_PROGRESS', 'CANCELLED_BY_CUSTOMER', 'CUSTOMER')).toBe(false);
    expect(canTransition('DRIVER_ARRIVED', 'IN_PROGRESS', 'CUSTOMER')).toBe(false);
    expect(() => assertTransition('COMPLETED', 'IN_PROGRESS', 'ADMIN')).toThrow(/cannot move/);
  });

  it('knows terminal states and driver availability', () => {
    expect(isTerminal('COMPLETED')).toBe(true);
    expect(isTerminal('IN_PROGRESS')).toBe(false);
    expect(driverAvailabilityFor('DRIVER_ARRIVING')).toBe('ON_TRIP');
    expect(driverAvailabilityFor('CANCELLED_BY_DRIVER')).toBe('ONLINE');
  });
});

describe('cancellation', () => {
  const policy = { freeWindowS: 120, fee: 1000, feeAfterArrived: 2000, noShowAfterS: 300 };
  it('is free while searching and inside the free window', () => {
    expect(customerCancellationFee(policy, { status: 'SEARCHING', secondsSinceAccepted: 0 })).toBe(0);
    expect(customerCancellationFee(policy, { status: 'DRIVER_ARRIVING', secondsSinceAccepted: 60 })).toBe(0);
  });
  it('charges after the window, more for a no-show, nothing if the driver was late', () => {
    expect(customerCancellationFee(policy, { status: 'DRIVER_ARRIVING', secondsSinceAccepted: 200 })).toBe(1000);
    expect(customerCancellationFee(policy, { status: 'DRIVER_ARRIVED', secondsSinceAccepted: 600, secondsSinceArrived: 320 })).toBe(2000);
    expect(customerCancellationFee(policy, { status: 'DRIVER_ARRIVING', secondsSinceAccepted: 600, driverLate: true })).toBe(0);
  });
  it('computes rates', () => {
    expect(cancellationRate(3, 40)).toBe(7.5);
    expect(cancellationRate(0, 0)).toBe(0);
  });
});

describe('promotions', () => {
  const promo = {
    type: 'PERCENTAGE' as const,
    percent: 20,
    maxDiscount: 3000,
    cityIds: [],
    vehicleTypeIds: [],
    startsAt: new Date('2026-01-01'),
    endsAt: new Date('2026-12-31'),
    perUserLimit: 2,
    usedCount: 0,
    isActive: true,
  };
  const ctx = { fare: 10_000, cityId: 'erbil', vehicleTypeId: 'economy', at: new Date('2026-10-01'), userUses: 0, userCompletedTrips: 4 };

  it('applies percentage with a cap', () => {
    expect(evaluatePromotion(promo, ctx)).toEqual({ ok: true, discount: 2000 });
    expect(evaluatePromotion(promo, { ...ctx, fare: 50_000 })).toEqual({ ok: true, discount: 3000 });
  });
  it('enforces dates, limits and first-trip rules', () => {
    expect(evaluatePromotion(promo, { ...ctx, at: new Date('2027-01-02') })).toEqual({ ok: false, reason: 'expired' });
    expect(evaluatePromotion(promo, { ...ctx, userUses: 2 })).toEqual({ ok: false, reason: 'user_limit_reached' });
    expect(evaluatePromotion({ ...promo, type: 'FIRST_TRIP' }, ctx)).toEqual({ ok: false, reason: 'not_first_trip' });
  });
});
