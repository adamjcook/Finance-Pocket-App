import { openDB, type IDBPDatabase } from 'idb';
import type { DeviceState, SyncedState } from './types';
import { DEFAULT_SETTINGS } from './types';

const DB_NAME = 'finance-pocket';
const DB_VERSION = 1;

type DB = IDBPDatabase;

let dbPromise: Promise<DB> | null = null;

function getDB(): Promise<DB> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('accounts', { keyPath: 'id' });
      db.createObjectStore('aliases', { keyPath: 'id' });
      const snapshots = db.createObjectStore('snapshots', { keyPath: 'id' });
      snapshots.createIndex('byAccount', 'accountId');
      db.createObjectStore('voids', { keyPath: 'snapshotId' });
      db.createObjectStore('settings', { keyPath: 'id' });
      db.createObjectStore('device', { keyPath: 'id' });
    },
  });
  return dbPromise;
}

export async function loadState(): Promise<SyncedState> {
  const db = await getDB();
  const tx = db.transaction(['accounts', 'aliases', 'snapshots', 'voids', 'settings'], 'readonly');
  const [accounts, aliases, snapshots, voids, settings] = await Promise.all([
    tx.objectStore('accounts').getAll(),
    tx.objectStore('aliases').getAll(),
    tx.objectStore('snapshots').getAll(),
    tx.objectStore('voids').getAll(),
    tx.objectStore('settings').get('settings'),
  ]);
  await tx.done;
  return {
    accounts,
    aliases,
    snapshots,
    voids,
    settings: settings ?? { ...DEFAULT_SETTINGS },
  };
}

/** Persist the whole synced state atomically (the dataset is tiny). */
export async function saveState(state: SyncedState): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['accounts', 'aliases', 'snapshots', 'voids', 'settings'], 'readwrite');
  const stores = ['accounts', 'aliases', 'snapshots', 'voids'] as const;
  const lists = [state.accounts, state.aliases, state.snapshots, state.voids];
  await Promise.all(
    stores.map(async (name, i) => {
      const store = tx.objectStore(name);
      await store.clear();
      for (const record of lists[i]) void store.put(record);
    }),
  );
  void tx.objectStore('settings').put(state.settings);
  await tx.done;
}

export async function loadDevice(): Promise<DeviceState> {
  const db = await getDB();
  const existing = (await db.get('device', 'device')) as DeviceState | undefined;
  if (existing) return existing;
  const created: DeviceState = {
    id: 'device',
    deviceId: crypto.randomUUID(),
    lastSyncAt: null,
    lastSyncStateHash: null,
  };
  await db.put('device', created);
  return created;
}

export async function saveDevice(device: DeviceState): Promise<void> {
  const db = await getDB();
  await db.put('device', device);
}
