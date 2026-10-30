import { haversineM } from './geo.js';
export const DEFAULT_MATCHING_CONFIG = {
    radiiM: [2000, 4000, 7000],
    batchSize: 1,
    offerTimeoutS: 15,
    maxPickupEtaS: 15 * 60,
    cashDebtLimit: 50_000,
    fallbackSpeedMps: 6, // ~22 km/h, typical Iraqi city traffic
    weights: { eta: 0.6, rating: 0.15, acceptance: 0.15, idle: 0.1 },
};
export function eligibility(d, req, radiusM, cfg) {
    if (d.approvalStatus !== 'APPROVED')
        return { ok: false, reason: 'not_approved' };
    if (d.availability !== 'ONLINE')
        return { ok: false, reason: 'not_online' };
    if (d.cityId !== req.cityId)
        return { ok: false, reason: 'wrong_city' };
    if (!d.vehicleTypeIds.includes(req.vehicleTypeId))
        return { ok: false, reason: 'wrong_vehicle_type' };
    if (!d.documentsValid)
        return { ok: false, reason: 'documents_invalid' };
    if (req.excludedDriverIds.has(d.driverId))
        return { ok: false, reason: 'excluded' };
    if (req.blockedDriverIds?.has(d.driverId))
        return { ok: false, reason: 'blocked' };
    if (req.isCash && d.cashDebt > cfg.cashDebtLimit)
        return { ok: false, reason: 'cash_debt' };
    const distanceM = haversineM(req.pickup, d.location);
    if (distanceM > radiusM)
        return { ok: false, reason: 'too_far' };
    // straight-line distance × 1.3 approximates road distance when no ETA is known
    const etaS = d.pickupEtaS ?? Math.round((distanceM * 1.3) / cfg.fallbackSpeedMps);
    if (etaS > cfg.maxPickupEtaS)
        return { ok: false, reason: 'eta_too_long' };
    return { ok: true, distanceM, etaS };
}
/**
 * score = w.eta·(1 − eta/maxEta) + w.rating·(rating−1)/4 + w.acceptance·acceptanceRate + w.idle·min(idle/30min, 1)
 * Higher is better. ETA dominates so customers get the closest good driver;
 * idle time spreads trips fairly between drivers.
 */
export function scoreCandidate(d, etaS, cfg) {
    const w = cfg.weights;
    const etaScore = 1 - Math.min(etaS / cfg.maxPickupEtaS, 1);
    const ratingScore = (Math.min(Math.max(d.rating, 1), 5) - 1) / 4;
    const acceptScore = Math.min(Math.max(d.acceptanceRate, 0), 1);
    const idleScore = Math.min(d.idleSeconds / 1800, 1);
    return Number((w.eta * etaScore + w.rating * ratingScore + w.acceptance * acceptScore + w.idle * idleScore).toFixed(4));
}
/** Ranked eligible drivers inside `radiusM`. */
export function rankDrivers(drivers, req, radiusM, cfg = DEFAULT_MATCHING_CONFIG) {
    const out = [];
    for (const d of drivers) {
        const e = eligibility(d, req, radiusM, cfg);
        if (!e.ok)
            continue;
        out.push({ driverId: d.driverId, distanceM: Math.round(e.distanceM), pickupEtaS: e.etaS, score: scoreCandidate(d, e.etaS, cfg) });
    }
    return out.sort((a, b) => b.score - a.score || a.pickupEtaS - b.pickupEtaS);
}
/**
 * Decide the next dispatch step. Called when a trip is created and every time an offer
 * is rejected or times out. Rounds widen the radius only when the current radius has
 * nobody left to offer.
 */
export function nextDispatchStep(drivers, req, startRound, cfg = DEFAULT_MATCHING_CONFIG) {
    for (let round = startRound; round < cfg.radiiM.length; round++) {
        const radiusM = cfg.radiiM[round];
        const ranked = rankDrivers(drivers, req, radiusM, cfg);
        if (ranked.length > 0) {
            return { kind: 'offer', round, radiusM, drivers: ranked.slice(0, cfg.batchSize), timeoutS: cfg.offerTimeoutS };
        }
    }
    return { kind: 'no_driver_found' };
}
