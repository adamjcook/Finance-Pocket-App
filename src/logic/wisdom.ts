/**
 * The starter line on the first-run screen. A pure function of the date, so
 * both partners' phones show the same line without syncing anything.
 */

function pickForSeed(seed: string, list: string[]): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return list[Math.abs(hash) % list.length];
}

const STARTER_QUOTES = [
  'Every shared goal starts with one honest number.',
  'The hardest part of a plan is starting it. You’re already here.',
  'Two people, one picture of the truth — that’s the whole point.',
  'You don’t need it perfect on day one. You need it started.',
  'The best financial plan is the one you actually keep updating.',
  'Clarity first, discipline second — you’re doing this in the right order.',
  'A few minutes now saves a hundred arguments later.',
];

/** Shown on the first-run screen; varies day to day. */
export function starterQuote(today: string): string {
  return pickForSeed(today, STARTER_QUOTES);
}
