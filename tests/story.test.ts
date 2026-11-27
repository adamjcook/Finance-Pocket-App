import { describe, expect, it } from 'vitest';
import { lookBackNews, ourStory } from '../src/logic/story';
import { homeNews, EMPTY_NEWS_MEMORY } from '../src/logic/news';
import { account, alias, snapshot, state } from './helpers';

const at = (day: string) => `${day}T09:00:00.000Z`;
const snap = (accountId: string, day: string, balance: number, id?: string) =>
  snapshot({ ...(id ? { id } : {}), accountId, balance, at: at(day), createdAt: at(day) });

describe('ourStory', () => {
  it('is empty with no balances', () => {
    expect(ourStory(state(), '2026-11-27')).toEqual([]);
  });

  it('tells the good moments in order, from where it began', () => {
    const s = state({
      accounts: [
        account({ id: 'card', name: 'Barclaycard', kind: 'credit_card' }),
        account({ id: 'pot', name: 'Wedding Fund', kind: 'savings', goalMinor: 2000_00 }),
      ],
      snapshots: [
        snap('card', '2026-01-31', 3500_00),
        snap('pot', '2026-01-31', 500_00),
        snap('card', '2026-02-28', 2600_00), // under £3,000
        snap('card', '2026-03-31', 2800_00), // up again: never a moment
        snap('card', '2026-04-30', 0), // paid off, all cleared
        snap('pot', '2026-04-30', 2100_00), // goal
      ],
    });
    const story = ourStory(s, '2026-11-27');
    expect(story.map((m) => [m.day, m.title])).toEqual([
      ['2026-01-31', 'Where it began'],
      ['2026-02-28', 'Card debt under £3,000 for the first time'],
      ['2026-04-30', 'All the card debt cleared'],
      ['2026-04-30', 'Barclaycard paid off'],
      ['2026-04-30', 'Wedding Fund reached its goal'],
      ['2026-04-30', 'Net worth above zero for the first time'],
      ['2026-04-30', 'Net worth over £2,000 for the first time'],
    ]);
    expect(story[0].detail).toBe('£3,500 on the cards · £500 saved');
  });

  it('names only the lowest line when one payment crosses several', () => {
    const s = state({
      accounts: [account({ id: 'card', kind: 'credit_card' })],
      snapshots: [snap('card', '2026-01-31', 5500_00), snap('card', '2026-02-28', 2500_00)],
    });
    const lows = ourStory(s, '2026-11-27').filter((m) => m.kind === 'low');
    expect(lows.map((m) => m.title)).toEqual(['Card debt under £3,000 for the first time']);
  });

  it("forgets a moment when its balance is undone", () => {
    const s = state({
      accounts: [account({ id: 'card', name: 'Amex', kind: 'credit_card' })],
      snapshots: [snap('card', '2026-01-31', 900_00), snap('card', '2026-02-28', 0, 'mistake')],
      voids: [{ snapshotId: 'mistake', at: at('2026-03-01'), deviceId: 'device-a' }],
    });
    expect(ourStory(s, '2026-11-27').map((m) => m.kind)).toEqual(['start']);
  });

  it('marks each full year, and bank switches', () => {
    const s = state({
      accounts: [
        // Re-pointing an alias archives the account it moved away from.
        account({ id: 'old', name: 'Marcus Saver', institution: 'Marcus', kind: 'savings', archived: true, archivedAt: at('2025-09-15') }),
        account({ id: 'new', name: 'Easy Saver', institution: 'Chase', kind: 'savings' }),
      ],
      aliases: [
        alias({
          name: 'Main Savings',
          accountId: 'new',
          history: [
            { accountId: 'old', from: at('2025-03-01') },
            { accountId: 'new', from: at('2025-09-15') },
          ],
        }),
      ],
      snapshots: [snap('old', '2025-03-01', 1000_00), snap('new', '2025-09-15', 4000_00)],
    });
    const story = ourStory(s, '2026-11-27');
    expect(story.find((m) => m.kind === 'switch')?.title).toBe('Main Savings moved to Chase');
    const year = story.find((m) => m.kind === 'year')!;
    expect(year.day).toBe('2026-03-01');
    expect(year.title).toBe('One year of doing this together');
    expect(year.detail).toBe('Since the start: net worth up £3,000');
  });
});

describe('lookBackNews', () => {
  const cards = state({
    accounts: [account({ id: 'card', kind: 'credit_card' })],
    snapshots: [
      snap('card', '2025-10-31', 6800_00),
      snap('card', '2026-05-15', 5200_00),
      snap('card', '2026-11-20', 3050_00),
    ],
  });

  it('compares the cards with six months and a year ago', () => {
    expect(lookBackNews(cards, '2026-11-27')?.text).toBe(
      'Six months ago the cards were at £5,200, and a year ago £6,800. Now £3,050.',
    );
  });

  it('looks back six months before there is a year of history', () => {
    const halfYear = state({
      accounts: [account({ id: 'card', kind: 'credit_card' })],
      snapshots: [snap('card', '2026-05-15', 5200_00), snap('card', '2026-11-20', 3050_00)],
    });
    expect(lookBackNews(halfYear, '2026-11-27')?.text).toBe('Six months ago the cards were at £5,200. Now £3,050.');
  });

  it('stays quiet without six months of history', () => {
    expect(lookBackNews(cards, '2026-04-20')).toBeNull();
  });

  it('only says the comparisons that are good news', () => {
    const bumpy = state({
      accounts: [account({ id: 'card', kind: 'credit_card' })],
      snapshots: [
        snap('card', '2025-10-31', 6800_00),
        snap('card', '2026-05-15', 2000_00),
        snap('card', '2026-11-20', 3050_00),
      ],
    });
    expect(lookBackNews(bumpy, '2026-11-27')?.text).toBe('A year ago the cards were at £6,800. Now £3,050.');
  });

  it('never points out a stretch that went the wrong way', () => {
    const worse = state({
      accounts: [account({ id: 'card', kind: 'credit_card' })],
      snapshots: [snap('card', '2025-10-31', 2000_00), snap('card', '2026-11-20', 3050_00)],
    });
    expect(lookBackNews(worse, '2026-11-27')).toBeNull();
  });

  it('falls back to net worth when there are no cards to talk about', () => {
    const savings = state({
      accounts: [account({ id: 'pot', kind: 'savings' })],
      snapshots: [snap('pot', '2025-11-01', 1000_00), snap('pot', '2026-05-01', 4000_00), snap('pot', '2026-11-20', 6000_00)],
    });
    expect(lookBackNews(savings, '2026-11-27')?.text).toBe('Net worth is up £2,000 in six months, and £5,000 in a year.');
  });

  it('holds the date to the end of a shorter month', () => {
    const s = state({
      accounts: [account({ id: 'card', kind: 'credit_card' })],
      snapshots: [snap('card', '2026-02-28', 4000_00), snap('card', '2026-08-20', 3000_00)],
    });
    expect(lookBackNews(s, '2026-08-31')?.text).toBe('Six months ago the cards were at £4,000. Now £3,000.');
  });

  it('reaches Home as the quietest news, at most once a month', () => {
    // Once the week of "under £4,000" news has passed.
    expect(homeNews(cards, '2026-12-05', EMPTY_NEWS_MEMORY)?.key).toBe('lookback:2026-12');
  });
});
