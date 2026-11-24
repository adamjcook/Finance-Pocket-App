import type { AccountKind, Snapshot, SnapshotVoid, SyncedState } from '../model/types';
import { DEBT_KINDS, GROWTH_KINDS, LOAN_KINDS } from '../model/types';

export interface SeriesPoint {
  day: string; // YYYY-MM-DD (UTC)
  value: number; // minor units
}

export function toDay(iso: string): string {
  return iso.slice(0, 10);
}

export function todayISO(): string {
  return new Date().toISOString();
}

/** A day (YYYY-MM-DD) as a friendly label, e.g. "25 Feb 2026". */
export function formatDay(day: string): string {
  return new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
}

/** Balances older than this get flagged as possibly out of date. */
export const STALE_AFTER_DAYS = 31;

function addDays(day: string, n: number): string {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Drop voided snapshots and sort by effective time (ties by createdAt then id). */
export function effectiveSnapshots(snapshots: Snapshot[], voids: SnapshotVoid[]): Snapshot[] {
  const voided = new Set(voids.map((v) => v.snapshotId));
  return snapshots
    .filter((s) => !voided.has(s.id))
    .sort(
      (a, b) =>
        a.at.localeCompare(b.at) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
}

/**
 * Daily carry-forward series for a set of snapshots treated as one combined pot.
 * Each account contributes its last-known balance each day (0 before its first
 * snapshot); the result is the per-day sum from the first snapshot to `today`.
 */
export function combinedDailySeries(effective: Snapshot[], today: string): SeriesPoint[] {
  if (effective.length === 0) return [];
  // Last reading per account per day
  const perAccountDay = new Map<string, Map<string, number>>();
  let firstDay = toDay(effective[0].at);
  for (const s of effective) {
    const day = toDay(s.at);
    if (day < firstDay) firstDay = day;
    let m = perAccountDay.get(s.accountId);
    if (!m) perAccountDay.set(s.accountId, (m = new Map()));
    m.set(day, s.balance); // effective order means later readings overwrite
  }
  const lastDay = today >= firstDay ? today : firstDay;
  const series: SeriesPoint[] = [];
  const carry = new Map<string, number>();
  for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) {
    for (const [accountId, days] of perAccountDay) {
      const v = days.get(day);
      if (v !== undefined) carry.set(accountId, v);
    }
    let sum = 0;
    for (const v of carry.values()) sum += v;
    series.push({ day, value: sum });
  }
  return series;
}

export interface KindTotals {
  current: number;
  series: SeriesPoint[];
  effective: Snapshot[];
}

/**
 * Combined current balance + daily series for the accounts of some kinds.
 * An archived account counts up to the moment it was archived and as zero
 * from then on (a synthetic closing reading), so archiving a paid-off card
 * or a bank account you've moved away from doesn't rewrite past totals.
 */
export function kindTotals(state: SyncedState, kinds: AccountKind[], today: string): KindTotals {
  // accountId -> archive time, or null while active
  const cutoff = new Map<string, string | null>();
  for (const a of state.accounts) {
    if (kinds.includes(a.kind)) cutoff.set(a.id, a.archived ? (a.archivedAt ?? a.updatedAt) : null);
  }
  const counted = effectiveSnapshots(state.snapshots, state.voids).filter((s) => {
    if (!cutoff.has(s.accountId)) return false;
    const until = cutoff.get(s.accountId);
    return until == null || s.at < until;
  });
  const closings: Snapshot[] = [];
  for (const [accountId, until] of cutoff) {
    if (until != null && counted.some((s) => s.accountId === accountId)) {
      closings.push({ id: `closed:${accountId}`, accountId, balance: 0, at: until, deviceId: '', createdAt: until });
    }
  }
  const effective = effectiveSnapshots([...counted, ...closings], []);
  const series = combinedDailySeries(effective, today);
  const current = series.length ? series[series.length - 1].value : 0;
  return { current, series, effective };
}

/**
 * Highest combined total at any snapshot moment (not collapsed to days), so a
 * card added and paid down on the same day still counts its true peak.
 */
export function peakCombined(effective: Snapshot[]): number {
  const carry = new Map<string, number>();
  let peak = 0;
  for (const s of effective) {
    carry.set(s.accountId, s.balance);
    let sum = 0;
    for (const v of carry.values()) sum += v;
    if (sum > peak) peak = sum;
  }
  return peak;
}

/** Change over the last 30 days of a daily series ending at `current`. */
function change30(series: SeriesPoint[], current: number, today: string): number {
  if (!series.length) return 0;
  const monthAgo = addDays(today, -30);
  let past = series[0].value;
  for (const p of series) {
    if (p.day <= monthAgo) past = p.value;
    else break;
  }
  return current - past;
}

export interface DebtProgress {
  current: number;
  delta30: number; // change over the last 30 days (negative = paid down)
  baseline: number; // 0 when no data
  paidOff: number; // baseline - current, floored at 0
  pct: number; // 0..100
  series: SeriesPoint[];
}

/** Combined credit-card debt progress across both partners. */
export function debtProgress(state: SyncedState, today: string): DebtProgress {
  const { current, series, effective } = kindTotals(state, DEBT_KINDS, today);
  const baseline = state.settings.debtBaselineMinor ?? peakCombined(effective);
  const paidOff = Math.max(0, baseline - current);
  const pct = baseline > 0 ? Math.min(100, Math.max(0, (paidOff / baseline) * 100)) : 0;
  return { current, delta30: change30(series, current, today), baseline, paidOff, pct, series };
}

export interface GrowthProgress {
  current: number;
  delta30: number; // change over the last 30 days
  series: SeriesPoint[];
}

/** Combined savings + investments progress. */
export function growthProgress(state: SyncedState, today: string): GrowthProgress {
  const { current, series } = kindTotals(state, GROWTH_KINDS, today);
  return { current, delta30: change30(series, current, today), series };
}

/**
 * Combined outstanding loans (kept separate from the card payoff), with
 * progress measured like the cards': how much of the highest combined loan
 * balance on record has been paid off.
 */
export function loanProgress(state: SyncedState, today: string): DebtProgress {
  const { current, series, effective } = kindTotals(state, LOAN_KINDS, today);
  const baseline = peakCombined(effective);
  const paidOff = Math.max(0, baseline - current);
  const pct = baseline > 0 ? Math.min(100, Math.max(0, (paidOff / baseline) * 100)) : 0;
  return { current, delta30: change30(series, current, today), baseline, paidOff, pct, series };
}

/** Average Gregorian month, in days. */
const DAYS_PER_MONTH = 30.4375;

/**
 * Fractional months from `today` to `targetDate` (both YYYY-MM-DD).
 * Zero or negative when the date is today or has passed.
 */
export function monthsUntil(today: string, targetDate: string): number {
  const ms = new Date(targetDate + 'T00:00:00Z').getTime() - new Date(today + 'T00:00:00Z').getTime();
  return ms / 86400000 / DAYS_PER_MONTH;
}

/**
 * Minor units per month needed to move from `current` to `target` by
 * `targetDate`. Direction is explicit so an exceeded goal reads as met:
 * 'down' for paydown goals (debt to 0), 'up' for savings goals.
 * Null when there's no date, the date has passed, or the target is met.
 */
export function monthlyToTarget(
  current: number,
  target: number,
  direction: 'down' | 'up',
  targetDate: string | null | undefined,
  today: string,
): number | null {
  if (!targetDate) return null;
  const met = direction === 'down' ? current <= target : current >= target;
  if (met) return null;
  const months = monthsUntil(today, targetDate);
  if (months <= 0) return null;
  return Math.ceil(Math.abs(target - current) / months);
}

/**
 * The most recent payday on or before `today`: the last working day of this
 * month once it has arrived, otherwise last month's.
 */
export function latestPayday(today: string, lastWorkingDay: (y: number, m: number) => string): string {
  const [y, m] = today.split('-').map(Number);
  const thisMonth = lastWorkingDay(y, m);
  if (today >= thisMonth) return thisMonth;
  return m === 1 ? lastWorkingDay(y - 1, 12) : lastWorkingDay(y, m - 1);
}

/** Day (YYYY-MM-DD) of the latest balance typed in by hand, or null if none. */
export function lastManualUpdate(state: SyncedState): string | null {
  let last: string | null = null;
  for (const s of effectiveSnapshots(state.snapshots, state.voids)) {
    if (s.deviceId === 't212') continue; // the daily automatic readings
    const day = toDay(s.at);
    if (last === null || day > last) last = day;
  }
  return last;
}
