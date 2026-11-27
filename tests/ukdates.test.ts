import { describe, expect, it } from 'vitest';
import { easterSunday, isLastWorkingDay, isPayday, lastWorkingDay, paydayOf, ukBankHolidays } from '../worker/src/ukdates';
import { latestPayday } from '../src/logic/progress';

describe('UK working days', () => {
  it('computes Easter correctly', () => {
    expect(easterSunday(2025)).toEqual([4, 20]);
    expect(easterSunday(2026)).toEqual([4, 5]);
    expect(easterSunday(2027)).toEqual([3, 28]);
    expect(easterSunday(2029)).toEqual([4, 1]);
  });

  it('matches the published 2026 England & Wales bank holidays', () => {
    expect([...ukBankHolidays(2026)].sort()).toEqual([
      '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25',
      '2026-08-31', '2026-12-25', '2026-12-28',
    ]);
  });

  it('applies weekend substitutes for New Year and Christmas', () => {
    expect(ukBankHolidays(2022)).toContain('2022-01-03'); // 1 Jan 2022 was a Saturday
    expect(ukBankHolidays(2022)).toContain('2022-12-26');
    expect(ukBankHolidays(2022)).toContain('2022-12-27'); // Christmas on a Sunday
    expect(ukBankHolidays(2027)).toContain('2027-12-27'); // Christmas on a Saturday
    expect(ukBankHolidays(2027)).toContain('2027-12-28');
  });

  it('picks the last weekday of the month', () => {
    expect(lastWorkingDay(2026, 11)).toBe('2026-11-30'); // Monday
    expect(lastWorkingDay(2026, 1)).toBe('2026-01-30'); // 31st is a Saturday
    expect(lastWorkingDay(2026, 5)).toBe('2026-05-29'); // 31st is a Sunday
    expect(lastWorkingDay(2026, 12)).toBe('2026-12-31'); // Thursday
  });

  it('skips month-end bank holidays', () => {
    expect(lastWorkingDay(2026, 8)).toBe('2026-08-28'); // Mon 31 Aug is the summer bank holiday
    expect(lastWorkingDay(2027, 5)).toBe('2027-05-28'); // Mon 31 May is the spring bank holiday
    expect(lastWorkingDay(2029, 3)).toBe('2029-03-29'); // Fri 30 Mar is Good Friday, 31st a Saturday
  });

  it('isLastWorkingDay', () => {
    expect(isLastWorkingDay('2026-08-28')).toBe(true);
    expect(isLastWorkingDay('2026-08-31')).toBe(false);
    expect(isLastWorkingDay('2026-12-01')).toBe(false);
  });

  it('puts payday on the working day before the last working day', () => {
    expect(paydayOf(2026, 11)).toBe('2026-11-27'); // last working day Mon 30th → Fri 27th
    expect(paydayOf(2026, 12)).toBe('2026-12-30'); // Thu 31st → Wed 30th
    expect(paydayOf(2026, 1)).toBe('2026-01-29'); // Fri 30th → Thu 29th
    expect(paydayOf(2026, 8)).toBe('2026-08-27'); // Mon 31st is a bank holiday, so Fri 28th → Thu 27th
    expect(paydayOf(2026, 6)).toBe('2026-06-29'); // Tue 30th → Mon 29th
    expect(paydayOf(2027, 3)).toBe('2027-03-30'); // Wed 31st → Tue 30th
    expect(paydayOf(2029, 3)).toBe('2029-03-28'); // Thu 29th (Good Friday next) → Wed 28th
    expect(paydayOf(2027, 5)).toBe('2027-05-27'); // Fri 28th → Thu 27th
    expect(paydayOf(2025, 6)).toBe('2025-06-27'); // Mon 30th → Fri 27th
  });

  it('isPayday', () => {
    expect(isPayday('2026-11-27')).toBe(true);
    expect(isPayday('2026-11-30')).toBe(false);
  });

  it('latest payday only counts once pay is in at 4pm', () => {
    expect(latestPayday('2026-11-27', 15, paydayOf, 16)).toBe('2026-10-29'); // Fri 30 Oct last working day
    expect(latestPayday('2026-11-27', 16, paydayOf, 16)).toBe('2026-11-27');
    expect(latestPayday('2026-11-30', 9, paydayOf, 16)).toBe('2026-11-27');
    expect(latestPayday('2026-11-26', 20, paydayOf, 16)).toBe('2026-10-29');
    expect(latestPayday('2027-01-10', 9, paydayOf, 16)).toBe('2026-12-30');
  });
});
