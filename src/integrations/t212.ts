import type { Snapshot, SyncedState, T212Link, T212Reading } from '../model/types';
import { getStore, mutate, patchDevice } from '../model/store';
import { toDay } from '../logic/progress';
import { APP_NAME } from '../appName';

/**
 * Trading 212 daily readings → balance entries on the linked account.
 *
 * The finpair-t212 Worker (worker/src/index.ts) records the account's total
 * at 9pm UK time each day. When the app opens it asks the Worker for any days
 * it hasn't seen and adds them as ordinary snapshots.
 *
 * Each snapshot's id, time, createdAt and deviceId all derive from the
 * reading itself, so both phones importing the same reading create the very
 * same record — the sync's union-by-id merge then keeps one copy, and the
 * check codes still match. A provisional daytime reading and that evening's
 * final one have different times, so both are kept and the later one counts
 * for the day, exactly like two manual updates on one day.
 */

const SOURCE = 't212';
/** Don't re-ask the Worker more often than this when the app is reopened. */
const MIN_INTERVAL_MS = 5 * 60 * 1000;

interface WorkerStatus {
  ok: boolean;
  at: string;
  error?: string;
}

export function snapshotIdFor(accountId: string, readingAt: string): string {
  return `${SOURCE}:${accountId}:${readingAt}`;
}

export function isAutoSnapshot(s: Snapshot): boolean {
  return s.deviceId === SOURCE;
}

/** Add the readings that aren't already recorded. Pure; returns `state` unchanged if nothing is new. */
export function importReadings(state: SyncedState, link: T212Link, readings: T212Reading[]): SyncedState {
  if (!state.accounts.some((a) => a.id === link.accountId)) return state;
  const have = new Set(state.snapshots.map((s) => s.id));
  const added: Snapshot[] = [];
  for (const r of readings) {
    const id = snapshotIdFor(link.accountId, r.at);
    if (have.has(id)) continue;
    have.add(id);
    added.push({ id, accountId: link.accountId, balance: r.totalMinor, at: r.at, deviceId: SOURCE, createdAt: r.at });
  }
  return added.length ? { ...state, snapshots: [...state.snapshots, ...added] } : state;
}

/** The day to ask the Worker from: the latest imported reading's day (re-fetched, as it may have been provisional). */
export function sinceDay(state: SyncedState, link: T212Link): string | null {
  let latest: string | null = null;
  for (const s of state.snapshots) {
    if (s.accountId === link.accountId && isAutoSnapshot(s) && (!latest || s.at > latest)) latest = s.at;
  }
  return latest ? toDay(latest) : null;
}

function url(link: T212Link, path: string): string {
  return `${link.endpoint.trim().replace(/\/+$/, '')}${path}`;
}

/** Call the finpair-t212 Worker (also used for reminders — see push.ts). */
export async function call<T>(link: T212Link, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url(link, path), {
      ...init,
      headers: {
        Authorization: `Bearer ${link.token.trim()}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      cache: 'no-store',
    });
  } catch {
    throw new Error("Couldn't reach the Worker — check its address, or that you're online.");
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `The Trading 212 link returned HTTP ${res.status}.`);
  return body;
}

/** Worker address and token are filled in (enough for reminders, which don't need an account). */
export function workerReady(link: T212Link | null | undefined): link is T212Link {
  return !!link && /^https?:\/\//.test(link.endpoint.trim()) && !!link.token.trim();
}

export function linkReady(link: T212Link | null | undefined): link is T212Link {
  return !!link && !!link.accountId && /^https?:\/\//.test(link.endpoint.trim()) && !!link.token.trim();
}

function rejectWrongCurrency(readings: T212Reading[], currency: string) {
  const wrong = readings.find((r) => r.currency !== currency);
  if (wrong) {
    throw new Error(
      `Trading 212 reports in ${wrong.currency} but ${APP_NAME} is set to ${currency} — readings weren't added.`,
    );
  }
}

async function record(readings: T212Reading[], workerStatus: WorkerStatus | null) {
  const { state } = getStore();
  const link = state.settings.t212;
  if (!linkReady(link)) return;
  rejectWrongCurrency(readings, state.settings.currency);
  await mutate((s) => importReadings(s, link, readings));
  const latest = readings.length ? readings[readings.length - 1] : (getStore().device.t212?.latest ?? null);
  await patchDevice({
    t212: {
      checkedAt: new Date().toISOString(),
      error: workerStatus && !workerStatus.ok ? (workerStatus.error ?? 'The last scheduled reading failed.') : null,
      latest,
    },
  });
}

async function fail(err: unknown): Promise<never> {
  // fetch() rejects with a bare TypeError ("Failed to fetch") when the Worker
  // can't be reached at all; say what that means instead.
  const message =
    err instanceof TypeError
      ? "Couldn't reach your Worker. Check the address, and that this phone is online."
      : err instanceof Error
        ? err.message
        : String(err);
  await patchDevice({
    t212: { checkedAt: new Date().toISOString(), error: message, latest: getStore().device.t212?.latest ?? null },
  });
  throw err;
}

let inFlight: Promise<void> | null = null;

/**
 * Fetch and import new readings. Throttled unless `force` (the Settings
 * "Check now" button). Never throws when called in the background.
 */
export function pullReadings({ force = false } = {}): Promise<void> {
  const { state, device } = getStore();
  const link = state.settings.t212;
  if (!linkReady(link)) return Promise.resolve();
  const last = device.t212?.checkedAt ? Date.parse(device.t212.checkedAt) : 0;
  if (!force && Date.now() - last < MIN_INTERVAL_MS) return Promise.resolve();
  inFlight ??= (async () => {
    try {
      const since = sinceDay(state, link);
      const body = await call<{ readings: T212Reading[]; status: WorkerStatus | null }>(
        link,
        `/days${since ? `?since=${since}` : ''}`,
      );
      await record(body.readings, body.status);
    } catch (err) {
      await fail(err);
    } finally {
      inFlight = null;
    }
  })();
  return force ? inFlight : inFlight.catch(() => undefined);
}

/** Ask the Worker to take a reading right now (Settings → "Read now"). */
export async function readingNow(): Promise<T212Reading> {
  const link = getStore().state.settings.t212;
  if (!linkReady(link)) throw new Error('Finish setting up the Trading 212 link first.');
  try {
    const { reading } = await call<{ reading: T212Reading }>(link, '/refresh', { method: 'POST' });
    await record([reading], null);
    return reading;
  } catch (err) {
    return fail(err);
  }
}
