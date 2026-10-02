/** Money is always an integer in the currency's minor unit (IQD: 1 = 1 dinar). */
export type Minor = number;

/** Round half-up to the nearest step, e.g. 250 IQD. step <= 1 means plain integer rounding. */
export function roundToStep(amount: number, step: number): Minor {
  if (step <= 1) return Math.round(amount);
  return Math.round(amount / step) * step;
}

export function assertMinor(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
}
