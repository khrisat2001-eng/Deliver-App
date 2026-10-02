import { type Minor } from './money.js';

export interface CancellationPolicy {
  /** Customer may cancel free within this many seconds after a driver accepted. */
  freeWindowS: number;
  /** Fee after the free window while the driver is on the way. */
  fee: Minor;
  /** Fee when the driver has already arrived and waited at least `noShowAfterS`. */
  feeAfterArrived: Minor;
  noShowAfterS: number;
}

export interface CancellationInput {
  status: 'REQUESTED' | 'SEARCHING' | 'DRIVER_ASSIGNED' | 'DRIVER_ARRIVING' | 'DRIVER_ARRIVED';
  secondsSinceAccepted: number;
  secondsSinceArrived?: number;
  /** Driver was late: actual arrival ETA exceeded the promised one by a margin. */
  driverLate?: boolean;
}

/** Fee charged to a customer who cancels. Drivers are never charged money; their cancellation rate is tracked instead. */
export function customerCancellationFee(p: CancellationPolicy, c: CancellationInput): Minor {
  if (c.status === 'REQUESTED' || c.status === 'SEARCHING') return 0;
  if (c.driverLate) return 0;
  if (c.status === 'DRIVER_ARRIVED') {
    return (c.secondsSinceArrived ?? 0) >= p.noShowAfterS ? p.feeAfterArrived : c.secondsSinceAccepted > p.freeWindowS ? p.fee : 0;
  }
  return c.secondsSinceAccepted > p.freeWindowS ? p.fee : 0;
}

export function cancellationRate(cancelled: number, total: number): number {
  return total === 0 ? 0 : Number(((cancelled / total) * 100).toFixed(2));
}
