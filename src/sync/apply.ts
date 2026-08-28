import type { SyncPayload } from '../model/types';
import { mergeState, stateHash, summarizeMerge, type MergeSummary } from '../logic/merge';
import { getStore, mutate, patchDevice } from '../model/store';
import { takePendingShare } from '../model/db';
import { buildPayload, encodePayload } from './codec';

export interface ApplyResult {
  summary: MergeSummary;
  hash: string;
}

/** Merge a partner payload into this phone's state and record the sync. */
export async function applyPayload(payload: SyncPayload): Promise<ApplyResult> {
  const before = getStore().state;
  const merged = mergeState(before, payload);
  await mutate(() => merged);
  const hash = await stateHash(merged);
  await patchDevice({ lastSyncAt: new Date().toISOString(), lastSyncStateHash: hash });
  return { summary: summarizeMerge(before, merged), hash };
}

/** Frames encoding this phone's current state, for the partner to scan. */
export async function currentFrames(): Promise<string[]> {
  const { state, device } = getStore();
  return encodePayload(buildPayload(state, device.deviceId));
}

/**
 * JSON file of this phone's current state, for handing off via the Web Share
 * API. Deliberately synchronous: navigator.share() requires a fresh user
 * gesture, and even a microtask-only `await` before calling it narrows that
 * window, so nothing async sits between the tap and the share() call.
 */
export function currentShareFile(): File {
  const { state, device } = getStore();
  const payload = buildPayload(state, device.deviceId);
  return new File([JSON.stringify(payload)], 'pocket-finances-sync.json', {
    type: 'application/json',
  });
}

/**
 * Merge a share the service worker's share-target handler stashed while the
 * app wasn't open (see src/sw.ts). Returns null when there's nothing pending.
 */
export async function consumePendingShare(): Promise<ApplyResult | null> {
  const json = await takePendingShare();
  if (json === null) return null;
  const payload = JSON.parse(json) as SyncPayload;
  if (payload.v !== 1 || !Array.isArray(payload.accounts)) {
    throw new Error('That shared file doesn’t look like a Pocket Finances sync.');
  }
  return applyPayload(payload);
}
