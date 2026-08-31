import { openDB, type IDBPDatabase } from 'idb';
import type { DashboardSectionKey, DeviceState, SyncedState } from './types';
import { DEFAULT_DASHBOARD_ORDER, DEFAULT_SETTINGS } from './types';

// The dev deployment (see vite.config.ts / .env.dev-pages) uses a distinct
// name so it can never read or write the real app's data, even though it's
// served from the same origin.
const DB_NAME = import.meta.env.VITE_DB_NAME || 'finance-pocket';
// Stays at 2 even though the 'shares' store from the (now-removed) Web Share
// feature is unused: IndexedDB can't open a database at a version lower than
// one it's already been upgraded to, and phones in the wild are already at 2.
const DB_VERSION = 2;

type DB = IDBPDatabase;

let dbPromise: Promise<DB> | null = null;

function getDB(): Promise<DB> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('accounts', { keyPath: 'id' });
        db.createObjectStore('aliases', { keyPath: 'id' });
        const snapshots = db.createObjectStore('snapshots', { keyPath: 'id' });
        snapshots.createIndex('byAccount', 'accountId');
        db.createObjectStore('voids', { keyPath: 'snapshotId' });
        db.createObjectStore('settings', { keyPath: 'id' });
        db.createObjectStore('device', { keyPath: 'id' });
      }
      if (oldVersion < 2) {
        db.createObjectStore('shares', { keyPath: 'id' }); // unused; kept for schema continuity
      }
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

/** A stored order might be missing keys added since (or, in principle, corrupted). */
function sanitizeDashboardOrder(order: unknown): DashboardSectionKey[] {
  const seen = Array.isArray(order)
    ? order.filter((k): k is DashboardSectionKey => DEFAULT_DASHBOARD_ORDER.includes(k as DashboardSectionKey))
    : [];
  const missing = DEFAULT_DASHBOARD_ORDER.filter((k) => !seen.includes(k));
  return [...seen, ...missing];
}

export async function loadDevice(): Promise<DeviceState> {
  const db = await getDB();
  const existing = (await db.get('device', 'device')) as DeviceState | undefined;
  // theme and dashboardOrder were added after v1 shipped — an older device record has neither.
  if (existing) {
    return {
      ...existing,
      theme: existing.theme ?? 'dark',
      dashboardOrder: sanitizeDashboardOrder(existing.dashboardOrder),
    };
  }
  const created: DeviceState = {
    id: 'device',
    deviceId: crypto.randomUUID(),
    lastSyncAt: null,
    lastSyncStateHash: null,
    theme: 'dark',
    dashboardOrder: DEFAULT_DASHBOARD_ORDER,
  };
  await db.put('device', created);
  return created;
}

export async function saveDevice(device: DeviceState): Promise<void> {
  const db = await getDB();
  await db.put('device', device);
}
