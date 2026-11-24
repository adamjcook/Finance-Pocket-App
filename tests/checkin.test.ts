import { describe, expect, it } from 'vitest';
import { looksLikeATypo, summariseCheckIn } from '../src/logic/checkin';
import { netWorthLines, netWorthMilestone } from '../src/logic/progress';
import { addSnapshots } from '../src/model/repo';
import { account, snapshot, state } from './helpers';

const TODAY = '2026-11-28';
const AT = '2026-11-28T09:00:00.000Z';

function base() {
  const card = account({ id: 'card', name: 'Barclaycard', kind: 'credit_card' });
  const amex = account({ id: 'amex', name: 'Amex', kind: 'credit_card' });
  const pot = account({ id: 'pot', name: 'Wedding fund', kind: 'savings', goalMinor: 5000_00 });
  return state({
    accounts: [card, amex, pot],
    snapshots: [
      snapshot({ accountId: 'card', balance: 3000_00, at: '2026-09-30T09:00:00.000Z' }),
      snapshot({ accountId: 'amex', balance: 500_00, at: '2026-09-30T09:00:00.000Z' }),
      snapshot({ accountId: 'pot', balance: 4000_00, at: '2026-09-30T09:00:00.000Z' }),
      snapshot({ accountId: 'card', balance: 2500_00, at: '2026-10-31T09:00:00.000Z' }),
    ],
  });
}

function save(before: ReturnType<typeof base>, entries: { accountId: string; balance: number }[]) {
  const after = addSnapshots(before, { deviceId: 'd', now: AT }, entries.map((e) => ({ ...e, at: AT })));
  const ids = after.snapshots.slice(before.snapshots.length).map((s) => s.id);
  return summariseCheckIn(before, after, AT, ids, TODAY);
}

describe('summariseCheckIn', () => {
  it('reports the change in each total and the snapshots for undo', () => {
    const c = save(base(), [
      { accountId: 'card', balance: 2200_00 },
      { accountId: 'pot', balance: 4300_00 },
    ]);
    expect(c.cardChange).toBe(-300_00);
    expect(c.savingsChange).toBe(300_00);
    expect(c.has).toEqual({ cards: true, loans: false, savings: true });
    expect(c.snapshotIds).toHaveLength(2);
  });

  it('names a new lowest card debt, a card paid off and a goal reached', () => {
    const c = save(base(), [
      { accountId: 'amex', balance: 0 },
      { accountId: 'pot', balance: 5100_00 },
    ]);
    // Net worth also goes from £1,000 to £2,600: past £2,000 for the first time.
    expect(c.milestones).toEqual([
      'Net worth over £2,000 for the first time',
      'Lowest card debt yet',
      'Amex paid off',
      'Wedding fund reached its goal',
    ]);
  });

  it('calls out all card debt cleared instead of a new low', () => {
    const c = save(base(), [
      { accountId: 'card', balance: 0 },
      { accountId: 'amex', balance: 0 },
    ]);
    expect(c.milestones[0]).toBe('All card debt cleared');
    expect(c.milestones[1]).toBe('Net worth over £4,000 for the first time');
    expect(c.milestones).not.toContain('Lowest card debt yet');
  });

  it('stays quiet when debt goes up', () => {
    const c = save(base(), [{ accountId: 'card', balance: 2900_00 }]);
    expect(c.cardChange).toBe(400_00);
    expect(c.milestones).toEqual([]);
  });
});

describe('looksLikeATypo', () => {
  it('flags an extra zero or slipped decimal point', () => {
    expect(looksLikeATypo(1800_00, 18000_00)).toBe(true);
    expect(looksLikeATypo(1800_00, 180_00)).toBe(true);
  });
  it('ignores ordinary changes, small sums and zeroes', () => {
    expect(looksLikeATypo(1800_00, 1500_00)).toBe(false);
    expect(looksLikeATypo(20_00, 90_00)).toBe(false);
    expect(looksLikeATypo(1800_00, 0)).toBe(false);
    expect(looksLikeATypo(null, 5000_00)).toBe(false);
  });
});

describe('net-worth milestones', () => {
  const hist = (...values: number[]) => values.map((value, i) => ({ day: `2026-0${i + 1}-01`, value }));

  it('steps every £1,000 to £10k, every £5,000 to £50k, then every £10,000', () => {
    expect(netWorthLines(12_000_00)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((k) => k * 1000_00));
    expect(netWorthLines(62_000_00).slice(9)).toEqual(
      [10, 15, 20, 25, 30, 35, 40, 45, 50, 60].map((k) => k * 1000_00),
    );
  });

  it('names the highest new line crossed, only the first time', () => {
    expect(netWorthMilestone(hist(4200_00, 4800_00), 5300_00)).toBe(5000_00);
    expect(netWorthMilestone(hist(4200_00), 7100_00)).toBe(7000_00); // jumped two: the higher
    expect(netWorthMilestone(hist(5600_00, 4800_00), 5300_00)).toBeNull(); // been over £5k before
    expect(netWorthMilestone(hist(4200_00), 4900_00)).toBeNull();
  });

  it('calls out net worth turning positive', () => {
    expect(netWorthMilestone(hist(-2400_00, -300_00), 150_00)).toBe('positive');
  });

  it('needs some history to cross from', () => {
    expect(netWorthMilestone([], 5300_00)).toBeNull();
  });
});
