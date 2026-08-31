/**
 * Short, contextual lines of encouragement shown around the app — a daily
 * quote on the Dashboard, a starter line on first run, and progress-aware
 * lines under each goal card. Everything here is a pure function of some
 * seed (usually today's date) so both partners' phones show the same line
 * without needing to sync anything new.
 */

function pickForSeed(seed: string, list: string[]): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return list[Math.abs(hash) % list.length];
}

const DAILY_QUOTES = [
  "A budget is just telling your money where to go, instead of wondering where it went.",
  'Save first, spend what’s left — not the other way around.',
  'The best time to start was years ago. The next best time is today.',
  'Small, steady amounts beat big, occasional ones.',
  'Debt is expensive. Patience is free.',
  'Talking about money is easier when you’re doing it together.',
  'A shared goal, checked in on honestly, rarely fails.',
  'Wealth isn’t what you earn — it’s what you keep.',
  'Every account you track is a decision you don’t have to make twice.',
  'The goal isn’t to be rich. It’s to be free to choose.',
  'Progress hides in the boring months — keep showing up.',
  'A pound saved today buys more peace than a pound spent.',
  'You don’t need a perfect month. You need enough good ones.',
  'Two people paying attention beat one person guessing.',
  'The plan works if you keep opening the app.',
  'Compound interest rewards the patient, not the clever.',
];

const STARTER_QUOTES = [
  'Every shared goal starts with one honest number.',
  'The hardest part of a plan is starting it. You’re already here.',
  'Two people, one picture of the truth — that’s the whole point.',
  'You don’t need it perfect on day one. You need it started.',
  'The best financial plan is the one you actually keep updating.',
  'Clarity first, discipline second — you’re doing this in the right order.',
  'A few minutes now saves a hundred arguments later.',
];

const DEBT_STARTED = [
  'The first steps are the hardest — you’ve already taken them.',
  'Every payment, however small, is real progress.',
];
const DEBT_QUARTER = [
  'A quarter down. The habit is already working.',
  'Keep going — the trend line is what matters, not any single month.',
];
const DEBT_HALF = [
  'Past the halfway mark — momentum is on your side now.',
  'More paid off than left to go. That’s worth noticing.',
];
const DEBT_CLOSE = [
  'So close now — the finish line is in sight.',
  'The last stretch is the shortest one. Keep at it.',
];

const GROWTH_UP = ['Consistency compounds — keep it going.', 'Up is up, however small the step.'];
const GROWTH_DOWN = [
  'A dip isn’t a trend. Stay the course.',
  'Some months take more than they give — that’s normal.',
];
const GROWTH_FLAT = [
  'Holding steady is still progress.',
  'No movement isn’t the same as no progress — check back next month.',
];

const LOAN_ONGOING = [
  'Every repayment shrinks what’s left.',
  'Loans shrink the same way debt does — one payment at a time.',
];

/** Rotates daily; same line on both phones since it's keyed off the date, not stored state. */
export function quoteOfTheDay(today: string): string {
  return pickForSeed(today, DAILY_QUOTES);
}

/** Shown once on the first-run screen — varies day to day, not that it matters much there. */
export function starterQuote(today: string): string {
  return pickForSeed(today, STARTER_QUOTES);
}

/** A short line reflecting how far along the credit-card payoff is. Null once cleared — the
 * existing "goal done" message already covers that. */
export function debtEncouragement(today: string, pct: number, cleared: boolean): string | null {
  if (cleared || pct <= 0) return null;
  if (pct >= 75) return pickForSeed(today, DEBT_CLOSE);
  if (pct >= 50) return pickForSeed(today, DEBT_HALF);
  if (pct >= 25) return pickForSeed(today, DEBT_QUARTER);
  return pickForSeed(today, DEBT_STARTED);
}

/** A short line reflecting the last 30 days of combined savings & investments. */
export function growthEncouragement(today: string, delta30: number, hasHistory: boolean): string | null {
  if (!hasHistory) return null;
  if (delta30 > 0) return pickForSeed(today, GROWTH_UP);
  if (delta30 < 0) return pickForSeed(today, GROWTH_DOWN);
  return pickForSeed(today, GROWTH_FLAT);
}

/** A short line for outstanding loans, while any remain. */
export function loanEncouragement(today: string, cleared: boolean): string | null {
  if (cleared) return null;
  return pickForSeed(today, LOAN_ONGOING);
}
