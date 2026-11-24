import type { SyncedState } from '../model/types';
import { latestBalances } from '../model/repo';
import { formatMoneyWhole } from './money';
import { daysBetween, debtProgress, formatDay, type SeriesPoint } from './progress';

/**
 * The one line of news at the top of Home. It only appears when something
 * actually changed and is worth reading: never a standing sentence that says
 * the same thing every visit. Each item has a key that changes when the news
 * does; a phone shows an item for at most a week (or until dismissed) and
 * then stays quiet until there's something new.
 */
export interface NewsItem {
  key: string;
  text: string;
}

/** What this phone remembers about news it has shown. Never synced. */
export interface NewsMemory {
  /** key → the day it was first shown. */
  seen: Record<string, string>;
  dismissed: string[];
  /** The card pay-off forecast month (YYYY-MM) last worked out, and the one before it. */
  forecast: string | null;
  forecastWas: string | null;
  forecastChangedOn: string | null;
}

export const EMPTY_NEWS_MEMORY: NewsMemory = {
  seen: {},
  dismissed: [],
  forecast: null,
  forecastWas: null,
  forecastChangedOn: null,
};

const SHOW_FOR_DAYS = 7;
const DAYS_PER_MONTH = 30.4375;

const addDays = (day: string, n: number) => {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const monthName = (ym: string) =>
  new Date(ym + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

const monthIndex = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return y * 12 + (m - 1);
};

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const count = (n: number, unit: string) => `${NUMBER_WORDS[n] ?? n} ${unit}${n === 1 ? '' : 's'}`;

/** The last day the card total actually changed (the series carries values forward daily). */
function lastChangeDay(series: SeriesPoint[]): string | null {
  for (let i = series.length - 1; i > 0; i--) {
    if (series[i].value !== series[i - 1].value) return series[i].day;
  }
  return series.length ? series[0].day : null;
}

const valueOn = (series: SeriesPoint[], day: string) => {
  let v = series[0].value;
  for (const p of series) {
    if (p.day <= day) v = p.value;
    else break;
  }
  return v;
};

/**
 * When the cards would be clear at the pace of the last three months, as
 * YYYY-MM. Worked out as of the last update (not today), so it only moves
 * when balances do. Null without two months of history or while not paying down.
 */
export function cardForecast(state: SyncedState, today: string): string | null {
  const { series, current } = debtProgress(state, today);
  if (series.length === 0 || current <= 0) return null;
  const asOf = lastChangeDay(series)!;
  const start = series[0].day > addDays(asOf, -90) ? series[0].day : addDays(asOf, -90);
  const spanDays = daysBetween(start, asOf);
  if (spanDays < 60) return null;
  const now = valueOn(series, asOf);
  const perMonth = (valueOn(series, start) - now) / (spanDays / DAYS_PER_MONTH);
  if (perMonth <= 0) return null;
  return addDays(asOf, Math.ceil((now / perMonth) * DAYS_PER_MONTH)).slice(0, 7);
}

/** The memory after noticing this phone's current forecast (pure). */
export function rememberForecast(memory: NewsMemory, forecast: string | null, today: string): NewsMemory {
  if (forecast === memory.forecast || forecast === null) return memory;
  // The first forecast a phone works out isn't news; a change to it is.
  if (memory.forecast === null) return { ...memory, forecast };
  return { ...memory, forecast, forecastWas: memory.forecast, forecastChangedOn: today };
}

function candidates(state: SyncedState, today: string, memory: NewsMemory, currency: string): NewsItem[] {
  const { series, current } = debtProgress(state, today);
  const urgent: NewsItem[] = [];
  const rest: NewsItem[] = [];

  // Cards cleared, or a new round-number low (under £3,000 for the first time).
  if (series.length > 1) {
    if (current <= 0) {
      let day: string | null = null;
      for (let i = 1; i < series.length; i++) {
        if (series[i].value <= 0 && series[i - 1].value > 0) day = series[i].day;
      }
      if (day && daysBetween(day, today) <= SHOW_FOR_DAYS) {
        urgent.push({ key: `cleared:${day}`, text: 'Your cards are clear. Every penny of that debt, paid off.' });
      }
    } else {
      const step = current < 10_000_00 ? 1_000_00 : current < 50_000_00 ? 5_000_00 : 10_000_00;
      const under = (Math.floor(current / step) + 1) * step;
      const first = series.findIndex((p) => p.value < under);
      if (first > 0 && daysBetween(series[first].day, today) <= SHOW_FOR_DAYS) {
        rest.push({
          key: `low:${under}`,
          text: `Card debt is under ${formatMoneyWhole(under, currency)} for the first time.`,
        });
      }
    }
  }

  // 0% deals in their last 60 days, at each threshold as the end gets closer.
  const balances = latestBalances(state);
  const promos = state.accounts
    .filter((a) => !a.archived && a.kind === 'credit_card' && a.promoEndsOn)
    .map((a) => ({ a, days: daysBetween(today, a.promoEndsOn!), owed: balances.get(a.id)?.balance ?? 0 }))
    .filter((p) => p.days >= 0 && p.days <= 60 && p.owed > 0)
    .sort((x, y) => x.days - y.days);
  for (const { a, days, owed } of promos) {
    const bucket = days <= 1 ? 1 : days <= 7 ? 7 : days <= 14 ? 14 : days <= 30 ? 30 : 60;
    const when = days === 0 ? 'ends today' : days === 1 ? 'ends tomorrow' : `ends in ${days} days`;
    const item = {
      key: `promo:${a.id}:${a.promoEndsOn}:${bucket}`,
      text: `${a.name}’s 0% deal ${when} (${formatDay(a.promoEndsOn!)}), with ${formatMoneyWhole(owed, currency)} still on it.`,
    };
    (days <= 14 ? urgent : rest).push(item);
  }

  // The pay-off forecast moved since this phone last worked it out.
  if (
    memory.forecast &&
    memory.forecastWas &&
    memory.forecastChangedOn &&
    daysBetween(memory.forecastChangedOn, today) <= SHOW_FOR_DAYS
  ) {
    const shift = monthIndex(memory.forecast) - monthIndex(memory.forecastWas);
    const how = shift < 0 ? `${count(-shift, 'month')} sooner than before` : `${count(shift, 'month')} later than before`;
    rest.push({
      key: `forecast:${memory.forecast}:${memory.forecastWas}`,
      text: `At this pace the cards are clear by ${monthName(memory.forecast)}, ${how}.`,
    });
  }

  // Card debt down at the end of each of the last few months.
  if (series.length > 1) {
    const monthEnds = new Map<string, number>();
    for (const p of series) monthEnds.set(p.day.slice(0, 7), p.value);
    const months = [...monthEnds.keys()];
    const lastChange = lastChangeDay(series)!;
    let streak = 0;
    for (let i = months.length - 1; i > 0; i--) {
      if (monthEnds.get(months[i])! < monthEnds.get(months[i - 1])!) streak++;
      else break;
    }
    if (streak >= 3 && current > 0 && daysBetween(lastChange, today) <= SHOW_FOR_DAYS) {
      rest.push({
        key: `streak:${months[months.length - 1]}:${streak}`,
        text: `Card debt has come down ${count(streak, 'month')} running.`,
      });
    }
  }

  return [...urgent, ...rest];
}

/** Today's news for Home, or null on a quiet day. */
export function homeNews(state: SyncedState, today: string, memory: NewsMemory): NewsItem | null {
  const currency = state.settings.currency;
  return (
    candidates(state, today, memory, currency).find((n) => {
      if (memory.dismissed.includes(n.key)) return false;
      const firstSeen = memory.seen[n.key];
      return !firstSeen || daysBetween(firstSeen, today) < SHOW_FOR_DAYS;
    }) ?? null
  );
}

/** The memory after showing `key` today; old entries are pruned so it stays small. */
export function rememberShown(memory: NewsMemory, key: string, today: string): NewsMemory {
  if (memory.seen[key]) return memory;
  const seen = Object.fromEntries(
    Object.entries(memory.seen).filter(([, day]) => daysBetween(day, today) <= 120),
  );
  return { ...memory, seen: { ...seen, [key]: today } };
}

export function rememberDismissed(memory: NewsMemory, key: string): NewsMemory {
  return { ...memory, dismissed: [...memory.dismissed.slice(-49), key] };
}
