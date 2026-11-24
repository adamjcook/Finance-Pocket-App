import { describe, expect, it } from 'vitest';
import { starterQuote } from '../src/logic/wisdom';

describe('starterQuote', () => {
  it('is stable for a given day', () => {
    expect(starterQuote('2026-03-01')).toBe(starterQuote('2026-03-01'));
  });

  it('always returns a line', () => {
    for (const day of ['2026-01-01', '2026-06-15', '2027-12-31']) {
      expect(starterQuote(day).length).toBeGreaterThan(0);
    }
  });
});
