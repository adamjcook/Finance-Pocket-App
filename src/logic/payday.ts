import type { Settings, SyncedState, UUID } from '../model/types';
import {
  DEFAULT_PAYDAY_RULE,
  latestPaydayWindow,
  parsePaydayRule,
  type PaydayRule,
  type PaydayWindow,
} from '../../worker/src/payday';
import { summariseCheckIn, type CheckIn } from './checkin';

/**
 * Home's payday summary: one shared picture of the month's payday update.
 *
 * The window opens on the earlier of the two paydays and closes at the end
 * of the month's last working day (see worker/src/payday.ts). Every balance
 * either of you types in during it counts, all added together, and once it
 * has closed the summary stays as it was until the next window opens. It's
 * about the two of you together: it never says who updated, or whose pay
 * is still to come.
 *
 * If nothing was typed in during the window, the first update after it
 * still counts as that payday's (a late update is still the payday update).
 */
export interface PaydaySummary {
  window: PaydayWindow;
  /**
   * waiting: no update yet this payday — time for one.
   * open: updates are in and more still count ("so far").
   * closed: the window is over; the summary stays as it is.
   */
  status: 'waiting' | 'open' | 'closed';
  /** The last day whose updates count: the window's end, or a late update's day. */
  closes: string;
  /** Everything the window's updates changed, added together. Null while waiting. */
  checkIn: CheckIn | null;
  /** The ids of the updates counted. */
  updateIds: UUID[];
}

/** Both partners' payday rules, as saved in Settings (the default where unset). */
export function paydayRules(settings: Settings): [PaydayRule, PaydayRule] {
  return [parsePaydayRule(settings.paydayA ?? DEFAULT_PAYDAY_RULE), parsePaydayRule(settings.paydayB ?? DEFAULT_PAYDAY_RULE)];
}

/** The phone owner's own payday rule (for their reminder). */
export function myPaydayRule(settings: Settings, me: 'A' | 'B' | null | undefined): PaydayRule {
  const [a, b] = paydayRules(settings);
  return me === 'B' ? b : a;
}

/** A moment's day (YYYY-MM-DD) on this phone's clock. */
export function localDay(at: string | Date): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A balance typed in by hand (not an automatic reading or an account's opening balance). */
function updateSnapshots(state: SyncedState) {
  const opened = new Map(state.accounts.map((a) => [a.id, a.createdAt]));
  const voided = new Set(state.voids.map((v) => v.snapshotId));
  return state.snapshots.filter(
    (s) => s.deviceId !== 't212' && s.createdAt === s.at && opened.get(s.accountId) !== s.at && !voided.has(s.id),
  );
}

export function paydaySummary(state: SyncedState, now: Date): PaydaySummary {
  const today = localDay(now);
  const window = latestPaydayWindow(paydayRules(state.settings), today);
  const updates = updateSnapshots(state).filter((s) => localDay(s.at) >= window.opens);
  const inWindow = updates.filter((s) => localDay(s.at) <= window.closes);
  // Nothing during the window: the first update after it is the payday's.
  const late = inWindow.length === 0 && updates.length > 0 ? updates.map((s) => localDay(s.at)).sort()[0] : null;
  const closes = late ?? window.closes;
  const counted = late ? updates.filter((s) => localDay(s.at) === late) : inWindow;

  if (counted.length === 0) return { window, status: 'waiting', closes, checkIn: null, updateIds: [] };

  // Like a single update's check-in: the history up to the window's end,
  // against the same history without the payday's updates. Automatic
  // readings and newly added accounts aren't counted as change.
  const ids = new Set(counted.map((s) => s.id));
  const endDay = today <= closes ? today : closes;
  const after = { ...state, snapshots: state.snapshots.filter((s) => localDay(s.at) <= endDay) };
  const before = { ...after, snapshots: after.snapshots.filter((s) => !ids.has(s.id)) };
  const lastAt = counted.reduce((m, s) => (s.at > m ? s.at : m), counted[0].at);
  return {
    window,
    status: today <= closes ? 'open' : 'closed',
    closes,
    checkIn: summariseCheckIn(before, after, lastAt, [...ids], endDay),
    updateIds: [...ids],
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "November", for "Our November payday". */
export function windowMonthName(window: PaydayWindow): string {
  return MONTHS[Number(window.month.slice(5)) - 1];
}

/** "24–30 Nov", or "28 Nov – 2 Dec" across a month end. */
export function dayRange(from: string, to: string): string {
  const short = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (from === to) return short(from);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8))}–${short(to)}`;
  return `${short(from)} – ${short(to)}`;
}
