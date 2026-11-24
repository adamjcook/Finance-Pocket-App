import { describe, expect, it } from 'vitest';
import { handleRequest, type Env } from '../worker/src/index';
import { b64url, type PushSubscriptionJSON } from '../worker/src/push';
import { parseRegistration, saveRegistration } from '../worker/src/reminders';
import { decryptPayload, encryptPayload, newRelayKey, relayChannel, settleKey } from '../src/sync/relay';
import { buildPayload } from '../src/sync/codec';
import { account, snapshot, state } from './helpers';
import { memoryKV } from './worker/memoryKV';

function env(): Env & { DAYS: ReturnType<typeof memoryKV> } {
  return { DAYS: memoryKV(), T212_API_KEY: 'k', T212_API_SECRET: 's', FINPAIR_TOKEN: 'tok' } as Env & {
    DAYS: ReturnType<typeof memoryKV>;
  };
}

const call = (e: Env, method: string, path: string, body?: unknown, fetchImpl?: typeof fetch) =>
  handleRequest(
    new Request(`https://w.example${path}`, {
      method,
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    e,
    () => new Date('2026-11-24T09:00:00Z'),
    fetchImpl,
  );

const sample = () =>
  buildPayload(
    state({
      accounts: [account({ id: 'card', name: 'Barclaycard' })],
      snapshots: [snapshot({ accountId: 'card', balance: 2150_00 })],
    }),
    'phone-a-1234',
  );

describe('automatic sync encryption', () => {
  it('round-trips a payload, and the stored bytes give nothing away', async () => {
    const key = newRelayKey();
    const sealed = await encryptPayload(key, sample());
    expect(sealed.data).not.toContain('Barclaycard');
    const back = await decryptPayload(key, sealed.iv, sealed.data);
    expect(back.accounts[0].name).toBe('Barclaycard');
    expect(back.snapshots[0].balance).toBe(2150_00);
  });

  it('refuses the wrong key with a plain explanation', async () => {
    const sealed = await encryptPayload(newRelayKey(), sample());
    await expect(decryptPayload(newRelayKey(), sealed.iv, sealed.data)).rejects.toThrow(/different sync key/);
  });

  it('derives a channel that identifies the pair without revealing the key', async () => {
    const key = newRelayKey();
    const channel = await relayChannel(key);
    expect(channel).toMatch(/^[0-9a-f]{32}$/);
    expect(await relayChannel(key)).toBe(channel);
    expect(await relayChannel(newRelayKey())).not.toBe(channel);
    expect(channel).not.toContain(key.slice(0, 8));
  });

  it('two phones that each made a key settle on the same one', () => {
    const a = newRelayKey();
    const b = newRelayKey();
    expect(settleKey(a, b)).toBe(settleKey(b, a));
    expect(settleKey(null, b)).toBe(b);
    expect(settleKey(a, undefined)).toBe(a);
  });
});

describe('Worker relay endpoints', () => {
  const CH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const slot = (deviceId: string, at: string, channel = CH) => ({ channel, deviceId, at, iv: 'aXZpdml2aXZpdml2', data: 'c2VhbGVk' });

  it("keeps one slot per phone and returns only this pair's", async () => {
    const e = env();
    expect((await call(e, 'POST', '/relay', { slot: slot('phone-a-1234', '2026-11-24T08:00:00Z') })).status).toBe(200);
    await call(e, 'POST', '/relay', { slot: slot('phone-b-5678', '2026-11-24T08:05:00Z') });
    await call(e, 'POST', '/relay', { slot: slot('phone-a-1234', '2026-11-24T08:10:00Z') }); // replaces A's
    await call(e, 'POST', '/relay', { slot: slot('dev-phone-9999', '2026-11-24T08:20:00Z', 'b'.repeat(32)) }); // another pair
    const { slots } = (await (await call(e, 'GET', `/relay?channel=${CH}`)).json()) as { slots: { deviceId: string; at: string }[] };
    expect(slots.map((s) => [s.deviceId, s.at]).sort()).toEqual([
      ['phone-a-1234', '2026-11-24T08:10:00Z'],
      ['phone-b-5678', '2026-11-24T08:05:00Z'],
    ]);
  });

  it('needs the access token, and rejects malformed uploads', async () => {
    const e = env();
    const res = await handleRequest(new Request('https://w.example/relay'), e);
    expect(res.status).toBe(401);
    expect((await call(e, 'POST', '/relay', { slot: { ...slot('phone-a-1234', 'x'), data: 'not base64!' } })).status).toBe(400);
    expect((await call(e, 'GET', '/relay')).status).toBe(400); // no channel
  });

  it("tells the partner's phone about an update — not the saving phone, one that opted out, or another pair's", async () => {
    const e = env();
    const sub = async (id: string): Promise<PushSubscriptionJSON> => {
      const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
      const p256dh = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
      return { endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: b64url(p256dh), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) } };
    };
    const subs: Record<string, PushSubscriptionJSON> = {};
    const pairs = [['saver', true, CH], ['partner', true, CH], ['quiet', false, CH], ['dev-phone', true, 'b'.repeat(32)]] as const;
    for (const [id, partner, channel] of pairs) {
      subs[id] = await sub(id);
      await saveRegistration(
        e.DAYS,
        parseRegistration({ subscription: subs[id], prefs: { monthly: true, promo: true, drop: true, partner }, channel }, new Date()),
      );
    }
    const urls: string[] = [];
    const fakePush = (async (url: RequestInfo | URL) => {
      urls.push(String(url));
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    const res = await call(
      e,
      'POST',
      '/relay',
      {
        slot: slot('phone-a-1234', '2026-11-24T08:00:00Z'),
        notify: { title: 'Adam just updated the balances', body: 'Open FinPair', exceptEndpoint: subs.saver.endpoint },
      },
      fakePush,
    );
    expect(await res.json()).toEqual({ ok: true, notified: 1 });
    expect(urls).toEqual([subs.partner.endpoint]);
  });
});
