import { assertMinor, roundToStep, type Minor } from './money.js';

export interface PricingRule {
  baseFare: Minor;
  perKm: Minor;
  perMinute: Minor;
  minimumFare: Minor;
  bookingFee: Minor;
  freeWaitingMinutes: number;
  waitingPerMinute: Minor;
  airportFee: Minor;
  specialFee: Minor;
  /** Final fare is rounded to this step (250 for IQD). */
  roundingStep: Minor;
}

export interface FareInput {
  distanceM: number;
  durationS: number;
  /** Time the driver waited at pickup after arriving. */
  waitingS?: number;
  surgeMultiplier?: number;
  /** Pickup or drop-off is inside an airport zone. */
  touchesAirport?: boolean;
  /** Any extra admin-defined fees (tolls, special zone fees) in minor units. */
  extraFees?: Minor[];
  discount?: Minor;
}

export interface FareBreakdown {
  baseFare: Minor;
  distanceFare: Minor;
  timeFare: Minor;
  waitingFare: Minor;
  surgeAmount: Minor;
  fees: Minor;
  discount: Minor;
  minimumApplied: boolean;
  /** Fare before discount — commission is computed on this. */
  gross: Minor;
  /** What the customer pays. */
  total: Minor;
}

/**
 * Fare = max(MinimumFare, (Base + Distance + Time) × Surge) + Waiting + Fees − Discount
 *
 * Surge only multiplies the ride part, never waiting time or fixed fees.
 * The result is rounded to `roundingStep` and never negative.
 */
export function calculateFare(rule: PricingRule, input: FareInput): FareBreakdown {
  const surge = input.surgeMultiplier ?? 1;
  if (surge < 1) throw new RangeError('surgeMultiplier must be >= 1');
  if (input.distanceM < 0 || input.durationS < 0) throw new RangeError('distance/duration must be >= 0');

  const distanceFare = (input.distanceM / 1000) * rule.perKm;
  const timeFare = (input.durationS / 60) * rule.perMinute;
  const rideBeforeSurge = rule.baseFare + distanceFare + timeFare;
  const rideAfterSurge = rideBeforeSurge * surge;
  const minimumApplied = rideAfterSurge < rule.minimumFare;
  const ride = minimumApplied ? rule.minimumFare : rideAfterSurge;
  const surgeAmount = minimumApplied ? 0 : rideAfterSurge - rideBeforeSurge;

  const billableWaitingMin = Math.max(0, (input.waitingS ?? 0) / 60 - rule.freeWaitingMinutes);
  const waitingFare = Math.ceil(billableWaitingMin) * rule.waitingPerMinute;

  const extra = (input.extraFees ?? []).reduce((s, f) => s + f, 0);
  const fees = rule.bookingFee + (input.touchesAirport ? rule.airportFee : 0) + rule.specialFee + extra;

  const gross = roundToStep(ride + waitingFare + fees, rule.roundingStep);
  const discount = Math.min(input.discount ?? 0, gross);
  const total = Math.max(0, roundToStep(gross - discount, rule.roundingStep));
  assertMinor(total, 'total');

  return {
    baseFare: Math.round(rule.baseFare),
    distanceFare: Math.round(distanceFare),
    timeFare: Math.round(timeFare),
    waitingFare,
    surgeAmount: Math.round(surgeAmount),
    fees,
    discount: gross - total,
    minimumApplied,
    gross,
    total,
  };
}

export interface FinalFareDecision {
  fare: FareBreakdown;
  /** true when the upfront estimate was kept because the actual trip stayed within tolerance. */
  keptEstimate: boolean;
}

/**
 * Final fare from the actual trip. If the actual price is within `tolerancePct`
 * of the upfront estimate, the customer pays the estimate (no surprises).
 * Waiting charges are always added on top of a kept estimate.
 */
export function finalizeFare(
  rule: PricingRule,
  estimate: FareBreakdown,
  actual: FareInput,
  tolerancePct: number,
): FinalFareDecision {
  const fare = calculateFare(rule, actual);
  const rideOnlyActual = fare.gross - fare.waitingFare;
  const rideOnlyEstimate = estimate.gross - estimate.waitingFare;
  const deviation = rideOnlyEstimate === 0 ? Infinity : Math.abs(rideOnlyActual - rideOnlyEstimate) / rideOnlyEstimate;

  if (deviation * 100 <= tolerancePct) {
    const gross = roundToStep(rideOnlyEstimate + fare.waitingFare, rule.roundingStep);
    const discount = Math.min(actual.discount ?? 0, gross);
    const total = roundToStep(gross - discount, rule.roundingStep);
    return {
      keptEstimate: true,
      fare: { ...estimate, waitingFare: fare.waitingFare, gross, discount: gross - total, total },
    };
  }
  return { keptEstimate: false, fare };
}
