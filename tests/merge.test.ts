import { describe, expect, it } from 'vitest';
import { canonicalStateString, mergeState, stateHash, summarizeMerge } from '../src/logic/merge';
import type { SyncedState } from '../src/model/types';
import { account, alias, settings, snapshot, state } from './helpers';

describe('mergeState', () => {
  it('takes the newer record under last-write-wins', () => {
    const old = account({ id: 'acc-1', name: 'Old name', updatedAt: '2026-01-01T00:00:00.000Z' });
    const newer = { ...old, name: 'New name', updatedAt: '2026-02-01T00:00:00.000Z' };
    const a = state({ accounts: [old] });
    const b = state({ accounts: [newer] });
    expect(mergeState(a, b).accounts[0].name).toBe('New name');
    expect(mergeState(b, a).accounts[0].name).toBe('New name');
  });

  it('breaks updatedAt ties by deviceId so both directions agree', () => {
    const base = account({ id: 'acc-1' });
    const fromA = { ...base, name: 'A version', updatedBy: 'device-a' };
    const fromB = { ...base, name: 'B version', updatedBy: 'device-b' };
    const a = state({ accounts: [fromA] });
    const b = state({ accounts: [fromB] });
    expect(mergeState(a, b).accounts[0].name).toBe('B version');
    expect(mergeState(b, a).accounts[0].name).toBe('B version');
  });

  it('inserts records missing on one side', () => {
    const onlyA = account({ id: 'acc-a' });
    const onlyB = account({ id: 'acc-b' });
    const merged = mergeState(state({ accounts: [onlyA] }), state({ accounts: [onlyB] }));
    expect(merged.accounts.map((x) => x.id).sort()).toEqual(['acc-a', 'acc-b']);
  });

  it('propagates archival (tombstone) via LWW', () => {
    const live = account({ id: 'acc-1', archived: false });
    const archived = { ...live, archived: true, updatedAt: '2026-03-01T00:00:00.000Z' };
    const merged = mergeState(state({ accounts: [live] }), state({ accounts: [archived] }));
    expect(merged.accounts[0].archived).toBe(true);
  });

  it('unions snapshots and voids by id', () => {
    const s1 = snapshot({ id: 'snap-1' });
    const s2 = snapshot({ id: 'snap-2' });
    const a = state({ snapshots: [s1], voids: [{ snapshotId: 'snap-1', at: s1.at, deviceId: 'device-a' }] });
    const b = state({ snapshots: [s1, s2] });
    const merged = mergeState(a, b);
    expect(merged.snapshots).toHaveLength(2);
    expect(merged.voids).toHaveLength(1);
  });

  it('merges settings whole-record LWW', () => {
    const a = state({ settings: settings({ partnerAName: 'Sam', updatedAt: '2026-01-01T00:00:00.000Z' }) });
    const b = state({ settings: settings({ partnerAName: 'Samantha', updatedAt: '2026-01-02T00:00:00.000Z' }) });
    expect(mergeState(a, b).settings.partnerAName).toBe('Samantha');
    expect(mergeState(b, a).settings.partnerAName).toBe('Samantha');
  });

  it('is commutative and idempotent on randomized states', async () => {
    const rand = mulberry32(42);
    for (let trial = 0; trial < 25; trial++) {
      const [a, b] = [randomState(rand), randomState(rand)];
      const ab = mergeState(a, b);
      const ba = mergeState(b, a);
      expect(canonicalStateString(ab)).toBe(canonicalStateString(ba));
      expect(canonicalStateString(mergeState(ab, b))).toBe(canonicalStateString(ab));
      expect(canonicalStateString(mergeState(ab, ab))).toBe(canonicalStateString(ab));
      expect(await stateHash(ab)).toBe(await stateHash(ba));
    }
  });

  it('summarizes what a merge brought in', () => {
    const before = state({ snapshots: [snapshot({ id: 'snap-1' })] });
    const incoming = state({ snapshots: [snapshot({ id: 'snap-2' }), snapshot({ id: 'snap-3' })] });
    const after = mergeState(before, incoming);
    const summary = summarizeMerge(before, after);
    expect(summary.newSnapshots).toBe(2);
  });
});

describe('stateHash', () => {
  it('is order-insensitive and content-sensitive', async () => {
    const s1 = snapshot({ id: 'snap-1' });
    const s2 = snapshot({ id: 'snap-2' });
    const a = state({ snapshots: [s1, s2] });
    const b = state({ snapshots: [s2, s1] });
    expect(await stateHash(a)).toBe(await stateHash(b));
    const c = state({ snapshots: [s1] });
    expect(await stateHash(a)).not.toBe(await stateHash(c));
  });
});

// deterministic PRNG for the property test
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomState(rand: () => number): SyncedState {
  const sharedIds = ['acc-1', 'acc-2', 'acc-3', 'acc-4'];
  const accounts = sharedIds
    .filter(() => rand() > 0.3)
    .map((id) =>
      account({
        id,
        name: `Name ${Math.floor(rand() * 5)}`,
        archived: rand() > 0.8,
        updatedAt: new Date(1700000000000 + Math.floor(rand() * 5) * 86400000).toISOString(),
        updatedBy: rand() > 0.5 ? 'device-a' : 'device-b',
      }),
    );
  // Snapshots are append-only: a given id always names the same record, so
  // content must be a pure function of the id (as in the real app, where ids
  // are UUIDs minted once).
  const snapshots = Array.from({ length: Math.floor(rand() * 6) }, () => {
    const n = Math.floor(rand() * 10);
    return snapshot({
      id: `snap-${n}`,
      accountId: sharedIds[n % sharedIds.length],
      balance: n * 1111,
    });
  });
  const aliases =
    rand() > 0.5 ? [alias({ id: 'alias-1', accountId: sharedIds[0], updatedBy: rand() > 0.5 ? 'device-a' : 'device-b' })] : [];
  return state({ accounts, snapshots, aliases });
}
