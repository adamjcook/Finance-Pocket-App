import { useEffect, useState } from 'preact/hooks';
import type { DeviceState, SyncedState } from './types';
import { loadDevice, loadState, saveDevice, saveState } from './db';

/**
 * Tiny app store: the whole synced state lives in memory (it's a few hundred
 * records at most), every mutation persists the full state to IndexedDB and
 * re-renders subscribers.
 */

export interface AppStore {
  state: SyncedState;
  device: DeviceState;
}

let store: AppStore | null = null;
let initPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

async function init(): Promise<void> {
  const [state, device] = await Promise.all([loadState(), loadDevice()]);
  store = { state, device };
  notify();
}

/** Subscribe a component to the store. Returns null until IndexedDB loads. */
export function useApp(): AppStore | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    initPromise ??= init();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return store;
}

export function getStore(): AppStore {
  if (!store) throw new Error('Store not initialized');
  return store;
}

export async function mutate(fn: (state: SyncedState) => SyncedState): Promise<void> {
  const s = getStore();
  const next = fn(s.state);
  if (next === s.state) return;
  store = { ...s, state: next };
  notify();
  await saveState(next);
}

export async function patchDevice(changes: Partial<Omit<DeviceState, 'id' | 'deviceId'>>): Promise<void> {
  const s = getStore();
  const device = { ...s.device, ...changes };
  store = { ...s, device };
  notify();
  await saveDevice(device);
}
