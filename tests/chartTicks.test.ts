import { describe, expect, it } from 'vitest';
import { MIN_TICK_PX, tickBucket, tickStep } from '../src/logic/chartTicks';

describe('chart haptic ticks', () => {
  it('ticks per day when days are far enough apart, else per week, else per month', () => {
    expect(tickStep(MIN_TICK_PX)).toBe('day'); // e.g. two weeks across the chart
    expect(tickStep(2)).toBe('week'); // ~six months
    expect(tickStep(0.5)).toBe('month'); // ~two years
  });

  it('groups days into Monday-starting weeks and calendar months', () => {
    // Sun 22 Nov 2026 belongs to the week starting Mon 16 Nov; Mon 23 Nov starts a new one.
    expect(tickBucket('2026-11-22', 'week')).toBe('2026-11-16');
    expect(tickBucket('2026-11-23', 'week')).toBe('2026-11-23');
    expect(tickBucket('2026-11-29', 'week')).toBe('2026-11-23');
    expect(tickBucket('2026-11-30', 'month')).toBe('2026-11');
    expect(tickBucket('2026-12-01', 'month')).toBe('2026-12');
    expect(tickBucket('2026-12-01', 'day')).toBe('2026-12-01');
  });
});
