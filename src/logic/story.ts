import type { SyncedState } from '../model/types';
import { OWED_KINDS, POT_KINDS } from '../model/types';
import { formatMoneyWhole } from './money';
import {
  debtProgress,
  effectiveSnapshots,
  growthProgress,
  loanProgress,
  netWorthLines,
  netWorthSeries,
  toDay,
  type SeriesPoint,
} from './progress';

/**
 * "Our story so far": the moments worth remembering, worked out from the
 * shared history alone. Nothing is stored, so both phones always tell the
 * same story, and undoing a mistyped balance takes its moment away with it.
 * Only good news is a moment: a month that went the wrong way never appears.
 */
export type MomentKind = 'start' | 'cleared' | 'paid' | 'low' | 'net' | 'goal' | 'switch' | 'year';

export interface Moment {
  key: string;
  day: string; // YYYY-MM-DD
  kind: MomentKind;
  title: string;
  detail?: string;
}

/** The round numbers card debt can drop under: £1k steps to £10k, then £5k to £50k, then £10k. */
function debtStep(value: number): number {
  return value <= 10_000_00 ? 1_000_00 : value <= 50_000_00 ? 5_000_00 : 10_000_00;
}

/** The lowest round line at or above `value` that it's under (e.g. £2,950 → £3,000). */
function lineAbove(value: number): number {
  const step = debtStep(value + 1);
  return (Math.floor(value / step) + 1) * step;
}

const valueOn = (series: SeriesPoint[], day: string): number | null => {
  let v: number | null = null;
  for (const p of series) {
    if (p.day <= day) v = p.value;
    else break;
  }
  return v;
};

const NUMBER_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

const ORDER: MomentKind[] = ['start', 'year', 'cleared', 'paid', 'goal', 'net', 'low', 'switch'];

export function ourStory(state: SyncedState, today: string): Moment[] {
  const currency = state.settings.currency;
  const money = (minor: number) => formatMoneyWhole(minor, currency);
  const moments: Moment[] = [];

  const effective = effectiveSnapshots(state.snapshots, state.voids).filter((s) => toDay(s.at) <= today);
  if (effective.length === 0) return [];
  const start = toDay(effective[0].at);

  const debt = debtProgress(state, today);
  const loans = loanProgress(state, today);
  const growth = growthProgress(state, today);
  const net = netWorthSeries(state, today);

  // Where it began: the totals at the end of the first day.
  const startParts = [
    [valueOn(debt.series, start), 'on the cards'],
    [valueOn(loans.series, start), 'in loans'],
    [valueOn(growth.series, start), 'saved'],
  ] as const;
  const startDetail = startParts
    .filter(([v]) => v !== null && v > 0)
    .map(([v, label]) => `${money(v!)} ${label}`)
    .join(' · ');
  moments.push({ key: 'start', day: start, kind: 'start', title: 'Where it began', detail: startDetail || undefined });

  // Every full year since.
  for (let years = 1; ; years++) {
    const day = `${Number(start.slice(0, 4)) + years}${start.slice(4)}`;
    if (day > today) break;
    const parts: string[] = [];
    const debtThen = valueOn(debt.series, start) ?? 0;
    const debtNow = valueOn(debt.series, day) ?? 0;
    if (debtThen > debtNow) parts.push(`card debt down ${money(debtThen - debtNow)}`);
    const netThen = valueOn(net, start) ?? 0;
    const netNow = valueOn(net, day) ?? 0;
    if (netNow > netThen) parts.push(`net worth up ${money(netNow - netThen)}`);
    moments.push({
      key: `year:${years}`,
      day,
      kind: 'year',
      title: years === 1 ? 'One year of doing this together' : `${NUMBER_WORDS[years] ?? years} years of doing this together`,
      detail: parts.length ? `Since the start: ${parts.join(', ')}` : undefined,
    });
  }

  // All the card debt cleared, each time it happens.
  for (let i = 1; i < debt.series.length; i++) {
    if (debt.series[i].value <= 0 && debt.series[i - 1].value > 0) {
      moments.push({ key: `cleared:${debt.series[i].day}`, day: debt.series[i].day, kind: 'cleared', title: 'All the card debt cleared' });
    }
  }

  // Card debt under a round number for the first time (the lowest line, if a big payment crossed several).
  {
    let lowest = debt.series.length ? debt.series[0].value : 0;
    for (const p of debt.series.slice(1)) {
      if (p.value >= lowest) continue;
      const line = p.value > 0 ? lineAbove(p.value) : 0;
      if (p.value > 0 && line <= lowest) {
        moments.push({ key: `low:${line}`, day: p.day, kind: 'low', title: `Card debt under ${money(line)} for the first time` });
      }
      lowest = p.value;
    }
  }

  // Net worth above zero, and past each round number, for the first time.
  {
    let highest = net.length ? net[0].value : 0;
    for (const p of net.slice(1)) {
      if (p.value <= highest) continue;
      if (highest <= 0 && p.value > 0) {
        moments.push({ key: 'net:positive', day: p.day, kind: 'net', title: 'Net worth above zero for the first time', detail: 'What you own now outweighs what you owe' });
      }
      const passed = netWorthLines(p.value).filter((t) => t > highest);
      if (passed.length) {
        const line = passed[passed.length - 1];
        moments.push({ key: `net:${line}`, day: p.day, kind: 'net', title: `Net worth over ${money(line)} for the first time` });
      }
      highest = p.value;
    }
  }

  // Each card or loan paid off, and each pot reaching its goal.
  for (const a of state.accounts) {
    const own = effective.filter((s) => s.accountId === a.id);
    let was: number | null = null;
    const goal = a.goalMinor ?? 0;
    let goalDone = false;
    for (const s of own) {
      if (OWED_KINDS.includes(a.kind) && was !== null && was > 0 && s.balance <= 0) {
        moments.push({ key: `paid:${a.id}:${s.id}`, day: toDay(s.at), kind: 'paid', title: `${a.name} paid off` });
      }
      if (POT_KINDS.includes(a.kind) && goal > 0 && !goalDone && was !== null && was < goal && s.balance >= goal) {
        goalDone = true;
        moments.push({
          key: `goal:${a.id}`,
          day: toDay(s.at),
          kind: 'goal',
          title: `${a.name} reached its goal`,
          detail: `${money(goal)} saved`,
        });
      }
      was = s.balance;
    }
  }

  // Bank switches: an alias moving on to a new account.
  const byId = new Map(state.accounts.map((a) => [a.id, a]));
  for (const al of state.aliases) {
    if (al.archived) continue;
    al.history.slice(1).forEach((epoch, i) => {
      const to = byId.get(epoch.accountId);
      const day = toDay(epoch.from);
      if (!to || day > today) return;
      moments.push({
        key: `switch:${al.id}:${i}`,
        day,
        kind: 'switch',
        title: `${al.name} moved to ${to.institution || to.name}`,
        detail: 'Its history came along too',
      });
    });
  }

  return moments.sort((x, y) => x.day.localeCompare(y.day) || ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind));
}

