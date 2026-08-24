import { describe, expect, it } from 'vitest';
import {
  combinedDailySeries,
  debtProgress,
  effectiveSnapshots,
  growthProgress,
  latestBalance,
  loanTotals,
  monthlyToTarget,
  monthsUntil,
} from '../src/logic/progress';
import { aliasSeries, latestBalances, repointAlias } from '../src/model/repo';
import { account, alias, settings, snapshot, state } from './helpers';
import { parseMoney, minorToInput, formatMoney } from '../src/logic/money';

describe('money', () => {
  it('parses user input to pence', () => {
    expect(parseMoney('1234.56')).toBe(123456);
    expect(parseMoney('1,234.56')).toBe(123456);
    expect(parseMoney('£1200')).toBe(120000);
    expect(parseMoney('-45.10')).toBe(-4510);
    expect(parseMoney('0.5')).toBe(50);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('1.234')).toBeNull();
  });

  it('round-trips input values', () => {
    expect(minorToInput(123456)).toBe('1234.56');
    expect(minorToInput(120000)).toBe('1200');
  });

  it('formats GBP', () => {
    expect(formatMoney(123456, 'GBP')).toBe('£1,234.56');
  });
});

describe('effectiveSnapshots / latestBalance', () => {
  it('drops voided snapshots and sorts by effective time', () => {
    const s1 = snapshot({ id: 'snap-1', accountId: 'acc-1', balance: 100_00, at: '2026-01-01T10:00:00.000Z' });
    const s2 = snapshot({ id: 'snap-2', accountId: 'acc-1', balance: 999_99, at: '2026-01-02T10:00:00.000Z' });
    const effective = effectiveSnapshots([s2, s1], [{ snapshotId: 'snap-2', at: s2.at, deviceId: 'd' }]);
    expect(effective.map((s) => s.id)).toEqual(['snap-1']);
    expect(latestBalance(effective, 'acc-1')).toBe(100_00);
  });
});

describe('combinedDailySeries', () => {
  it('carries balances forward per day and sums across accounts', () => {
    const snaps = effectiveSnapshots(
      [
        snapshot({ accountId: 'acc-1', balance: 100_00, at: '2026-01-01T09:00:00.000Z' }),
        snapshot({ accountId: 'acc-2', balance: 50_00, at: '2026-01-03T09:00:00.000Z' }),
        snapshot({ accountId: 'acc-1', balance: 80_00, at: '2026-01-04T09:00:00.000Z' }),
      ],
      [],
    );
    const series = combinedDailySeries(snaps, '2026-01-05');
    expect(series).toEqual([
      { day: '2026-01-01', value: 100_00 },
      { day: '2026-01-02', value: 100_00 },
      { day: '2026-01-03', value: 150_00 },
      { day: '2026-01-04', value: 130_00 },
      { day: '2026-01-05', value: 130_00 },
    ]);
  });

  it('uses the last reading when a day has several', () => {
    const snaps = effectiveSnapshots(
      [
        snapshot({ accountId: 'acc-1', balance: 100_00, at: '2026-01-01T09:00:00.000Z', createdAt: '2026-01-01T09:00:00.000Z' }),
        snapshot({ accountId: 'acc-1', balance: 90_00, at: '2026-01-01T18:00:00.000Z', createdAt: '2026-01-01T18:00:00.000Z' }),
      ],
      [],
    );
    expect(combinedDailySeries(snaps, '2026-01-01')).toEqual([{ day: '2026-01-01', value: 90_00 }]);
  });
});

