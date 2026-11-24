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
export const MIN_TICK_GAP_MS = 35;
export const TICK_MS = 8;
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
