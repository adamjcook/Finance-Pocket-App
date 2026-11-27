import type { SyncPayload } from '../model/types';
import { mergeState, stateHash, summarizeMerge, type MergeSummary } from '../logic/merge';
import { getStore, mutate, patchDevice } from '../model/store';
import { buildPayload, encodePayload, LARGE_CHUNK_BYTES } from './codec';
import { newRelayKey, relayChannel, settleKey } from './relay';

export interface ApplyResult {
  summary: MergeSummary;
  hash: string;
}

/** Merge a payload (partner sync or backup file) into this phone's state. */
export async function mergePayload(payload: SyncPayload): Promise<MergeSummary> {
  const before = getStore().state;
  const merged = mergeState(before, payload);
  await mutate(() => merged);
  return summarizeMerge(before, merged);
}

/** Merge a partner payload and record the sync (time + check code). */
export async function applyPayload(payload: SyncPayload): Promise<ApplyResult> {
  const summary = await mergePayload(payload);
  // A QR sync also links the phones for automatic sync: settle on one key.
  if (payload.relayKey) {
    const relay = getStore().device.relay;
    const key = settleKey(relay?.key, payload.relayKey)!;
    if (key !== relay?.key) {
      await patchDevice({
        relay: { ...(relay ?? {}), key, channel: await relayChannel(key), pushedHash: null, seen: {} },
      });
    }
  }
  const hash = await stateHash(getStore().state);
  await patchDevice({ lastSyncAt: new Date().toISOString(), lastSyncStateHash: hash });
  return { summary, hash };
}

/**
 * Frames encoding this phone's current state, for the partner to scan. They
 * also carry the automatic-sync key (made now if this phone has none), which
 * only ever travels this way: phone to phone, screen to camera. `large`
 * splits the data into smaller pieces, so each QR code is coarser and easier
 * for a weak camera to read.
 */
export async function currentFrames(large = false): Promise<string[]> {
  let { device } = getStore();
  if (!device.relay?.key) {
    const key = newRelayKey();
    await patchDevice({ relay: { ...(device.relay ?? {}), key, channel: await relayChannel(key) } });
    device = getStore().device;
  }
  const { state } = getStore();
  return encodePayload(
    { ...buildPayload(state, device.deviceId), relayKey: device.relay!.key },
    large ? LARGE_CHUNK_BYTES : undefined,
  );
}
