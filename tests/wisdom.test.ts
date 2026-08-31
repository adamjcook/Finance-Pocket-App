import { describe, expect, it } from 'vitest';
import {
  debtEncouragement,
  growthEncouragement,
  loanEncouragement,
  quoteOfTheDay,
  starterQuote,
} from '../src/logic/wisdom';

describe('quoteOfTheDay / starterQuote', () => {
  it('is deterministic for a given day, and stable across days it repeats for', () => {
    expect(quoteOfTheDay('2026-03-01')).toBe(quoteOfTheDay('2026-03-01'));
    expect(starterQuote('2026-03-01')).toBe(starterQuote('2026-03-01'));
  });

  it('picks from a non-empty, non-blank line for a range of dates', () => {
    for (const day of ['2026-01-01', '2026-06-15', '2027-12-31']) {
      expect(quoteOfTheDay(day).length).toBeGreaterThan(0);
      expect(starterQuote(day).length).toBeGreaterThan(0);
    }
  });
});

describe('debtEncouragement', () => {
  it('is null once cleared, or with no progress yet', () => {
    expect(debtEncouragement('2026-01-01', 100, true)).toBeNull();
    expect(debtEncouragement('2026-01-01', 0, false)).toBeNull();
  });

  it('returns a non-empty line for each progress bucket', () => {
    expect(debtEncouragement('2026-01-01', 10, false)).not.toBeNull();
    expect(debtEncouragement('2026-01-01', 30, false)).not.toBeNull();
    expect(debtEncouragement('2026-01-01', 60, false)).not.toBeNull();
    expect(debtEncouragement('2026-01-01', 90, false)).not.toBeNull();
  });
});

describe('growthEncouragement', () => {
  it('is null with no history yet', () => {
    expect(growthEncouragement('2026-01-01', 500, false)).toBeNull();
  });

  it('returns a line for gains, losses, and flat months', () => {
    expect(growthEncouragement('2026-01-01', 100, true)).not.toBeNull();
    expect(growthEncouragement('2026-01-01', -100, true)).not.toBeNull();
    expect(growthEncouragement('2026-01-01', 0, true)).not.toBeNull();
  });
});

describe('loanEncouragement', () => {
  it('is null once cleared, otherwise returns a line', () => {
    expect(loanEncouragement('2026-01-01', true)).toBeNull();
    expect(loanEncouragement('2026-01-01', false)).not.toBeNull();
  });
});
