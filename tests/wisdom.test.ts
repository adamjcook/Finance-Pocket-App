import { describe, expect, it } from 'vitest';
import {
  dashboardSummary,
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

describe('dashboardSummary', () => {
  const today = '2026-01-01';
  const currency = 'GBP';

  it('describes every card that has data, joined with an Oxford comma', () => {
    const text = dashboardSummary({
      today,
      currency,
      debt: { baseline: 5000_00, current: 2500_00, pct: 50 },
      growth: { delta30: 600_00, hasHistory: true },
      loans: { current: 9000_00, hasLoans: true },
    });
    expect(text).toContain('50% of your card debt');
    expect(text).toContain('£2,500.00 left');
    expect(text).toContain('savings & investments grew by £600.00');
    expect(text).toContain('£9,000.00 remains on loans');
    expect(text).toContain(', and'); // three clauses take the Oxford comma
    expect(text.startsWith('You')).toBe(true); // capitalised
  });

  it('skips cards with no data instead of describing an empty state', () => {
    const text = dashboardSummary({
      today,
      currency,
      debt: { baseline: 0, current: 0, pct: 0 },
      growth: { delta30: 600_00, hasHistory: true },
      loans: { current: 0, hasLoans: false },
    });
    expect(text).not.toContain('card debt');
    expect(text).not.toContain('loans');
    expect(text.startsWith('Savings & investments grew')).toBe(true);
  });

  it('falls back to a plain nudge and the daily quote with nothing tracked', () => {
    const text = dashboardSummary({
      today,
      currency,
      debt: { baseline: 0, current: 0, pct: 0 },
      growth: { delta30: 0, hasHistory: false },
      loans: { current: 0, hasLoans: false },
    });
    expect(text.startsWith('Add your accounts to start tracking.')).toBe(true);
    expect(text.length).toBeGreaterThan('Add your accounts to start tracking.'.length);
  });

  it('describes a dip and a cleared debt without double-counting the closer', () => {
    const text = dashboardSummary({
      today,
      currency,
      debt: { baseline: 5000_00, current: 0, pct: 100 },
      growth: { delta30: -200_00, hasHistory: true },
      loans: { current: 0, hasLoans: true },
    });
    expect(text).toContain('card debt is cleared');
    expect(text).toContain('dipped by £200.00');
    expect(text).toContain('loans are cleared');
    // debt is cleared and loans are cleared, so the closer falls through to growth
    expect(text).toContain(growthEncouragement(today, -200_00, true));
  });

  it('is deterministic for the same inputs', () => {
    const input = {
      today,
      currency,
      debt: { baseline: 5000_00, current: 2500_00, pct: 50 },
      growth: { delta30: 600_00, hasHistory: true },
      loans: { current: 0, hasLoans: false },
    };
    expect(dashboardSummary(input)).toBe(dashboardSummary(input));
  });
});