describe('debtProgress', () => {
  const cardA = account({ id: 'card-a', kind: 'credit_card' });
  const cardB = account({ id: 'card-b', kind: 'credit_card' });
  const savings = account({ id: 'sav-1', kind: 'savings' });

  it('computes combined debt, peak baseline, and percent paid off', () => {
    const s = state({
      accounts: [cardA, cardB, savings],
      snapshots: [
        snapshot({ accountId: 'card-a', balance: 3000_00, at: '2026-01-01T00:00:00.000Z' }),
        snapshot({ accountId: 'card-b', balance: 2000_00, at: '2026-01-01T00:00:00.000Z' }),
        snapshot({ accountId: 'sav-1', balance: 9999_00, at: '2026-01-01T00:00:00.000Z' }),
        snapshot({ accountId: 'card-a', balance: 1500_00, at: '2026-02-01T00:00:00.000Z' }),
        snapshot({ accountId: 'card-b', balance: 1000_00, at: '2026-02-01T00:00:00.000Z' }),
      ],
    });
    const p = debtProgress(s, '2026-02-01');
    expect(p.current).toBe(2500_00);
    expect(p.baseline).toBe(5000_00); // peak, savings excluded
    expect(p.paidOff).toBe(2500_00);
    expect(p.pct).toBe(50);
  });

  it('honours a manual baseline override and archived accounts', () => {
    const s = state({
      accounts: [cardA, { ...cardB, archived: true }],
      settings: settings({ debtBaselineMinor: 10000_00 }),
      snapshots: [
        snapshot({ accountId: 'card-a', balance: 2500_00, at: '2026-02-01T00:00:00.000Z' }),
        snapshot({ accountId: 'card-b', balance: 9000_00, at: '2026-02-01T00:00:00.000Z' }),
      ],
    });
    const p = debtProgress(s, '2026-02-01');
    expect(p.current).toBe(2500_00); // archived card excluded
    expect(p.baseline).toBe(10000_00);
    expect(p.pct).toBe(75);
  });
});

describe('growthProgress', () => {
  it('sums savings + investments and reports 30-day delta', () => {
    const s = state({
      accounts: [
        account({ id: 'sav-1', kind: 'savings' }),
        account({ id: 'inv-1', kind: 'investment' }),
        account({ id: 'cur-1', kind: 'checking' }),
      ],
      snapshots: [
        snapshot({ accountId: 'sav-1', balance: 1000_00, at: '2026-01-01T00:00:00.000Z' }),
        snapshot({ accountId: 'inv-1', balance: 500_00, at: '2026-01-01T00:00:00.000Z' }),
        snapshot({ accountId: 'cur-1', balance: 77777_00, at: '2026-01-01T00:00:00.000Z' }),
        snapshot({ accountId: 'sav-1', balance: 1600_00, at: '2026-03-01T00:00:00.000Z' }),
      ],
    });
    const p = growthProgress(s, '2026-03-01');
    expect(p.current).toBe(2100_00); // checking excluded
    expect(p.first).toBe(1500_00);
    expect(p.growth).toBe(600_00);
    expect(p.delta30).toBe(600_00);
  });
});

describe('loans stay separate from the card goal', () => {
  it('excludes loans from debtProgress and reports them via loanTotals', () => {
    const s = state({
      accounts: [
        account({ id: 'card-1', kind: 'credit_card' }),
        account({ id: 'loan-1', kind: 'loan' }),
      ],
      snapshots: [
        snapshot({ accountId: 'card-1', balance: 1000_00, at: '2026-01-01T00:00:00.000Z' }),
        snapshot({ accountId: 'loan-1', balance: 9000_00, at: '2026-01-01T00:00:00.000Z' }),
      ],
    });
    expect(debtProgress(s, '2026-01-01').current).toBe(1000_00);
    expect(loanTotals(s, '2026-01-01').current).toBe(9000_00);
    expect(growthProgress(s, '2026-01-01').current).toBe(0);
  });
});