/** The same day `months` months before `day`, held to the end of a shorter month (31 Aug → 28 Feb). */
function monthsBefore(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const index = y * 12 + (m - 1) - months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

const LOOK_BACKS = [
  { months: 6, words: 'six months ago', over: 'in six months' },
  { months: 12, words: 'a year ago', over: 'in a year' },
] as const;

/**
 * Home's news line, once there are six months of history: how things stood
 * six months ago (and a year ago, once there's a year to look back on)
 * against now. Only the comparisons that are good news are said, and the
 * line comes at most once a month. Card debt leads; net worth otherwise.
 */
export function lookBackNews(state: SyncedState, today: string): { key: string; text: string } | null {
  const currency = state.settings.currency;
  const money = (minor: number) => formatMoneyWhole(minor, currency);
  const key = `lookback:${today.slice(0, 7)}`;
  const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  /** The good comparisons for a series: what it was at each look-back that it's improved on. */
  const better = (series: SeriesPoint[], good: (then: number) => boolean) =>
    LOOK_BACKS.flatMap(({ months, words, over }) => {
      const day = monthsBefore(today, months);
      if (!series.length || series[0].day > day) return [];
      const then = valueOn(series, day)!;
      return good(then) ? [{ words, over, then }] : [];
    });

  const debt = debtProgress(state, today);
  const cards = better(debt.series, (then) => then > 0 && debt.current < then);
  if (cards.length) {
    const was = cards.map((c, i) => (i === 0 ? `${c.words} the cards were at ${money(c.then)}` : `${c.words} ${money(c.then)}`));
    const now = debt.current <= 0 ? 'Now they’re clear.' : `Now ${money(debt.current)}.`;
    return { key, text: `${sentence(was.join(', and '))}. ${now}` };
  }

  const net = netWorthSeries(state, today);
  const netNow = net.length ? net[net.length - 1].value : 0;
  const up = better(net, (then) => netNow > then);
  if (up.length) {
    const parts = up.map((u) => `${money(netNow - u.then)} ${u.over}`);
    return { key, text: `Net worth is up ${parts.join(', and ')}.` };
  }
  return null;
}
