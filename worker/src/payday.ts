/**
 * Paydays. Each partner has their own payday rule (shared in Settings, so
 * both phones agree), and the month's payday update runs as one shared
 * window: from the earlier of the two paydays to the end of the 2nd of the
 * next month (or the next working day after it), so the bills that go out on
 * the 1st and 2nd are part of it. Used by the app (Home's payday summary) and by the Worker
 * (each phone's payday reminder).
 */

import { isoDay, isWorkingDay, lastWorkingDay } from './ukdates';

export type PaydayRule =
  /** The working day before the last working day (e.g. Monzo paying early). */
  | { kind: 'before-last-working-day'; arrives: PayArrives }
  | { kind: 'last-working-day'; arrives: PayArrives }
  /** A date of the month, or the working day before it when it isn't one. */
  | { kind: 'date'; day: number; arrives: PayArrives }
  | { kind: 'last-friday'; arrives: PayArrives };

/** When the pay lands: first thing, or from 4pm (Monzo's early pay). */
export type PayArrives = 'morning' | 'afternoon';

/** Payday for phones and partners that haven't chosen one. */
export const DEFAULT_PAYDAY_RULE: PaydayRule = { kind: 'before-last-working-day', arrives: 'afternoon' };

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The working day on or before day `d` of the month. */
function workingDayOnOrBefore(y: number, m: number, d: number): string {
  for (let day = Math.min(d, daysInMonth(y, m)); day >= 1; day--) {
    if (isWorkingDay(y, m, day)) return isoDay(y, m, day);
  }
  // Never happens for a real month; fall back to the previous month's last.
  return m === 1 ? lastWorkingDay(y - 1, 12) : lastWorkingDay(y, m - 1);
}

/** The working day on or after day `d` of the month (into the next month if need be). */
function workingDayOnOrAfter(y: number, m: number, d: number): string {
  for (let i = 0; ; i++) {
    const t = new Date(Date.UTC(y, m - 1, d + i));
    const [ty, tm, td] = [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
    if (isWorkingDay(ty, tm, td)) return isoDay(ty, tm, td);
  }
}

/** The payday (YYYY-MM-DD) a rule gives in a month. */
export function paydayFor(rule: PaydayRule, y: number, m: number): string {
  switch (rule.kind) {
    case 'last-working-day':
      return lastWorkingDay(y, m);
    case 'before-last-working-day':
      return workingDayOnOrBefore(y, m, Number(lastWorkingDay(y, m).slice(8)) - 1);
    case 'date':
      return workingDayOnOrBefore(y, m, rule.day);
    case 'last-friday': {
      const last = daysInMonth(y, m);
      const friday = last - ((new Date(Date.UTC(y, m - 1, last)).getUTCDay() + 2) % 7);
      return workingDayOnOrBefore(y, m, friday);
    }
  }
}

export function isPaydayFor(rule: PaydayRule, day: string): boolean {
  const [y, m] = day.split('-').map(Number);
  return paydayFor(rule, y, m) === day;
}

/** A rule as stored or posted, checked; anything unreadable is the default. */
export function parsePaydayRule(raw: unknown): PaydayRule {
  const r = raw as Partial<PaydayRule> | null;
  const arrives: PayArrives = r?.arrives === 'morning' ? 'morning' : 'afternoon';
  switch (r?.kind) {
    case 'before-last-working-day':
    case 'last-working-day':
    case 'last-friday':
      return { kind: r.kind, arrives };
    case 'date': {
      const day = Number((r as { day?: unknown }).day);
      return Number.isInteger(day) && day >= 1 && day <= 31 ? { kind: 'date', day, arrives } : DEFAULT_PAYDAY_RULE;
    }
    default:
      return DEFAULT_PAYDAY_RULE;
  }
}

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
};

/** "The working day on or before the 24th, first thing", for Settings. */
export function describePaydayRule(rule: PaydayRule): string {
  const when =
    rule.kind === 'before-last-working-day'
      ? 'The working day before the last working day'
      : rule.kind === 'last-working-day'
        ? 'The last working day'
        : rule.kind === 'last-friday'
          ? 'The last Friday (or the working day before)'
          : `The ${ordinal(rule.day)} (or the working day before)`;
  return `${when}, ${rule.arrives === 'morning' ? 'first thing' : 'from 4pm'}`;
}

/** The month's shared payday window (YYYY-MM-DD days, both inclusive). */
export interface PaydayWindow {
  /** YYYY-MM of the month it belongs to. */
  month: string;
  /** The earliest of the paydays. */
  opens: string;
  /** The 2nd of the next month, or the working day after it: bills out on the 1st and 2nd count. */
  closes: string;
}

export function paydayWindow(rules: PaydayRule[], y: number, m: number): PaydayWindow {
  const days = rules.map((r) => paydayFor(r, y, m)).sort();
  return {
    month: `${y}-${String(m).padStart(2, '0')}`,
    opens: days[0] ?? lastWorkingDay(y, m),
    closes: m === 12 ? workingDayOnOrAfter(y + 1, 1, 2) : workingDayOnOrAfter(y, m + 1, 2),
  };
}

/** The most recent window that has opened by `today` (this month's, or last month's). */
export function latestPaydayWindow(rules: PaydayRule[], today: string): PaydayWindow {
  const [y, m] = today.split('-').map(Number);
  const now = paydayWindow(rules, y, m);
  if (today >= now.opens) return now;
  return m === 1 ? paydayWindow(rules, y - 1, 12) : paydayWindow(rules, y, m - 1);
}
