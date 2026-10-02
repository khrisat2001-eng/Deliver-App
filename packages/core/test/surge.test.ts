import { describe, expect, it } from 'vitest';
import { calculateSurge, inWindow, type SurgeRule } from '../src/surge.js';

const rule: SurgeRule = {
  isEnabled: true,
  minMultiplier: 1,
  maxMultiplier: 2,
  ratioThreshold: 1.2,
  sensitivity: 0.5,
  stepSize: 0.1,
  schedule: [{ days: [0, 1, 2, 3, 4], from: '07:00', to: '09:00', multiplier: 1.2 }],
};
const at = (localDay: number, hh: number, mm = 0) => ({ localDay, localMinutes: hh * 60 + mm });

describe('calculateSurge', () => {
  it('is 1.0 when supply covers demand', () => {
    expect(calculateSurge(rule, { demand: 10, supply: 10, ...at(5, 12) })).toBe(1);
  });

  it('grows with demand/supply ratio and rounds down to step', () => {
    // ratio 2.0 → 1 + 0.8×0.5 = 1.4
    expect(calculateSurge(rule, { demand: 20, supply: 10, ...at(5, 12) })).toBe(1.4);
  });

  it('is capped at the max multiplier', () => {
    expect(calculateSurge(rule, { demand: 100, supply: 1, ...at(5, 12) })).toBe(2);
  });

  it('treats zero supply as one driver', () => {
    expect(calculateSurge(rule, { demand: 2, supply: 0, ...at(5, 12) })).toBe(1.4);
  });

  it('applies the scheduled peak window on work days', () => {
    expect(calculateSurge(rule, { demand: 0, supply: 5, ...at(1, 8) })).toBe(1.2);
    // Friday (5) is not in the window
    expect(calculateSurge(rule, { demand: 0, supply: 5, ...at(5, 8) })).toBe(1);
  });

  it('respects the manual override and the on/off switch', () => {
    expect(calculateSurge({ ...rule, manualMultiplier: 1.7 }, { demand: 0, supply: 5, ...at(5, 12) })).toBe(1.7);
    expect(calculateSurge({ ...rule, isEnabled: false }, { demand: 100, supply: 1, ...at(1, 8) })).toBe(1);
  });

  it('smooths jumps between ticks', () => {
    expect(calculateSurge(rule, { demand: 100, supply: 1, ...at(5, 12), previous: 1, maxChangePerTick: 0.3 })).toBe(1.3);
  });
});

describe('inWindow', () => {
  const late = { days: [4], from: '22:00', to: '02:00', multiplier: 1.3 };
  it('handles windows that wrap past midnight', () => {
    expect(inWindow(late, 4, 23 * 60)).toBe(true);
    expect(inWindow(late, 5, 60)).toBe(true); // Friday 01:00 belongs to Thursday night
    expect(inWindow(late, 4, 60)).toBe(false);
  });
});
