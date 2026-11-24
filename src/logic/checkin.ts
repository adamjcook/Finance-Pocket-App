import type { SyncedState, UUID } from '../model/types';
import { GROWTH_KINDS, OWED_KINDS } from '../model/types';
import { latestBalances } from '../model/repo';
import { debtProgress, growthProgress, loanProgress } from './progress';

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
  /** Which of those totals this couple actually tracks (so we don't say "£0"). */
  has: { cards: boolean; loans: boolean; savings: boolean };
  /** Moments worth naming, most important first. */
  milestones: string[];
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

  const milestones: string[] = [];
  const hadCardDebt = debtBefore.series.length > 0;

  // All the card debt gone is the big one; otherwise a new lowest total.
  if (hadCardDebt && debtBefore.current > 0 && debtAfter.current <= 0) {
    milestones.push('All card debt cleared');
  } else if (hadCardDebt && debtAfter.current < debtBefore.current) {
    const lowestBefore = Math.min(...debtBefore.series.map((p) => p.value));
    if (debtAfter.current < lowestBefore) milestones.push('Lowest card debt yet');
  }

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
    if (GROWTH_KINDS.includes(a.kind) && goal > 0 && was < goal && now >= goal) {
      milestones.push(`${a.name} reached its goal`);
    }
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
    has: {
      cards: debtAfter.series.length > 0,
      loans: loansAfter.series.length > 0,
      savings: savingsAfter.series.length > 0,
    },
    milestones,
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
