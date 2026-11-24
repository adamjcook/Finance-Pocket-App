/**
 * Update-mode drafts survive the app being backgrounded and reloaded mid-way
 * through a payday update. Per phone, cleared on save or cancel.
 *
 * (The check-in card itself is worked out from the synced history — see
 * latestUpdateBatch in logic/checkin.ts — so both phones see it.)
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
