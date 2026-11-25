import type { SyncPayload, SyncedState } from '../model/types';
import { getStore, patchDevice, subscribe } from '../model/store';
import { stateHash } from '../logic/merge';
import { call, workerReady } from '../integrations/t212';
import { asSyncPayload, buildPayload, deflate, fromBase64url, inflate, toBase64url } from './codec';
import { applyPayload } from './apply';

/**
 * Automatic sync through the couple's own Worker (worker/src/relay.ts).
 *
 * After any change, this phone uploads an encrypted copy of all its data to
 * its slot on the Worker; when the app opens or comes back on screen, it
 * reads the partner's slot and merges it in — the same merge as a QR sync,
 * which is order-free and safe to repeat, so the phones can catch up
 * whenever. Everything is encrypted here with AES-GCM using a key the two
 * phones swapped over QR; the Worker stores only bytes it can't read.
 */

const UPLOAD_DELAY_MS = 3000;

export function newRelayKey(): string {
  return toBase64url(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Two phones that each made a key settle on the same one: both keep the
 * lower, so after the two-way QR sync they agree whichever scanned first.
 */
export function settleKey(mine: string | null | undefined, theirs: string | null | undefined): string | null {
  if (!mine) return theirs ?? null;
  if (!theirs) return mine;
  return mine < theirs ? mine : theirs;
}

/**
 * The linked pair's channel on the Worker: a fingerprint of the shared key,
 * so the Worker can keep pairs apart without ever learning the key.
 */
export async function relayChannel(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`finpair-relay:${key}`));
  return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function aesKey(key: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromBase64url(key) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptPayload(key: string, payload: SyncPayload): Promise<{ iv: string; data: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = await deflate(new TextEncoder().encode(JSON.stringify(payload)));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(key), plain as BufferSource);
  return { iv: toBase64url(iv), data: toBase64url(new Uint8Array(sealed)) };
}

export async function decryptPayload(key: string, iv: string, data: string): Promise<SyncPayload> {
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64url(iv) as BufferSource },
      await aesKey(key),
      fromBase64url(data) as BufferSource,
    );
  } catch {
    throw new Error("Your partner's phone uses a different sync key. Sync once by QR code to link them again.");
  }
  return asSyncPayload(JSON.parse(new TextDecoder().decode(await inflate(new Uint8Array(plain)))));
}

interface Slot {
  deviceId: string;
  at: string;
  iv: string;
  data: string;
}

/** Ready to sync automatically: a shared key, a Worker, and not switched off. */
export function relayReady(): boolean {
  const { state, device } = getStore();
  return !!device.relay?.key && device.relay.enabled !== false && workerReady(state.settings.t212);
}

async function fingerprint(state: SyncedState): Promise<string> {
  return stateHash(state);
}

/**
 * Upload this phone's data if it changed since the last upload. With
 * `notify`, the Worker also tells the partner's phone (a payday update).
 */
export async function pushNow(notify?: { title: string; body: string }): Promise<void> {
  if (!relayReady()) return;
  const { state, device } = getStore();
  const hash = await fingerprint(state);
  if (!notify && device.relay?.pushedHash === hash) return;
  const at = new Date().toISOString();
  const sealed = await encryptPayload(device.relay!.key, buildPayload(state, device.deviceId));
  await call(state.settings.t212!, '/relay', {
    method: 'POST',
    body: JSON.stringify({
      slot: { channel: device.relay!.channel ?? (await relayChannel(device.relay!.key)), deviceId: device.deviceId, at, ...sealed },
      notify: notify ? { ...notify, exceptEndpoint: device.push?.enabled ? await ownEndpoint() : null } : undefined,
    }),
  });
  await patchDevice({ relay: { ...getStore().device.relay!, pushedHash: hash } });
}

async function ownEndpoint(): Promise<string | null> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    return (await reg?.pushManager.getSubscription())?.endpoint ?? null;
  } catch {
    return null;
  }
}

/** Fetch the partner's copy and merge anything new. Returns true if something was merged. */
export async function pullNow(): Promise<boolean> {
  if (!relayReady()) return false;
  const { state, device } = getStore();
  const relay = device.relay!;
  try {
    const channel = relay.channel ?? (await relayChannel(relay.key));
    const { slots } = await call<{ slots: Slot[] }>(state.settings.t212!, `/relay?channel=${channel}`);
    let merged = false;
    const seen = { ...(relay.seen ?? {}) };
    let partnerHash = relay.partnerHash ?? null;
    for (const slot of slots) {
      if (slot.deviceId === device.deviceId || seen[slot.deviceId] === slot.at) continue;
      const payload = await decryptPayload(relay.key, slot.iv, slot.data);
      partnerHash = await stateHash(payload);
      await applyPayload(payload);
      seen[slot.deviceId] = slot.at;
      merged = true;
    }
    await patchDevice({
      relay: { ...getStore().device.relay!, seen, partnerHash, checkedAt: new Date().toISOString(), error: null },
    });
    return merged;
  } catch (err) {
    await patchDevice({
      relay: {
        ...getStore().device.relay!,
        checkedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return false;
  }
}

/** Pull then push: pick up the partner's changes, then publish the merged result. */
export async function syncNow(): Promise<void> {
  await pullNow();
  try {
    await pushNow();
  } catch (err) {
    await patchDevice({
      relay: { ...getStore().device.relay!, error: err instanceof Error ? err.message : String(err) },
    });
  }
}

let started = false;

/**
 * Start automatic sync for this session: sync on open and whenever the app
 * comes back on screen, and upload a few seconds after any change to the
 * shared data (so a burst of edits goes up once).
 */
export function startAutoSync(): void {
  if (started) return;
  started = true;
  let timer = 0;
  let lastState: SyncedState | null = null;
  subscribe(() => {
    const { state } = getStore();
    if (state === lastState) return; // a device-only change (theme, sync bookkeeping…)
    lastState = state;
    if (!relayReady()) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => void pushNow().catch(() => {}), UPLOAD_DELAY_MS);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
  lastState = getStore().state;
  void syncNow();
}
