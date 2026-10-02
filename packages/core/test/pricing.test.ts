import { describe, expect, it } from 'vitest';
import { calculateFare, finalizeFare, type PricingRule } from '../src/pricing.js';

// Example Erbil Economy rule (IQD)
const rule: PricingRule = {
  baseFare: 1500,
  perKm: 500,
  perMinute: 100,
  minimumFare: 3000,
  bookingFee: 250,
  freeWaitingMinutes: 3,
  waitingPerMinute: 150,
  airportFee: 5000,
  specialFee: 0,
  roundingStep: 250,
};

describe('calculateFare', () => {
  it('computes base + distance + time + fees and rounds to 250 IQD', () => {
    // 8.4 km, 19 min → 1500 + 4200 + 1900 = 7600, +250 booking = 7850 → 7750
    const f = calculateFare(rule, { distanceM: 8400, durationS: 19 * 60 });
    expect(f.distanceFare).toBe(4200);
    expect(f.timeFare).toBe(1900);
    expect(f.total).toBe(7750);
    expect(f.minimumApplied).toBe(false);
  });

  it('applies minimum fare for very short trips', () => {
    const f = calculateFare(rule, { distanceM: 500, durationS: 120 });
    expect(f.minimumApplied).toBe(true);
    expect(f.total).toBe(3250); // 3000 minimum + 250 booking
  });

  it('applies surge only to the ride part', () => {
    const normal = calculateFare(rule, { distanceM: 10_000, durationS: 1200 }); // 1500+5000+2000 = 8500
    const surged = calculateFare(rule, { distanceM: 10_000, durationS: 1200, surgeMultiplier: 1.5 });
    expect(normal.total).toBe(8750);
    expect(surged.surgeAmount).toBe(4250);
    expect(surged.total).toBe(13_000); // 12750 + 250
  });

  it('matches the spec example: 10 × 1.5 = 15', () => {
    const simple: PricingRule = { ...rule, baseFare: 10, perKm: 0, perMinute: 0, minimumFare: 0, bookingFee: 0, roundingStep: 1 };
    expect(calculateFare(simple, { distanceM: 0, durationS: 0, surgeMultiplier: 1.5 }).total).toBe(15);
  });

  it('charges waiting only after the free minutes, per started minute', () => {
    const f = calculateFare(rule, { distanceM: 10_000, durationS: 1200, waitingS: 5 * 60 + 10 });
    expect(f.waitingFare).toBe(3 * 150);
  });

  it('adds airport fee and caps discount at the fare', () => {
    const f = calculateFare(rule, { distanceM: 10_000, durationS: 1200, touchesAirport: true, discount: 1_000_000 });
    expect(f.gross).toBe(13_750);
    expect(f.total).toBe(0);
    expect(f.discount).toBe(13_750);
  });

  it('rejects surge below 1', () => {
    expect(() => calculateFare(rule, { distanceM: 1, durationS: 1, surgeMultiplier: 0.8 })).toThrow();
  });
});

describe('finalizeFare', () => {
  const estimate = calculateFare(rule, { distanceM: 10_000, durationS: 1200 });

  it('keeps the upfront price when the actual trip is within tolerance', () => {
    const r = finalizeFare(rule, estimate, { distanceM: 10_500, durationS: 1260 }, 15);
    expect(r.keptEstimate).toBe(true);
    expect(r.fare.total).toBe(estimate.total);
  });

  it('recalculates when the route changed a lot', () => {
    const r = finalizeFare(rule, estimate, { distanceM: 18_000, durationS: 2400 }, 15);
    expect(r.keptEstimate).toBe(false);
    expect(r.fare.total).toBeGreaterThan(estimate.total);
  });

  it('adds waiting on top of a kept estimate', () => {
    const r = finalizeFare(rule, estimate, { distanceM: 10_000, durationS: 1200, waitingS: 6 * 60 }, 15);
    expect(r.keptEstimate).toBe(true);
    expect(r.fare.total).toBe(estimate.total + 500); // 450 waiting → rounded with gross
  });
});
