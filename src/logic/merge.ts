import type { Meta, Snapshot, SnapshotVoid, SyncedState } from '../model/types';

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/**
 * True when `b` should win over `a` under last-write-wins.
 * Ties on updatedAt are broken by updatedBy (deviceId), and — for the
 * pathological case of two same-millisecond edits by the same device — by
 * record content, so the merge is commutative: both phones pick the same
 * winner whichever direction they merge.
 */
function newer(a: Meta, b: Meta): boolean {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt > a.updatedAt;
  if (a.updatedBy !== b.updatedBy) return b.updatedBy > a.updatedBy;
  return stableStringify(b) > stableStringify(a);
}

function lwwById<T extends Meta & { id: string }>(local: T[], remote: T[]): T[] {
  const byId = new Map<string, T>();
  for (const r of local) byId.set(r.id, r);
  for (const r of remote) {
    const existing = byId.get(r.id);
    if (!existing || newer(existing, r)) byId.set(r.id, r);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function unionSnapshots(local: Snapshot[], remote: Snapshot[]): Snapshot[] {
  const byId = new Map<string, Snapshot>();
  for (const s of local) byId.set(s.id, s);
  for (const s of remote) if (!byId.has(s.id)) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function unionVoids(local: SnapshotVoid[], remote: SnapshotVoid[]): SnapshotVoid[] {
  const byId = new Map<string, SnapshotVoid>();
  for (const v of local) byId.set(v.snapshotId, v);
  for (const v of remote) if (!byId.has(v.snapshotId)) byId.set(v.snapshotId, v);
  return [...byId.values()].sort((a, b) => a.snapshotId.localeCompare(b.snapshotId));
}

/**
 * Merge two synced states. Pure, commutative, and idempotent:
 * merge(a, b) deep-equals merge(b, a), and merge(a, a) === a (canonical order).
 */
export function mergeState(local: SyncedState, remote: SyncedState): SyncedState {
  return {
    settings: newer(local.settings, remote.settings) ? remote.settings : local.settings,
    accounts: lwwById(local.accounts, remote.accounts),
    aliases: lwwById(local.aliases, remote.aliases),
    snapshots: unionSnapshots(local.snapshots, remote.snapshots),
    voids: unionVoids(local.voids, remote.voids),
  };
}

export interface MergeSummary {
  newSnapshots: number;
  newVoids: number;
  accountsChanged: number;
  aliasesChanged: number;
  settingsChanged: boolean;
}

/** Human-readable diff of what a merge brought in, for the sync screen. */
export function summarizeMerge(before: SyncedState, after: SyncedState): MergeSummary {
  const count = <T>(a: T[], b: T[], key: (x: T) => string) => {
    const seen = new Map(a.map((x) => [key(x), JSON.stringify(x)]));
    let n = 0;
    for (const x of b) if (seen.get(key(x)) !== JSON.stringify(x)) n++;
    return n;
  };
  return {
    newSnapshots: count(before.snapshots, after.snapshots, (s) => s.id),
    newVoids: count(before.voids, after.voids, (v) => v.snapshotId),
    accountsChanged: count(before.accounts, after.accounts, (a) => a.id),
    aliasesChanged: count(before.aliases, after.aliases, (a) => a.id),
    settingsChanged: JSON.stringify(before.settings) !== JSON.stringify(after.settings),
  };
}

/** Canonical serialization: arrays in stable id order, keys sorted. */
export function canonicalStateString(state: SyncedState): string {
  return stableStringify(mergeState(state, state)); // self-merge normalizes ordering
}

/** Short convergence check code both phones can compare after a sync. */
export async function stateHash(state: SyncedState): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalStateString(state));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const view = new DataView(digest);
  // 6 base36 chars from the first 40 bits
  let n = view.getUint32(0) * 256 + view.getUint8(4);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out = '0123456789abcdefghijklmnopqrstuvwxyz'[n % 36] + out;
    n = Math.floor(n / 36);
  }
  return out;
}
