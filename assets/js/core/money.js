/** Round half-up to the nearest step, e.g. 250 IQD. step <= 1 means plain integer rounding. */
export function roundToStep(amount, step) {
    if (step <= 1)
        return Math.round(amount);
    return Math.round(amount / step) * step;
}
export function assertMinor(value, name) {
    if (!Number.isInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
    }
}