describe('goal maths', () => {
  it('computes fractional months until a date', () => {
    expect(monthsUntil('2026-01-01', '2026-01-01')).toBe(0);
    expect(monthsUntil('2026-01-01', '2026-12-31')).toBeCloseTo(364 / 30.4375, 5);
    expect(monthsUntil('2026-01-02', '2026-01-01')).toBeLessThan(0);
  });

  it('estimates the monthly amount to clear debt by a date', () => {
    // £3,000 to clear in ~6 months
    const monthly = monthlyToTarget(3000_00, 0, 'down', '2026-07-01', '2026-01-01');
    expect(monthly).not.toBeNull();
    expect(monthly!).toBeGreaterThan(490_00);
    expect(monthly!).toBeLessThan(520_00);
  });

  it('estimates the monthly amount to reach a savings target', () => {
    const monthly = monthlyToTarget(2000_00, 8000_00, 'up', '2027-01-01', '2026-01-01');
    expect(monthly).not.toBeNull();
    expect(monthly!).toBeGreaterThan(490_00);
    expect(monthly!).toBeLessThan(510_00);
  });

  it('returns null with no date, a passed date, or a met target', () => {
    expect(monthlyToTarget(3000_00, 0, 'down', null, '2026-01-01')).toBeNull();
    expect(monthlyToTarget(3000_00, 0, 'down', undefined, '2026-01-01')).toBeNull();
    expect(monthlyToTarget(3000_00, 0, 'down', '2025-12-01', '2026-01-01')).toBeNull();
    expect(monthlyToTarget(0, 0, 'down', '2026-07-01', '2026-01-01')).toBeNull();
    expect(monthlyToTarget(9000_00, 8000_00, 'up', '2026-07-01', '2026-01-01')).toBeNull(); // exceeded
  });
});

describe('alias continuity', () => {
  it('stitches series across a repoint with no reset', () => {
    const oldBank = account({ id: 'acc-old', kind: 'savings' });
    const newBank = account({ id: 'acc-new', kind: 'savings' });
    let s = state({
      accounts: [oldBank, newBank],
      aliases: [
        alias({
          id: 'alias-1',
          accountId: 'acc-old',
          history: [{ accountId: 'acc-old', from: '2026-01-01T00:00:00.000Z' }],
        }),
      ],
      snapshots: [
        snapshot({ accountId: 'acc-old', balance: 1000_00, at: '2026-01-01T00:00:00.000Z' }),
        snapshot({ accountId: 'acc-old', balance: 1200_00, at: '2026-01-10T00:00:00.000Z' }),
      ],
    });
    // switch banks on Jan 15: move the money to the new account
    s = repointAlias(s, { deviceId: 'device-a', now: '2026-01-15T00:00:00.000Z' }, 'alias-1', 'acc-new');
    s = {
      ...s,
      snapshots: [
        ...s.snapshots,
        snapshot({ accountId: 'acc-new', balance: 1250_00, at: '2026-01-15T08:00:00.000Z' }),
        // stale reading on the old account after the switch must NOT count
        snapshot({ accountId: 'acc-old', balance: 0, at: '2026-01-16T00:00:00.000Z' }),
      ],
    };
    const series = aliasSeries(s, s.aliases[0], '2026-01-16');
    const byDay = Object.fromEntries(series.map((p) => [p.day, p.value]));
    expect(byDay['2026-01-01']).toBe(1000_00);
    expect(byDay['2026-01-14']).toBe(1200_00); // old bank carried forward
    expect(byDay['2026-01-15']).toBe(1250_00); // new bank continues the line
    expect(byDay['2026-01-16']).toBe(1250_00); // old account's post-switch reading ignored
    expect(series[0].day).toBe('2026-01-01');
  });

  it('latestBalances maps each account to its newest reading', () => {
    const s = state({
      snapshots: [
        snapshot({ accountId: 'acc-1', balance: 10_00, at: '2026-01-01T00:00:00.000Z' }),
        snapshot({ accountId: 'acc-1', balance: 20_00, at: '2026-01-02T00:00:00.000Z' }),
      ],
    });
    expect(latestBalances(s).get('acc-1')?.balance).toBe(20_00);
  });
});
