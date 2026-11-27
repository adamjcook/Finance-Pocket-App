/**
 * UK (England & Wales) working days, for payday: the working day before the
 * last working day of the month. Salaries land on the last working day, and
 * Monzo's "get paid early" pays them from 4pm the working day before, which
 * at a weekend can be the Friday before a Monday month-end (27 Nov 2026 for
 * Mon 30 Nov). The monthly "update your balances" reminder goes out then.
 *
 * Covers every regular bank holiday. The ones that can land at a month's end
 * are the late-May and August bank holidays (both the last Monday) and Good
 * Friday / Easter Monday (Good Friday can be 30 or 31 March). One-off
 * holidays (e.g. a coronation) aren't predictable, so aren't included.
 */

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const dow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Easter Sunday (Gregorian; anonymous/Meeus algorithm) as [month, day]. */
export function easterSunday(y: number): [number, number] {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

function shift(y: number, m: number, d: number, by: number): string {
  const t = new Date(Date.UTC(y, m - 1, d + by));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function firstMonday(y: number, m: number): number {
  return 1 + ((8 - dow(y, m, 1)) % 7);
}

function lastMonday(y: number, m: number): number {
  const last = daysInMonth(y, m);
  return last - ((dow(y, m, last) + 6) % 7);
}

/** England & Wales bank holidays for a year (YYYY-MM-DD). */
export function ukBankHolidays(y: number): Set<string> {
  const out = new Set<string>();
  // New Year's Day, moved to Monday if it falls at a weekend.
  const ny = dow(y, 1, 1);
  out.add(ny === 6 ? iso(y, 1, 3) : ny === 0 ? iso(y, 1, 2) : iso(y, 1, 1));
  const [em, ed] = easterSunday(y);
  out.add(shift(y, em, ed, -2)); // Good Friday
  out.add(shift(y, em, ed, 1)); // Easter Monday
  out.add(iso(y, 5, firstMonday(y, 5))); // Early May
  out.add(iso(y, 5, lastMonday(y, 5))); // Spring
  out.add(iso(y, 8, lastMonday(y, 8))); // Summer
  // Christmas and Boxing Day, with weekday substitutes.
  const xmas = dow(y, 12, 25);
  if (xmas === 6) out.add(iso(y, 12, 27)).add(iso(y, 12, 28)); // Sat: Mon + Tue
  else if (xmas === 0) out.add(iso(y, 12, 26)).add(iso(y, 12, 27)); // Sun: Mon (Boxing) + Tue
  else if (xmas === 5) out.add(iso(y, 12, 25)).add(iso(y, 12, 28)); // Fri: Boxing Day → Mon
  else out.add(iso(y, 12, 25)).add(iso(y, 12, 26));
  return out;
}

/** The last weekday of the month that isn't a bank holiday (YYYY-MM-DD). */
export function lastWorkingDay(y: number, m: number): string {
  const holidays = ukBankHolidays(y);
  for (let d = daysInMonth(y, m); d >= 1; d--) {
    const w = dow(y, m, d);
    if (w !== 0 && w !== 6 && !holidays.has(iso(y, m, d))) return iso(y, m, d);
  }
  throw new Error('no working day'); // unreachable
}

export function isLastWorkingDay(day: string): boolean {
  const [y, m] = day.split('-').map(Number);
  return lastWorkingDay(y, m) === day;
}

/** The UK hour pay arrives on payday (Monzo pays early from 4pm). */
export const PAYDAY_HOUR = 16;

/**
 * Payday (YYYY-MM-DD): the working day before the month's last working day.
 * Always in the same month, since the last working day is never before the 25th.
 */
export function paydayOf(y: number, m: number): string {
  const holidays = ukBankHolidays(y);
  const last = Number(lastWorkingDay(y, m).slice(8));
  for (let d = last - 1; d >= 1; d--) {
    const w = dow(y, m, d);
    if (w !== 0 && w !== 6 && !holidays.has(iso(y, m, d))) return iso(y, m, d);
  }
  throw new Error('no working day'); // unreachable
}

export function isPayday(day: string): boolean {
  const [y, m] = day.split('-').map(Number);
  return paydayOf(y, m) === day;
}
