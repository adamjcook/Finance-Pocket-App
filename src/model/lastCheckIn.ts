import { useEffect, useState } from 'preact/hooks';
import type { CheckIn } from '../logic/checkin';

/**
 * The payday update just saved on this phone, for Home's "how you did" card.
 * Kept in memory only: it belongs to this sitting, and goes when dismissed
 * or when the app is next opened.
 */
let current: CheckIn | null = null;
let undone = false;
let celebrationPending = false;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function setLastCheckIn(checkIn: CheckIn | null): void {
  current = checkIn;
  undone = false;
  // Celebrate an update that leaves you better off — once, on arriving Home.
  celebrationPending = !!checkIn && checkIn.netChange > 0;
  notify();
}

/** True the first time it's asked after a net-worth-raising update; false after. */
export function takeCelebration(): boolean {
  const pending = celebrationPending;
  celebrationPending = false;
  return pending;
}

export function markCheckInUndone(): void {
  undone = true;
  notify();
}

export function useLastCheckIn(): { checkIn: CheckIn | null; undone: boolean } {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return { checkIn: current, undone };
}

/**
 * Update-mode drafts survive the app being backgrounded and reloaded mid-way
 * through a payday update. Per phone, cleared on save or cancel.
 */
const DRAFT_KEY = 'finpair-update-draft';

export function loadDraft(): Map<string, number> {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return new Map();
    return new Map(Object.entries(JSON.parse(raw) as Record<string, number>).filter(([, v]) => Number.isInteger(v)));
  } catch {
    return new Map();
  }
}

export function saveDraft(drafts: Map<string, number | null>): void {
  try {
    const kept = [...drafts].filter((e): e is [string, number] => e[1] !== null);
    if (kept.length === 0) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* storage unavailable: drafts just don't survive a reload */
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* nothing to clear */
  }
}
