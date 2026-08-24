import type { SyncPayload } from '../model/types';
import { mergeState, stateHash, summarizeMerge, type MergeSummary } from '../logic/merge';
import { getStore, mutate, patchDevice } from '../model/store';
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
