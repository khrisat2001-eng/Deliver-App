function toMinutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
}
export function inWindow(w, day, minutes) {
    const from = toMinutes(w.from);
    const to = toMinutes(w.to);
    if (from <= to) {
        return (!w.days?.length || w.days.includes(day)) && minutes >= from && minutes < to;
    }
    // window wraps midnight: the part after midnight belongs to the previous day's window
    if (minutes >= from)
        return !w.days?.length || w.days.includes(day);
    if (minutes < to)
        return !w.days?.length || w.days.includes((day + 6) % 7);
    return false;
}
export function scheduledMultiplier(rule, day, minutes) {
    return (rule.schedule ?? [])
        .filter((w) => inWindow(w, day, minutes))
        .reduce((max, w) => Math.max(max, w.multiplier), 1);
}
function floorToStep(value, step) {
    if (step <= 0)
        return value;
    // epsilon guards against 1.3 / 0.1 = 12.999999…
    return Math.floor(value / step + 1e-9) * step;
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/**
 * Surge = clamp(max(dynamic, scheduled), min, max)
 * dynamic = 1 + (demand/supply − threshold) × sensitivity, when ratio > threshold.
 */
export function calculateSurge(rule, input) {
    if (!rule.isEnabled)
        return 1;
    const lo = Math.max(1, rule.minMultiplier);
    const hi = Math.max(lo, rule.maxMultiplier);
    if (rule.manualMultiplier != null)
        return clamp(rule.manualMultiplier, lo, hi);
    const ratio = input.demand / Math.max(1, input.supply);
    const dynamic = ratio > rule.ratioThreshold ? 1 + (ratio - rule.ratioThreshold) * rule.sensitivity : 1;
    let m = Math.max(dynamic, scheduledMultiplier(rule, input.localDay, input.localMinutes));
    if (input.previous != null && input.maxChangePerTick != null) {
        m = clamp(m, input.previous - input.maxChangePerTick, input.previous + input.maxChangePerTick);
    }
    m = clamp(m, lo, hi);
    return Number(clamp(floorToStep(m, rule.stepSize), lo, hi).toFixed(2));
}
