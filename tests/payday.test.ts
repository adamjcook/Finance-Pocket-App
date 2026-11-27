import { describe, expect, it } from 'vitest';
import {
  describePaydayRule,
  isPaydayFor,
  latestPaydayWindow,
  parsePaydayRule,
  paydayFor,
  paydayWindow,
  type PaydayRule,
} from '../worker/src/payday';
import { dayRange, myPaydayRule, paydaySummary } from '../src/logic/payday';
import { voidSnapshot } from '../src/model/repo';
import { account, settings, snapshot, state } from './helpers';

const MONZO: PaydayRule = { kind: 'before-last-working-day', arrives: 'afternoon' };
const THE_24TH: PaydayRule = { kind: 'date', day: 24, arrives: 'morning' };

describe('payday rules', () => {
  it('the working day before the last working day', () => {
    expect(paydayFor(MONZO, 2026, 11)).toBe('2026-11-27'); // last working day Mon 30th → Fri 27th
    expect(paydayFor(MONZO, 2026, 12)).toBe('2026-12-30');
    expect(paydayFor(MONZO, 2026, 8)).toBe('2026-08-27'); // Mon 31st is a bank holiday: Fri 28th → Thu 27th
    expect(paydayFor(MONZO, 2029, 3)).toBe('2029-03-28'); // Thu 29th (Good Friday follows) → Wed 28th
  });

  it('a date, or the working day before it', () => {
    expect(paydayFor(THE_24TH, 2026, 11)).toBe('2026-11-24'); // Tuesday
    expect(paydayFor(THE_24TH, 2027, 1)).toBe('2027-01-22'); // Sun 24th → Fri 22nd
    expect(paydayFor(THE_24TH, 2027, 7)).toBe('2027-07-23'); // Sat 24th → Fri 23rd
    expect(paydayFor({ kind: 'date', day: 31, arrives: 'morning' }, 2027, 2)).toBe('2027-02-26'); // no 31st: last working day
    expect(paydayFor({ kind: 'date', day: 25, arrives: 'morning' }, 2026, 12)).toBe('2026-12-24'); // Christmas Day
  });

  it('the last working day, and the last Friday', () => {
    expect(paydayFor({ kind: 'last-working-day', arrives: 'morning' }, 2026, 11)).toBe('2026-11-30');
    expect(paydayFor({ kind: 'last-friday', arrives: 'morning' }, 2026, 11)).toBe('2026-11-27');
    expect(paydayFor({ kind: 'last-friday', arrives: 'morning' }, 2027, 12)).toBe('2027-12-31');
    expect(paydayFor({ kind: 'last-friday', arrives: 'morning' }, 2029, 3)).toBe('2029-03-29'); // Good Friday 30th
  });

  it('isPaydayFor', () => {
    expect(isPaydayFor(MONZO, '2026-11-27')).toBe(true);
    expect(isPaydayFor(MONZO, '2026-11-30')).toBe(false);
    expect(isPaydayFor(THE_24TH, '2026-11-24')).toBe(true);
  });

  it('reads stored rules safely, with the default for anything else', () => {
    expect(parsePaydayRule(THE_24TH)).toEqual(THE_24TH);
    expect(parsePaydayRule(null)).toEqual(MONZO);
    expect(parsePaydayRule({ kind: 'date', day: 40 })).toEqual(MONZO);
    expect(parsePaydayRule({ kind: 'last-working-day' })).toEqual({ kind: 'last-working-day', arrives: 'afternoon' });
  });

  it('describes a rule for Settings', () => {
    expect(describePaydayRule(THE_24TH)).toBe('The 24th (or the working day before), first thing');
    expect(describePaydayRule(MONZO)).toBe('The working day before the last working day, from 4pm');
    expect(describePaydayRule({ kind: 'date', day: 1, arrives: 'morning' })).toMatch(/^The 1st/);
    expect(describePaydayRule({ kind: 'date', day: 22, arrives: 'morning' })).toMatch(/^The 22nd/);
  });
});

describe('the shared payday window', () => {
  it('runs from the earlier payday to the 2nd of the next month, or the next working day', () => {
    expect(paydayWindow([MONZO, THE_24TH], 2026, 11)).toEqual({ month: '2026-11', opens: '2026-11-24', closes: '2026-12-02' });
    expect(paydayWindow([MONZO, THE_24TH], 2027, 1)).toEqual({ month: '2027-01', opens: '2027-01-22', closes: '2027-02-02' });
    expect(paydayWindow([MONZO, MONZO], 2026, 11)).toEqual({ month: '2026-11', opens: '2026-11-27', closes: '2026-12-02' });
    expect(paydayWindow([MONZO], 2026, 12).closes).toBe('2027-01-04'); // Sat 2 Jan → Mon 4th
    expect(paydayWindow([MONZO], 2027, 9).closes).toBe('2027-10-04'); // Sat 2 Oct → Mon 4th
  });

  it('is last month’s until this month’s opens', () => {
    expect(latestPaydayWindow([MONZO, THE_24TH], '2026-11-23').month).toBe('2026-10');
    expect(latestPaydayWindow([MONZO, THE_24TH], '2026-11-24').month).toBe('2026-11');
    expect(latestPaydayWindow([MONZO, THE_24TH], '2027-01-05').month).toBe('2026-12');
  });
});

