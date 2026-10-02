import { describe, expect, it } from 'vitest';
import { calculateCommission, resolveCommissionRule, settleTrip, type CommissionRule } from '../src/commission.js';

const base = { isActive: true } as const;
const rules: CommissionRule[] = [
  { ...base, id: 'global', type: 'PERCENTAGE', percent: 20 },
  { ...base, id: 'city', cityId: 'erbil', type: 'PERCENTAGE', percent: 18 },
  { ...base, id: 'premium', cityId: 'erbil', vehicleTypeId: 'premium', type: 'PERCENTAGE', percent: 25 },
  { ...base, id: 'driver', driverId: 'd1', type: 'PERCENTAGE_PLUS_FIXED', percent: 10, fixed: 500 },
  { ...base, id: 'old', cityId: 'erbil', type: 'FIXED', fixed: 1000, validTo: new Date('2020-01-01') },
];
const ctx = { cityId: 'erbil', vehicleTypeId: 'economy', driverId: 'd9', at: new Date('2026-10-01') };

describe('commission', () => {
  it('matches the spec example: 20 USD, 20% → driver 16', () => {
    expect(calculateCommission(20, rules[0])).toEqual({ commission: 4, driverEarning: 16 });
  });

  it('picks the most specific active rule', () => {
    expect(resolveCommissionRule(rules, ctx)?.id).toBe('city');
    expect(resolveCommissionRule(rules, { ...ctx, vehicleTypeId: 'premium' })?.id).toBe('premium');
    expect(resolveCommissionRule(rules, { ...ctx, driverId: 'd1' })?.id).toBe('driver');
    expect(resolveCommissionRule(rules, { ...ctx, cityId: 'duhok' })?.id).toBe('global');
  });

  it('never takes more than the fare', () => {
    expect(calculateCommission(300, { ...base, id: 'x', type: 'FIXED', fixed: 1000 }).commission).toBe(300);
  });

  it('settles a cash trip as a debit and a cashless trip as a credit', () => {
    const r = rules[0];
    // gross 20000, promo 2000 → customer pays 18000 cash, driver should net 16000
    const cash = settleTrip(20_000, 2_000, true, r);
    expect(cash.driverWalletDelta).toBe(-2_000);
    expect(18_000 + cash.driverWalletDelta).toBe(16_000);
    expect(settleTrip(20_000, 2_000, false, r).driverWalletDelta).toBe(16_000);
  });
});
