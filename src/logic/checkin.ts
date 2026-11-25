import type { SyncedState, UUID } from '../model/types';
import { GROWTH_KINDS, JUNIOR_KINDS, OWED_KINDS, PENSION_KINDS, POT_KINDS } from '../model/types';
import { latestBalances } from '../model/repo';
import {
  debtProgress,
  growthProgress,
  juniorProgress,
  loanProgress,
  netWorthMilestone,
  netWorthSeries,
  pensionProgress,
} from './progress';
import { formatMoneyWhole } from './money';

/**
 * What one payday update changed, for the "here's how you did" card on Home.
 * Pure: compares the state just before the save with the state just after.
 */
export interface CheckIn {
  /** When the update was saved (ISO); also identifies its snapshots for Undo. */
  at: string;
  snapshotIds: UUID[];
  /** after − before, in minor units. Negative debt change = paid down. */
  cardChange: number;
  loanChange: number;
  savingsChange: number;
  /** Net worth after − before (savings up, debts down both count). */
  netChange: number;
  /** Pensions and children's accounts: their own lines, never in net worth. */
  pensionChange: number;
  juniorChange: number;
  /** What to call them: "Pension"/"Pensions"; the Junior ISA's own name, or "Junior ISAs". */
  labels: { pension: string; junior: string };
  /** Which of those totals this couple actually tracks (so we don't say "£0"). */
  has: { cards: boolean; loans: boolean; savings: boolean; pension: boolean; junior: boolean };
  /** Moments worth naming, most important first. */
  milestones: string[];
  /**
   * Milestones for the pension or a child's ISA. Shown too, after the
   * couple's own, but they don't decide whether the month was "nicely done".
   */
  heldMilestones: string[];
}

export function summariseCheckIn(
  before: SyncedState,
  after: SyncedState,
  at: string,
  snapshotIds: UUID[],
  today: string,
): CheckIn {
  const debtBefore = debtProgress(before, today);
  const debtAfter = debtProgress(after, today);
  const loansBefore = loanProgress(before, today);
  const loansAfter = loanProgress(after, today);
  const savingsBefore = growthProgress(before, today);
  const savingsAfter = growthProgress(after, today);
  const pensionBefore = pensionProgress(before, today);
  const pensionAfter = pensionProgress(after, today);
  const juniorBefore = juniorProgress(before, today);
  const juniorAfter = juniorProgress(after, today);
  const labels = heldLabels(after);

  const milestones: string[] = [];
  const heldMilestones: string[] = [];
  const hadCardDebt = debtBefore.series.length > 0;

  // All the card debt gone is the big one; otherwise a new lowest total.
  if (hadCardDebt && debtBefore.current > 0 && debtAfter.current <= 0) {
    milestones.push('All card debt cleared');
  } else if (hadCardDebt && debtAfter.current < debtBefore.current) {
    const lowestBefore = Math.min(...debtBefore.series.map((p) => p.value));
    if (debtAfter.current < lowestBefore) milestones.push('Lowest card debt yet');
  }

  // Net worth past a round number (or above zero) for the first time. It
  // leads, after only "All card debt cleared" — that's the first goal.
  const netAfter = savingsAfter.current - debtAfter.current - loansAfter.current;
  const net = netWorthMilestone(netWorthSeries(before, today), netAfter);
  const netText =
    net === 'positive'
      ? 'Net worth above zero for the first time'
      : net !== null
        ? `Net worth over ${formatMoneyWhole(net, after.settings.currency)} for the first time`
        : null;
  if (netText) milestones.splice(milestones[0] === 'All card debt cleared' ? 1 : 0, 0, netText);

  // Individual cards and loans reaching zero, and savings pots reaching their goal.
  const prev = latestBalances(before);
  const next = latestBalances(after);
  for (const a of after.accounts) {
    if (a.archived) continue;
    const was = prev.get(a.id)?.balance;
    const now = next.get(a.id)?.balance;
    if (was === undefined || now === undefined || was === now) continue;
    if (OWED_KINDS.includes(a.kind) && was > 0 && now <= 0) {
      milestones.push(`${a.name} paid off`);
    }
    const goal = a.goalMinor ?? 0;
    if (POT_KINDS.includes(a.kind) && goal > 0 && was < goal && now >= goal) {
      (GROWTH_KINDS.includes(a.kind) ? milestones : heldMilestones).push(`${a.name} reached its goal`);
    }
  }

  // The pension or the Junior ISA past a round number for the first time
  // (the same lines as net worth's: £1k steps to £10k, then £5k, then £10k).
  const currency = after.settings.currency;
  for (const [label, was, now] of [
    [labels.pension, pensionBefore, pensionAfter],
    [labels.junior, juniorBefore, juniorAfter],
  ] as const) {
    const line = netWorthMilestone(was.series, now.current);
    if (typeof line === 'number') heldMilestones.push(`${label} over ${formatMoneyWhole(line, currency)} for the first time`);
  }

  return {
    at,
    snapshotIds,
    cardChange: debtAfter.current - debtBefore.current,
    loanChange: loansAfter.current - loansBefore.current,
    savingsChange: savingsAfter.current - savingsBefore.current,
    netChange:
      savingsAfter.current -
      savingsBefore.current -
      (debtAfter.current - debtBefore.current) -
      (loansAfter.current - loansBefore.current),
    pensionChange: pensionAfter.current - pensionBefore.current,
    juniorChange: juniorAfter.current - juniorBefore.current,
    labels,
    has: {
      cards: debtAfter.series.length > 0,
      loans: loansAfter.series.length > 0,
      savings: savingsAfter.series.length > 0,
      pension: pensionAfter.series.length > 0,
      junior: juniorAfter.series.length > 0,
    },
    milestones,
    heldMilestones,
  };
}

