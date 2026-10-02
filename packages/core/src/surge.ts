export interface SurgeWindow {
  /** 0 = Sunday … 6 = Saturday, in the city's local time. Empty/undefined = every day. */
  days?: number[];
  from: string; // "HH:MM"
  to: string; // "HH:MM", may wrap past midnight
  multiplier: number;
}

export interface SurgeRule {
  isEnabled: boolean;
  minMultiplier: number;
  maxMultiplier: number;
  /** demand/supply ratio where dynamic surge starts. */
  ratioThreshold: number;
  /** how much the multiplier grows per 1.0 of ratio above the threshold. */
  sensitivity: number;
  /** multiplier is rounded down to this step, e.g. 0.1. */
  stepSize: number;
  schedule?: SurgeWindow[];
  /** Admin override; wins over everything (still clamped). */
  manualMultiplier?: number | null;
}

export interface SurgeInput {
  /** Open ride requests in the zone during the sampling window. */
  demand: number;
  /** Idle online drivers in the zone. */
  supply: number;
  /** Local day of week (0-6) and minutes since local midnight. */
  localDay: number;
  localMinutes: number;
  /** Previous multiplier, used to smooth jumps. */
  previous?: number;
  /** Max change per recalculation tick (e.g. 0.3). */
  maxChangePerTick?: number;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function inWindow(w: SurgeWindow, day: number, minutes: number): boolean {
  const from = toMinutes(w.from);
  const to = toMinutes(w.to);
  if (from <= to) {
    return (!w.days?.length || w.days.includes(day)) && minutes >= from && minutes < to;
  }
  // window wraps midnight: the part after midnight belongs to the previous day's window
  if (minutes >= from) return !w.days?.length || w.days.includes(day);
  if (minutes < to) return !w.days?.length || w.days.includes((day + 6) % 7);
  return false;
}

export function scheduledMultiplier(rule: SurgeRule, day: number, minutes: number): number {
  return (rule.schedule ?? [])
    .filter((w) => inWindow(w, day, minutes))
    .reduce((max, w) => Math.max(max, w.multiplier), 1);
}

function floorToStep(value: number, step: number): number {
  if (step <= 0) return value;
  // epsilon guards against 1.3 / 0.1 = 12.999999…
  return Math.floor(value / step + 1e-9) * step;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Surge = clamp(max(dynamic, scheduled), min, max)
 * dynamic = 1 + (demand/supply − threshold) × sensitivity, when ratio > threshold.
 */
export function calculateSurge(rule: SurgeRule, input: SurgeInput): number {
  if (!rule.isEnabled) return 1;
  const lo = Math.max(1, rule.minMultiplier);
  const hi = Math.max(lo, rule.maxMultiplier);

  if (rule.manualMultiplier != null) return clamp(rule.manualMultiplier, lo, hi);

  const ratio = input.demand / Math.max(1, input.supply);
  const dynamic = ratio > rule.ratioThreshold ? 1 + (ratio - rule.ratioThreshold) * rule.sensitivity : 1;
  let m = Math.max(dynamic, scheduledMultiplier(rule, input.localDay, input.localMinutes));

  if (input.previous != null && input.maxChangePerTick != null) {
    m = clamp(m, input.previous - input.maxChangePerTick, input.previous + input.maxChangePerTick);
  }
  m = clamp(m, lo, hi);
  return Number(clamp(floorToStep(m, rule.stepSize), lo, hi).toFixed(2));
}
