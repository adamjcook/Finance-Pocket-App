/**
 * Haptic "ticks" while sliding along a chart. Ticking on every day would
 * mean a buzz every couple of pixels on a long history — faster than a phone
 * motor can usefully deliver — so the step adapts to the chart's scale:
 * every day if days are at least MIN_TICK_PX apart, otherwise every week,
 * otherwise every calendar month. Either way a tick lands roughly every
 * MIN_TICK_PX or more of finger travel.
 */

export const MIN_TICK_PX = 8;
/** Never buzz more often than this, however fast the finger moves. */
export const MIN_TICK_GAP_MS = 50;
/** Long enough for typical phone motors to deliver (8ms was too short to feel). */
export const TICK_MS = 15;
export const ACTIVATE_MS = 18;

export type TickStep = 'day' | 'week' | 'month';

export function tickStep(pxPerDay: number): TickStep {
  if (pxPerDay >= MIN_TICK_PX) return 'day';
  if (pxPerDay * 7 >= MIN_TICK_PX) return 'week';
  return 'month';
}

/** Which tick bucket a day (YYYY-MM-DD) falls in; a tick fires when this changes. */
export function tickBucket(day: string, step: TickStep): string {
  if (step === 'day') return day;
  if (step === 'month') return day.slice(0, 7);
  // Monday-starting weeks, keyed by that Monday's date.
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const DEV_TICK_KEY = 'finpair-dev-tick-ms';

/**
 * Tick length to use. The dev build's Haptics tester can override it on this
 * phone (localStorage) to try lengths on a real device; production always
 * uses TICK_MS.
 */
export function tickMs(): number {
  if (import.meta.env.VITE_DEV_BUILD !== '1') return TICK_MS;
  try {
    const v = Number(localStorage.getItem(DEV_TICK_KEY));
    return v > 0 && v <= 100 ? v : TICK_MS;
  } catch {
    return TICK_MS;
  }
}

export function setDevTickMs(ms: number): void {
  try {
    localStorage.setItem(DEV_TICK_KEY, String(ms));
  } catch {
    // storage blocked: the default stays in use
  }
}
