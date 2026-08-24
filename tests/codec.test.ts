import { describe, expect, it } from 'vitest';
import {
  buildPayload,
  decodeFrames,
  encodePayload,
  FrameCollector,
  parseFrame,
} from '../src/sync/codec';
import { account, snapshot, state } from './helpers';
import type { SyncedState } from '../src/model/types';

function bigState(): SyncedState {
  const accounts = Array.from({ length: 8 }, (_, i) => account({ id: `acc-${i}` }));
  const snapshots = Array.from({ length: 400 }, (_, i) =>
    snapshot({
      id: crypto.randomUUID(),
      accountId: `acc-${i % 8}`,
      balance: 1000_00 + i * 37,
      at: new Date(1735689600000 + i * 86400000).toISOString(),
    }),
  );
  return state({ accounts, snapshots });
}

describe('codec', () => {
  it('round-trips a payload through frames', async () => {
    const payload = buildPayload(state({ accounts: [account()] }), 'device-a');
    const frames = await encodePayload(payload);
    expect(frames.length).toBeGreaterThanOrEqual(1);
    const decoded = await decodeFrames(frames);
    expect(decoded).toEqual(payload);
  });

  it('produces multiple frames for a year of data and reassembles out of order', async () => {
    const payload = buildPayload(bigState(), 'device-a');
    const frames = await encodePayload(payload);
    expect(frames.length).toBeGreaterThan(1);
    // QR-friendly frame size
    for (const f of frames) expect(f.length).toBeLessThan(900);
    const shuffled = [...frames].reverse();
    const decoded = await decodeFrames(shuffled);
    expect(decoded).toEqual(payload);
  });

  it('ignores garbage and duplicate frames', async () => {
    const payload = buildPayload(state({ accounts: [account()] }), 'device-a');
    const frames = await encodePayload(payload);
    const collector = new FrameCollector();
    expect(collector.add('https://example.com/not-a-frame')).toBe(false);
    expect(collector.add(frames[0])).toBe(true);
    expect(collector.add(frames[0])).toBe(false); // duplicate
    for (const f of frames.slice(1)) collector.add(f);
    expect(collector.isComplete()).toBe(true);
    expect(await collector.result()).toEqual(payload);
  });

  it('rejects a corrupted blob via crc', async () => {
    const payload = buildPayload(bigState(), 'device-a');
    const frames = await encodePayload(payload);
    const parts = frames[1].split(':');
    // corrupt the data but keep the frame syntactically valid
    parts[5] = parts[5].slice(0, -4) + (parts[5].endsWith('AAAA') ? 'BBBB' : 'AAAA');
    const collector = new FrameCollector();
    collector.add(frames[0]);
    collector.add(parts.join(':'));
    for (const f of frames.slice(2)) collector.add(f);
    expect(collector.isComplete()).toBe(true);
    await expect(collector.result()).rejects.toThrow(/integrity/);
  });

  it('restarts on a new transmission id (stale frames dropped)', async () => {
    const payloadOld = buildPayload(bigState(), 'device-a');
    const payloadNew = buildPayload(bigState(), 'device-a');
    const oldFrames = await encodePayload(payloadOld);
    const newFrames = await encodePayload(payloadNew);
    const collector = new FrameCollector();
    collector.add(oldFrames[0]);
    collector.add(oldFrames[1]);
    collector.add(newFrames[0]); // sender restarted
    expect(collector.received()).toBe(1);
    for (const f of newFrames.slice(1)) collector.add(f);
    expect(await collector.result()).toEqual(payloadNew);
  });

  it('rejects unknown payload versions with a clear message', async () => {
    const payload = { ...buildPayload(state(), 'device-a'), v: 99 as unknown as 1 };
    const frames = await encodePayload(payload);
    await expect(decodeFrames(frames)).rejects.toThrow(/version/i);
  });

  it('parses and rejects malformed frames', () => {
    expect(parseFrame('FP1:abcd:0:1:00000000:AAAA')).not.toBeNull();
    expect(parseFrame('FP2:abcd:0:1:00000000:AAAA')).toBeNull();
    expect(parseFrame('FP1:abcd:5:2:00000000:AAAA')).toBeNull(); // seq >= total
    expect(parseFrame('FP1:abcd:x:1:00000000:AAAA')).toBeNull();
    expect(parseFrame('random text')).toBeNull();
  });
});