/**
 * A new balance worth a gentle double-check before saving: at least three
 * times bigger or smaller than the last one and more than £100 apart, which
 * is what a slipped decimal point or an extra zero looks like.
 */
export function looksLikeATypo(was: number | null, now: number | null): boolean {
  if (was === null || now === null || was <= 0 || now <= 0) return false;
  const ratio = Math.max(was, now) / Math.min(was, now);
  return ratio >= 3 && Math.abs(now - was) > 100_00;
}

/**
 * One payday update as recorded in the shared history: every balance saved
 * together, at one moment, on one phone. Worked out from the synced
 * snapshots, so both phones see the same update — and it survives the app
 * being closed.
 */
export interface UpdateBatch {
  /** Stable id: the saving phone and the moment it saved. */
  key: string;
  at: string;
  deviceId: string;
  by: 'A' | 'B' | null;
  ids: UUID[];
  /** Every balance in it has since been undone. */
  voided: boolean;
}

/** The most recent update typed in by hand (automatic readings aren't updates). */
export function latestUpdateBatch(state: SyncedState): UpdateBatch | null {
  // An account's opening balance is saved at the very moment it's created:
  // adding a card isn't a payday update.
  const opened = new Map(state.accounts.map((a) => [a.id, a.createdAt]));
  const isUpdate = (s: SyncedState['snapshots'][number]) =>
    s.deviceId !== 't212' && s.createdAt === s.at && opened.get(s.accountId) !== s.at;
  let latest: { createdAt: string; deviceId: string } | null = null;
  for (const s of state.snapshots) {
    if (!isUpdate(s)) continue;
    if (!latest || s.createdAt > latest.createdAt) latest = { createdAt: s.createdAt, deviceId: s.deviceId };
  }
  if (!latest) return null;
  const batch = state.snapshots.filter(
    (s) => isUpdate(s) && s.createdAt === latest!.createdAt && s.deviceId === latest!.deviceId,
  );
  const voided = new Set(state.voids.map((v) => v.snapshotId));
  return {
    key: `${latest.deviceId}:${latest.createdAt}`,
    at: latest.createdAt,
    deviceId: latest.deviceId,
    by: batch.find((s) => s.by)?.by ?? null,
    ids: batch.map((s) => s.id),
    voided: batch.every((s) => voided.has(s.id)),
  };
}

/**
 * The check-in for a recorded update: the history as it stood just after it
 * against the same history without it. Later readings (a Trading 212 one the
 * next evening, say) don't get counted as part of it.
 */
export function checkInFor(state: SyncedState, batch: UpdateBatch, today: string): CheckIn {
  const ids = new Set(batch.ids);
  const after = { ...state, snapshots: state.snapshots.filter((s) => s.at <= batch.at) };
  const before = { ...after, snapshots: after.snapshots.filter((s) => !ids.has(s.id)) };
  return summariseCheckIn(before, after, batch.at, batch.ids, today);
}

/**
 * What to call the pension and children's totals: "Pension" (or "Pensions"
 * with more than one); a single Junior ISA by its own name (say "Ellie's
 * Junior ISA"), several as "Junior ISAs".
 */
export function heldLabels(state: SyncedState): { pension: string; junior: string } {
  const active = (kinds: string[]) => state.accounts.filter((a) => !a.archived && kinds.includes(a.kind));
  const pensions = active(PENSION_KINDS);
  const juniors = active(JUNIOR_KINDS);
  return {
    pension: pensions.length > 1 ? 'Pensions' : 'Pension',
    junior: juniors.length === 1 ? juniors[0].name : 'Junior ISAs',
  };
}
