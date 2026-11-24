import { describe, expect, it } from 'vitest';
import {
  cardForecast,
  EMPTY_NEWS_MEMORY,
  homeNews,
  rememberDismissed,
  rememberForecast,
  rememberShown,
} from '../src/logic/news';
import { account, snapshot, state } from './helpers';

const at = (day: string) => `${day}T09:00:00.000Z`;

/** One card with month-end balances, oldest first. */
function cardHistory(points: [string, number][], extra: Partial<Parameters<typeof account>[0]> = {}) {
  return state({
    accounts: [account({ id: 'card', name: 'Barclaycard', kind: 'credit_card', ...extra })],
    snapshots: points.map(([day, balance]) => snapshot({ accountId: 'card', balance, at: at(day), createdAt: at(day) })),
  });
}

describe('homeNews', () => {
  it('is quiet when nothing has happened', () => {
    const s = cardHistory([
      ['2026-06-30', 3500_00],
      ['2026-07-31', 3600_00],
    ]);
    expect(homeNews(s, '2026-11-24', EMPTY_NEWS_MEMORY)).toBeNull();
  });

  it('names a round-number low for a week after crossing it, then goes quiet', () => {
    const s = cardHistory([
      ['2026-09-30', 3400_00],
      ['2026-10-31', 3150_00],
      ['2026-11-20', 2950_00],
    ]);
    expect(homeNews(s, '2026-11-24', EMPTY_NEWS_MEMORY)?.text).toBe('Card debt is under £3,000 for the first time.');
    expect(homeNews(s, '2026-11-28', EMPTY_NEWS_MEMORY)).toBeNull();
  });

  it("doesn't call it a first when the history started below the line", () => {
    const s = cardHistory([['2026-11-20', 2950_00]]);
    expect(homeNews(s, '2026-11-24', EMPTY_NEWS_MEMORY)).toBeNull();
  });

  it('counts down a 0% deal at thresholds, most urgent first', () => {
    const s = cardHistory([['2026-11-01', 2150_00]], { promoEndsOn: '2026-12-17' });
    const n = homeNews(s, '2026-11-24', EMPTY_NEWS_MEMORY)!;
    expect(n.text).toBe('Barclaycard’s 0% deal ends in 23 days (17 Dec 2026), with £2,150 still on it.');
    // Shown, then quiet for the rest of its week…
    const seen = rememberShown(EMPTY_NEWS_MEMORY, n.key, '2026-11-24');
    expect(homeNews(s, '2026-12-01', seen)).toBeNull();
    // …and back when it crosses into the last fortnight.
    expect(homeNews(s, '2026-12-04', seen)?.text).toContain('ends in 13 days');
  });

  it('stays dismissed', () => {
    const s = cardHistory([['2026-11-01', 2150_00]], { promoEndsOn: '2026-12-17' });
    const n = homeNews(s, '2026-11-24', EMPTY_NEWS_MEMORY)!;
    expect(homeNews(s, '2026-11-25', rememberDismissed(EMPTY_NEWS_MEMORY, n.key))).toBeNull();
  });

  it('celebrates a streak of months coming down', () => {
    const s = cardHistory([
      ['2026-07-31', 9900_00],
      ['2026-08-31', 9700_00],
      ['2026-09-30', 9500_00],
      ['2026-10-31', 9200_00],
      ['2026-11-22', 9100_00],
    ]);
    expect(homeNews(s, '2026-11-24', EMPTY_NEWS_MEMORY)?.text).toBe('Card debt has come down four months running.');
  });

  it('says when the cards are clear', () => {
    const s = cardHistory([
      ['2026-10-31', 400_00],
      ['2026-11-22', 0],
    ]);
    expect(homeNews(s, '2026-11-24', EMPTY_NEWS_MEMORY)?.text).toBe(
      'Your cards are clear. Every penny of that debt, paid off.',
    );
  });
});

describe('pay-off forecast', () => {
  const s = cardHistory([
    ['2026-08-01', 6000_00],
    ['2026-09-01', 5000_00],
    ['2026-10-01', 4000_00],
    ['2026-11-01', 3000_00],
  ]);

  it('projects the pace of the last three months from the last update', () => {
    expect(cardForecast(s, '2026-11-24')).toBe('2027-01'); // £3,000 left at ~£1,015/month from 1 Nov
  });

  it("isn't news the first time, only when it moves", () => {
    const first = rememberForecast(EMPTY_NEWS_MEMORY, '2027-04', '2026-10-01');
    expect(first.forecastWas).toBeNull();
    expect(homeNews(s, '2026-11-24', { ...first, forecast: '2027-04' })).toBeNull();
    const moved = rememberForecast(first, '2027-02', '2026-11-22');
    expect(homeNews(s, '2026-11-24', moved)?.text).toBe(
      'At this pace the cards are clear by Feb 2027, two months sooner than before.',
    );
  });
});
