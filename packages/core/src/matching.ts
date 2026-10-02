import { haversineM, type LatLng } from './geo.js';

export interface DriverCandidate {
  driverId: string;
  location: LatLng;
  cityId: string;
  vehicleTypeIds: string[];
  approvalStatus: string;
  availability: 'OFFLINE' | 'ONLINE' | 'BUSY' | 'ON_TRIP';
  /** 1..5 */
  rating: number;
  /** 0..1 over the last N offers */
  acceptanceRate: number;
  /** seconds since the driver's last trip ended or went online */
  idleSeconds: number;
  /** Outstanding cash-commission debt in minor units. */
  cashDebt: number;
  documentsValid: boolean;
  /** Road ETA to pickup from the map provider; falls back to straight-line estimate. */
  pickupEtaS?: number;
}

export interface MatchRequest {
  pickup: LatLng;
  cityId: string;
  vehicleTypeId: string;
  isCash: boolean;
  /** Drivers that already rejected / timed out / were offered this trip. */
  excludedDriverIds: ReadonlySet<string>;
  /** Drivers this customer blocked or reported. */
  blockedDriverIds?: ReadonlySet<string>;
}

export interface MatchingConfig {
  /** Search radius per round in meters, e.g. [2000, 4000, 7000]. */
  radiiM: number[];
  /** Drivers offered at once in a round (1 = sequential dispatch). */
  batchSize: number;
  offerTimeoutS: number;
  maxPickupEtaS: number;
  /** Drivers above this cash debt cannot take cash trips. */
  cashDebtLimit: number;
  /** Used when no road ETA is available: average city speed in m/s. */
  fallbackSpeedMps: number;
  weights: { eta: number; rating: number; acceptance: number; idle: number };
}

export const DEFAULT_MATCHING_CONFIG: MatchingConfig = {
  radiiM: [2000, 4000, 7000],
  batchSize: 1,
  offerTimeoutS: 15,
  maxPickupEtaS: 15 * 60,
  cashDebtLimit: 50_000,
  fallbackSpeedMps: 6, // ~22 km/h, typical Iraqi city traffic
  weights: { eta: 0.6, rating: 0.15, acceptance: 0.15, idle: 0.1 },
};

export type RejectReason =
  | 'not_approved'
  | 'not_online'
  | 'wrong_city'
  | 'wrong_vehicle_type'
  | 'documents_invalid'
  | 'excluded'
  | 'blocked'
  | 'cash_debt'
  | 'too_far'
  | 'eta_too_long';

export interface ScoredCandidate {
  driverId: string;
  distanceM: number;
  pickupEtaS: number;
  score: number;
}

export function eligibility(
  d: DriverCandidate,
  req: MatchRequest,
  radiusM: number,
  cfg: MatchingConfig,
): { ok: true; distanceM: number; etaS: number } | { ok: false; reason: RejectReason } {
  if (d.approvalStatus !== 'APPROVED') return { ok: false, reason: 'not_approved' };
  if (d.availability !== 'ONLINE') return { ok: false, reason: 'not_online' };
  if (d.cityId !== req.cityId) return { ok: false, reason: 'wrong_city' };
  if (!d.vehicleTypeIds.includes(req.vehicleTypeId)) return { ok: false, reason: 'wrong_vehicle_type' };
  if (!d.documentsValid) return { ok: false, reason: 'documents_invalid' };
  if (req.excludedDriverIds.has(d.driverId)) return { ok: false, reason: 'excluded' };
  if (req.blockedDriverIds?.has(d.driverId)) return { ok: false, reason: 'blocked' };
  if (req.isCash && d.cashDebt > cfg.cashDebtLimit) return { ok: false, reason: 'cash_debt' };

  const distanceM = haversineM(req.pickup, d.location);
  if (distanceM > radiusM) return { ok: false, reason: 'too_far' };
  // straight-line distance × 1.3 approximates road distance when no ETA is known
  const etaS = d.pickupEtaS ?? Math.round((distanceM * 1.3) / cfg.fallbackSpeedMps);
  if (etaS > cfg.maxPickupEtaS) return { ok: false, reason: 'eta_too_long' };
  return { ok: true, distanceM, etaS };
}

/**
 * score = w.eta·(1 − eta/maxEta) + w.rating·(rating−1)/4 + w.acceptance·acceptanceRate + w.idle·min(idle/30min, 1)
 * Higher is better. ETA dominates so customers get the closest good driver;
 * idle time spreads trips fairly between drivers.
 */
export function scoreCandidate(d: DriverCandidate, etaS: number, cfg: MatchingConfig): number {
  const w = cfg.weights;
  const etaScore = 1 - Math.min(etaS / cfg.maxPickupEtaS, 1);
  const ratingScore = (Math.min(Math.max(d.rating, 1), 5) - 1) / 4;
  const acceptScore = Math.min(Math.max(d.acceptanceRate, 0), 1);
  const idleScore = Math.min(d.idleSeconds / 1800, 1);
  return Number((w.eta * etaScore + w.rating * ratingScore + w.acceptance * acceptScore + w.idle * idleScore).toFixed(4));
}

/** Ranked eligible drivers inside `radiusM`. */
export function rankDrivers(
  drivers: DriverCandidate[],
  req: MatchRequest,
  radiusM: number,
  cfg: MatchingConfig = DEFAULT_MATCHING_CONFIG,
): ScoredCandidate[] {
  const out: ScoredCandidate[] = [];
  for (const d of drivers) {
    const e = eligibility(d, req, radiusM, cfg);
    if (!e.ok) continue;
    out.push({ driverId: d.driverId, distanceM: Math.round(e.distanceM), pickupEtaS: e.etaS, score: scoreCandidate(d, e.etaS, cfg) });
  }
  return out.sort((a, b) => b.score - a.score || a.pickupEtaS - b.pickupEtaS);
}

export type DispatchStep =
  | { kind: 'offer'; round: number; radiusM: number; drivers: ScoredCandidate[]; timeoutS: number }
  | { kind: 'no_driver_found' };

/**
 * Decide the next dispatch step. Called when a trip is created and every time an offer
 * is rejected or times out. Rounds widen the radius only when the current radius has
 * nobody left to offer.
 */
export function nextDispatchStep(
  drivers: DriverCandidate[],
  req: MatchRequest,
  startRound: number,
  cfg: MatchingConfig = DEFAULT_MATCHING_CONFIG,
): DispatchStep {
  for (let round = startRound; round < cfg.radiiM.length; round++) {
    const radiusM = cfg.radiiM[round]!;
    const ranked = rankDrivers(drivers, req, radiusM, cfg);
    if (ranked.length > 0) {
      return { kind: 'offer', round, radiusM, drivers: ranked.slice(0, cfg.batchSize), timeoutS: cfg.offerTimeoutS };
    }
  }
  return { kind: 'no_driver_found' };
}