describe('payday summary', () => {
  // Card debt and savings at the start of November, before the window.
  const card = account({ id: 'card', name: 'Barclaycard', kind: 'credit_card' });
  const pot = account({ id: 'pot', name: 'Saver', kind: 'savings' });
  const update = (accountId: string, balance: number, at: string, deviceId = 'phone-a') =>
    snapshot({ accountId, balance, at, createdAt: at, deviceId });
  const base = (snapshots: ReturnType<typeof update>[]) =>
    state({
      accounts: [card, pot],
      settings: settings({ paydayA: MONZO, paydayB: THE_24TH }),
      snapshots: [update('card', 2000_00, '2026-11-02T12:00:00.000Z'), update('pot', 1000_00, '2026-11-02T12:00:00.000Z'), ...snapshots],
    });
  const at = (day: number, hour = 12) => new Date(2026, 10, day, hour);

  it('waits for the first update once the window opens', () => {
    const s = paydaySummary(base([]), at(24));
    expect(s.status).toBe('waiting');
    expect(s.window.opens).toBe('2026-11-24');
  });

  it('adds up every update either of you saves in the window, including several on one day', () => {
    const s0 = base([
      update('card', 1900_00, '2026-11-24T08:00:00.000Z', 'phone-b'), // the 24th, first thing
      update('pot', 1100_00, '2026-11-27T10:00:00.000Z', 'phone-a'), // the 27th, before 4pm
      update('pot', 1300_00, '2026-11-27T17:00:00.000Z', 'phone-a'), // the 27th, after the pay
    ]);
    const s = paydaySummary(s0, at(27, 18));
    expect(s.status).toBe('open');
    expect(s.checkIn!.cardChange).toBe(-100_00);
    expect(s.checkIn!.savingsChange).toBe(300_00);
    expect(s.checkIn!.netChange).toBe(400_00);
    expect(s.updateIds).toHaveLength(3);
  });

  it('stays as it was after the window closes, until the next one opens', () => {
    const s0 = base([
      update('card', 1900_00, '2026-11-24T12:00:00.000Z'),
      update('card', 1700_00, '2026-12-10T12:00:00.000Z'), // a mid-month update: not part of it
    ]);
    const s = paydaySummary(s0, at(1 + 30 + 9)); // 10 Dec
    expect(s.status).toBe('closed');
    expect(s.window.month).toBe('2026-11');
    expect(s.checkIn!.cardChange).toBe(-100_00);
    // December's window opens on Thu 24 Dec: time for a new one.
    expect(paydaySummary(s0, new Date(2026, 11, 24, 9)).status).toBe('waiting');
  });

  it('includes the bills on the 1st and 2nd', () => {
    const s0 = base([
      update('card', 1900_00, '2026-11-27T17:00:00.000Z'),
      update('pot', 900_00, '2026-12-02T09:00:00.000Z'), // the 2nd: a bill out of savings
      update('pot', 800_00, '2026-12-03T09:00:00.000Z'), // the 3rd: too late
    ]);
    const s = paydaySummary(s0, new Date(2026, 11, 2, 18));
    expect(s.status).toBe('open');
    expect(s.checkIn!.savingsChange).toBe(-100_00);
    const later = paydaySummary(s0, new Date(2026, 11, 3, 18));
    expect(later.status).toBe('closed');
    expect(later.checkIn!.savingsChange).toBe(-100_00);
  });

  it('counts a late update as the payday’s when nothing was saved during it', () => {
    const s0 = base([update('card', 1800_00, '2026-12-07T12:00:00.000Z')]);
    const s = paydaySummary(s0, new Date(2026, 11, 7, 18));
    expect(s.status).toBe('open');
    expect(s.closes).toBe('2026-12-07');
    expect(s.checkIn!.cardChange).toBe(-200_00);
    expect(paydaySummary(s0, new Date(2026, 11, 9, 12)).status).toBe('closed');
  });

  it('leaves out undone updates, automatic readings and new accounts’ opening balances', () => {
    const fresh = account({ id: 'isa', name: 'New ISA', kind: 'savings', createdAt: '2026-11-25T12:00:00.000Z' });
    let s0 = base([
      update('card', 1900_00, '2026-11-24T12:00:00.000Z'),
      update('pot', 5000_00, '2026-11-25T12:00:00.000Z'), // a slip, undone
      update('isa', 750_00, '2026-11-25T12:00:00.000Z'), // its opening balance
      snapshot({ accountId: 'pot', balance: 1050_00, at: '2026-11-26T21:00:00.000Z', deviceId: 't212' }),
    ]);
    s0 = { ...s0, accounts: [...s0.accounts, fresh] };
    s0 = voidSnapshot(s0, { deviceId: 'phone-a' }, s0.snapshots.find((x) => x.balance === 5000_00)!.id);
    const s = paydaySummary(s0, at(27));
    expect(s.updateIds).toHaveLength(1);
    expect(s.checkIn!.cardChange).toBe(-100_00);
    expect(s.checkIn!.savingsChange).toBe(0);
  });

  it('uses each phone’s owner for their own reminder', () => {
    const st = settings({ paydayA: MONZO, paydayB: THE_24TH });
    expect(myPaydayRule(st, 'B')).toEqual(THE_24TH);
    expect(myPaydayRule(st, 'A')).toEqual(MONZO);
    expect(myPaydayRule(settings(), 'B')).toEqual(MONZO);
  });

  it('formats the window’s days', () => {
    expect(dayRange('2026-11-24', '2026-11-30')).toBe('24–30 Nov');
    expect(dayRange('2026-11-27', '2026-12-02')).toBe('27 Nov – 2 Dec');
  });
});
