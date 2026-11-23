import { describe, expect, it } from 'vitest';
import { importReadings, isAutoSnapshot, sinceDay, snapshotIdFor } from '../src/integrations/t212';
import { mergeState, stateHash } from '../src/logic/merge';
import { combinedDailySeries, effectiveSnapshots } from '../src/logic/progress';
import type { T212Link, T212Reading } from '../src/model/types';
import { account, snapshot, state } from './helpers';

const isa = account({ id: 'isa', name: 'T212 ISA', kind: 'investment' });
const link: T212Link = { accountId: 'isa', endpoint: 'https://w.example', token: 'tok' };

function reading(at: string, totalMinor: number, final = true): T212Reading {
  return { day: at.slice(0, 10), at, currency: 'GBP', totalMinor, costMinor: 900000, unrealisedMinor: 100000, final };
}

const R1 = reading('2026-11-21T21:00:00.000Z', 1000000);
const R2 = reading('2026-11-22T21:00:00.000Z', 1012000);

describe('importReadings', () => {
  it('adds readings as snapshots on the linked account, once each', () => {
    const s0 = state({ accounts: [isa] });
    const s1 = importReadings(s0, link, [R1, R2]);
    expect(s1.snapshots).toHaveLength(2);
    expect(s1.snapshots[0]).toEqual({
      id: snapshotIdFor('isa', R1.at),
      accountId: 'isa',
      balance: 1000000,
      at: R1.at,
      deviceId: 't212',
      createdAt: R1.at,
    });
    expect(s1.snapshots.every(isAutoSnapshot)).toBe(true);
    // Re-importing the same readings changes nothing (same object back).
    expect(importReadings(s1, link, [R1, R2])).toBe(s1);
  });

  it('ignores readings when the linked account no longer exists', () => {
    const s0 = state({ accounts: [] });
    expect(importReadings(s0, link, [R1])).toBe(s0);
  });

  it('two phones importing the same readings converge on identical state', async () => {
    const manual = snapshot({ id: 'm1', accountId: 'isa', balance: 990000, at: '2026-11-20T09:00:00.000Z' });
    const base = state({ accounts: [isa], snapshots: [manual] });
    const phoneA = importReadings(base, link, [R1, R2]);
    const phoneB = importReadings(importReadings(base, link, [R2]), link, [R1]);
    const merged = mergeState(phoneA, phoneB);
    expect(merged.snapshots).toHaveLength(3);
    expect(await stateHash(mergeState(phoneA, phoneB))).toBe(await stateHash(mergeState(phoneB, phoneA)));
    expect(await stateHash(phoneA)).toBe(await stateHash(phoneB));
  });

  it("a provisional daytime reading is superseded by that evening's final one", () => {
    const midday = reading('2026-11-22T12:00:00.000Z', 1005000, false);
    const s = importReadings(state({ accounts: [isa] }), link, [R1, midday, R2]);
    const series = combinedDailySeries(effectiveSnapshots(s.snapshots, s.voids), '2026-11-22');
    expect(series.map((p) => p.value)).toEqual([1000000, 1012000]);
  });
});

describe('sinceDay', () => {
  it('starts from the latest imported reading, ignoring manual entries', () => {
    const manual = snapshot({ id: 'm1', accountId: 'isa', balance: 1, at: '2026-11-25T09:00:00.000Z' });
    expect(sinceDay(state({ accounts: [isa] }), link)).toBeNull();
    const s = importReadings(state({ accounts: [isa], snapshots: [manual] }), link, [R1, R2]);
    expect(sinceDay(s, link)).toBe('2026-11-22');
  });
});
