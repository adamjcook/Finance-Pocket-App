import type { Snapshot, SnapshotVoid, SyncedState } from '../model/types';
import { DEBT_KINDS, GROWTH_KINDS } from '../model/types';

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

/** Latest effective balance of one account, or null if it has no snapshots. */
export function latestBalance(effective: Snapshot[], accountId: string): number | null {
  for (let i = effective.length - 1; i >= 0; i--) {
    if (effective[i].accountId === accountId) return effective[i].balance;
  }
  return null;
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

export interface DebtProgress {
  current: number;
  baseline: number; // 0 when no data
  paidOff: number; // baseline - current, floored at 0
  pct: number; // 0..100
  series: SeriesPoint[];
}

/** Combined credit-card debt progress across both partners. */
export function debtProgress(state: SyncedState, today: string): DebtProgress {
  const accounts = state.accounts.filter((a) => !a.archived && DEBT_KINDS.includes(a.kind));
  const ids = new Set(accounts.map((a) => a.id));
  const effective = effectiveSnapshots(state.snapshots, state.voids).filter((s) =>
    ids.has(s.accountId),
  );
  const series = combinedDailySeries(effective, today);
  const current = series.length ? series[series.length - 1].value : 0;
  const baseline = state.settings.debtBaselineMinor ?? peakCombined(effective);
  const paidOff = Math.max(0, baseline - current);
  const pct = baseline > 0 ? Math.min(100, Math.max(0, (paidOff / baseline) * 100)) : 0;
  return { current, baseline, paidOff, pct, series };
}

export interface GrowthProgress {
  current: number;
  first: number;
  growth: number; // current - first
  delta30: number; // change over the last 30 days
  series: SeriesPoint[];
}

/** Combined savings + investments progress. */
export function growthProgress(state: SyncedState, today: string): GrowthProgress {
  const accounts = state.accounts.filter((a) => !a.archived && GROWTH_KINDS.includes(a.kind));
  const ids = new Set(accounts.map((a) => a.id));
  const effective = effectiveSnapshots(state.snapshots, state.voids).filter((s) =>
    ids.has(s.accountId),
  );
  const series = combinedDailySeries(effective, today);
  const current = series.length ? series[series.length - 1].value : 0;
  const first = series.length ? series[0].value : 0;
  const monthAgo = addDays(today, -30);
  let past = first;
  for (const p of series) {
    if (p.day <= monthAgo) past = p.value;
    else break;
  }
  const delta30 = series.length ? current - past : 0;
  return { current, first, growth: current - first, delta30, series };
}
