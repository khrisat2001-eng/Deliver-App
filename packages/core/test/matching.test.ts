import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCHING_CONFIG, eligibility, nextDispatchStep, rankDrivers, type DriverCandidate, type MatchRequest } from '../src/matching.js';

const pickup = { lat: 36.1911, lng: 44.0092 }; // Erbil citadel
const near = (dLat: number) => ({ lat: pickup.lat + dLat, lng: pickup.lng });

const driver = (id: string, over: Partial<DriverCandidate> = {}): DriverCandidate => ({
  driverId: id,
  location: near(0.005), // ~550 m
  cityId: 'erbil',
  vehicleTypeIds: ['economy'],
  approvalStatus: 'APPROVED',
  availability: 'ONLINE',
  rating: 4.8,
  acceptanceRate: 0.9,
  idleSeconds: 600,
  cashDebt: 0,
  documentsValid: true,
  ...over,
});

const req: MatchRequest = { pickup, cityId: 'erbil', vehicleTypeId: 'economy', isCash: true, excludedDriverIds: new Set() };

describe('eligibility', () => {
  const cases: [Partial<DriverCandidate>, string][] = [
    [{ approvalStatus: 'PENDING' }, 'not_approved'],
    [{ availability: 'ON_TRIP' }, 'not_online'],
    [{ cityId: 'duhok' }, 'wrong_city'],
    [{ vehicleTypeIds: ['suv'] }, 'wrong_vehicle_type'],
    [{ documentsValid: false }, 'documents_invalid'],
    [{ cashDebt: 999_999 }, 'cash_debt'],
    [{ location: near(0.1) }, 'too_far'],
  ];
  it.each(cases)('rejects %o with %s', (over, reason) => {
    const r = eligibility(driver('x', over), req, 2000, DEFAULT_MATCHING_CONFIG);
    expect(r.ok ? 'ok' : r.reason).toBe(reason);
  });

  it('allows indebted drivers on cashless trips', () => {
    expect(eligibility(driver('x', { cashDebt: 999_999 }), { ...req, isCash: false }, 2000, DEFAULT_MATCHING_CONFIG).ok).toBe(true);
  });
});

describe('rankDrivers', () => {
  it('prefers closer drivers, then better rating', () => {
    const ranked = rankDrivers(
      [driver('far', { location: near(0.015) }), driver('close'), driver('close-low', { rating: 3.5 })],
      req,
      2000,
    );
    expect(ranked.map((r) => r.driverId)).toEqual(['close', 'close-low', 'far']);
  });

  it('uses road ETA from the map provider when given', () => {
    const ranked = rankDrivers([driver('a', { pickupEtaS: 600 }), driver('b', { location: near(0.012), pickupEtaS: 120 })], req, 2000);
    expect(ranked[0]?.driverId).toBe('b');
  });
});

describe('nextDispatchStep', () => {
  it('widens the radius only when needed', () => {
    const step = nextDispatchStep([driver('far', { location: near(0.03) })], req, 0); // ~3.3 km
    expect(step).toMatchObject({ kind: 'offer', round: 1, radiusM: 4000 });
  });

  it('skips drivers who already rejected and ends with no_driver_found', () => {
    const step = nextDispatchStep([driver('a')], { ...req, excludedDriverIds: new Set(['a']) }, 0);
    expect(step.kind).toBe('no_driver_found');
  });
});
