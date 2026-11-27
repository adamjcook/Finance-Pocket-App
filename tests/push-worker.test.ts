import { describe, expect, it } from 'vitest';
import { handleRequest, onSchedule, type Env, type Reading } from '../worker/src/index';
import {
  b64url,
  concat,
  encryptPayload,
  fromB64url,
  hkdf,
  sendPush,
  vapidAuthorization,
  vapidKeys,
  type PushSubscriptionJSON,
} from '../worker/src/push';
import {
  dailyReminders,
  paydayReminder,
  dropCheck,
  parseRegistration,
  promoMessages,
  saveRegistration,
  weeklyChange,
  type Registration,
} from '../worker/src/reminders';
import { memoryKV } from './worker/memoryKV';

const enc = new TextEncoder();
const buf = (u: Uint8Array) => u as Uint8Array<ArrayBuffer>;

/** A pretend browser push subscription, with the private key needed to decrypt what it receives. */
async function fakeBrowser(endpoint = 'https://fcm.googleapis.com/fcm/send/abc') {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const p256dh = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const subscription: PushSubscriptionJSON = { endpoint, keys: { p256dh: b64url(p256dh), auth: b64url(auth) } };

  /** Decrypt an aes128gcm body the way the browser does (RFC 8291 / RFC 8188). */
  async function decrypt(body: Uint8Array): Promise<string> {
    const salt = body.slice(0, 16);
    const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
    const idlen = body[20];
    const senderPublic = body.slice(21, 21 + idlen);
    const ciphertext = body.slice(21 + idlen);
    expect(rs).toBe(4096);
    expect(idlen).toBe(65);
    const senderKey = await crypto.subtle.importKey('raw', buf(senderPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: senderKey }, pair.privateKey, 256));
    const ikm = await hkdf(auth, ecdh, concat(enc.encode('WebPush: info\0'), p256dh, senderPublic), 32);
    const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
    const key = await crypto.subtle.importKey('raw', buf(cek), 'AES-GCM', false, ['decrypt']);
    const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(nonce) }, key, buf(ciphertext)));
    expect(padded[padded.length - 1]).toBe(2); // last-record delimiter
    return new TextDecoder().decode(padded.slice(0, -1));
  }
  return { subscription, decrypt };
}

/** A pretend push service: records what it was sent. */
function fakePushService(status = 201) {
  const sent: { url: string; headers: Headers; body: Uint8Array }[] = [];
  const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(url), headers: new Headers(init?.headers), body: new Uint8Array(init!.body as ArrayBuffer) });
    return new Response(null, { status });
  }) as typeof fetch;
  return { impl, sent };
}

function env(): Env & { DAYS: ReturnType<typeof memoryKV> } {
  return { DAYS: memoryKV(), T212_API_KEY: 'k', T212_API_SECRET: 's', FINPAIR_TOKEN: 'tok' } as Env & {
    DAYS: ReturnType<typeof memoryKV>;
  };
}

async function register(e: Env, subscription: PushSubscriptionJSON, extra: Partial<Registration> = {}) {
  await saveRegistration(e.DAYS, {
    ...parseRegistration({ subscription, prefs: { monthly: true, promo: true, drop: true } }, new Date()),
    ...extra,
  });
}

describe('push encryption (RFC 8291)', () => {
  it('produces a body only the subscribing browser can decrypt', async () => {
    const browser = await fakeBrowser();
    const body = await encryptPayload(browser.subscription, enc.encode('{"title":"hello"}'));
    expect(await browser.decrypt(body)).toBe('{"title":"hello"}');
    // A different browser can't read it.
    const other = await fakeBrowser();
    await expect(other.decrypt(body)).rejects.toThrow();
  });

  it('rejects malformed subscription keys', async () => {
    const browser = await fakeBrowser();
    const bad = { ...browser.subscription, keys: { ...browser.subscription.keys, auth: 'AAAA' } };
    await expect(encryptPayload(bad, enc.encode('x'))).rejects.toThrow(/Malformed/);
  });
});

describe('VAPID (RFC 8292)', () => {
  it('creates the key pair once and signs a JWT for the push service origin', async () => {
    const kv = memoryKV();
    const keys = await vapidKeys(kv);
    expect(await vapidKeys(kv)).toEqual(keys); // stable across calls
    expect(fromB64url(keys.publicKey)).toHaveLength(65);

    const now = new Date('2026-11-24T09:00:00Z');
    const header = await vapidAuthorization(keys, 'https://fcm.googleapis.com/fcm/send/abc', now);
    const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, sig] = jwt.split('.');
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(c)));
    expect(claims).toMatchObject({ aud: 'https://fcm.googleapis.com', exp: now.getTime() / 1000 + 12 * 3600 });
    const pub = await crypto.subtle.importKey('raw', buf(fromB64url(keys.publicKey)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, buf(fromB64url(sig)), enc.encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });
});

describe('sendPush', () => {
  it('posts an encrypted, signed message to the subscription endpoint', async () => {
    const kv = memoryKV();
    const browser = await fakeBrowser();
    const push = fakePushService();
    const msg = { title: 'T', body: 'B', tag: 'x', url: '#/' };
    expect(await sendPush(kv, browser.subscription, msg, new Date(), push.impl)).toBe('sent');
    const [req] = push.sent;
    expect(req.url).toBe(browser.subscription.endpoint);
    expect(req.headers.get('Content-Encoding')).toBe('aes128gcm');
    expect(req.headers.get('TTL')).toBe('86400');
    expect(req.headers.get('Authorization')).toMatch(/^vapid t=.+, k=.+$/);
    expect(JSON.parse(await browser.decrypt(req.body))).toEqual(msg);
  });

  it("reports 'gone' when the phone has unsubscribed", async () => {
    const browser = await fakeBrowser();
    expect(await sendPush(memoryKV(), browser.subscription, { title: '', body: '', tag: '', url: '' }, new Date(), fakePushService(410).impl)).toBe('gone');
  });
});

describe('daily reminders', () => {
  it('sends the payday reminder on payday, once, and only to phones that want it', async () => {
    const e = env();
    const wants = await fakeBrowser('https://push.example/a');
    const doesnt = await fakeBrowser('https://push.example/b');
    await register(e, wants.subscription);
    await register(e, doesnt.subscription, { prefs: { monthly: false, promo: true, drop: true } });
    const push = fakePushService();
    // The 9am run on payday doesn't send it: pay isn't in until 4pm.
    expect(await dailyReminders(e, new Date('2026-11-27T09:00:00Z'), push.impl)).toBe(0);
    const payday = new Date('2026-11-27T16:30:00Z'); // Friday 27 Nov (last working day Mon 30th), 4:30pm GMT
    expect(await paydayReminder(e, payday, push.impl)).toBe(1);
    expect(push.sent[0].url).toBe('https://push.example/a');
    expect(JSON.parse(await wants.decrypt(push.sent[0].body))).toMatchObject({ tag: 'monthly', url: '#/update' });
    // A second run the same day does nothing.
    expect(await paydayReminder(e, payday, push.impl)).toBe(0);
    // The last working day itself is not payday: nothing.
    expect(await paydayReminder(e, new Date('2026-11-30T16:30:00Z'), push.impl)).toBe(0);
  });

  it('warns 30, 7 and 1 days before a 0% deal ends, and on the day', () => {
    const promos = [{ name: 'M&S Card', endsOn: '2027-03-01' }];
    const on = (day: string) => promoMessages(promos, day).map((m) => m.title);
    expect(on('2027-01-30')).toEqual(['0% deal ends in 30 days']);
    expect(on('2027-02-22')).toEqual(['0% deal ends in a week']);
    expect(on('2027-02-28')).toEqual(['0% deal ends tomorrow']);
    expect(on('2027-03-01')).toEqual(['0% deal ends today']);
    expect(on('2027-02-20')).toEqual([]);
  });

  it('forgets a phone whose subscription has gone', async () => {
    const e = env();
    const browser = await fakeBrowser();
    await register(e, browser.subscription);
    await paydayReminder(e, new Date('2026-11-27T16:30:00Z'), fakePushService(410).impl);
    expect([...e.DAYS.data.keys()].some((k) => k.startsWith('sub:'))).toBe(false);
  });
});

describe('weekly drop check (after the 9pm reading)', () => {
  const reading = (day: string, totalMinor: number): Reading => ({
    day, at: `${day}T21:00:00.000Z`, currency: 'GBP', totalMinor, costMinor: 0, unrealisedMinor: 0, final: true,
  });

  it('compares the latest reading with the latest one at least a week older', () => {
    const w = weeklyChange([reading('2026-11-10', 1000000), reading('2026-11-16', 1010000), reading('2026-11-17', 990000), reading('2026-11-23', 940500)]);
    expect(w?.from.day).toBe('2026-11-16');
    expect(w?.change).toBeCloseTo(-0.0688, 3);
    expect(weeklyChange([reading('2026-11-20', 1), reading('2026-11-23', 1)])).toBeNull();
  });

  it('alerts at a 5%+ fall, at most once a week, naming the account', async () => {
    const e = env();
    const browser = await fakeBrowser();
    await register(e, browser.subscription, { t212Name: 'T212 ISA' });
    const put = (r: Reading) => e.DAYS.put(`day:${r.day}`, JSON.stringify(r), { metadata: r });
    await put(reading('2026-11-16', 1000000));
    await put(reading('2026-11-23', 960000)); // −4%: no alert
    const push = fakePushService();
    expect(await dropCheck(e, new Date(), push.impl)).toBe(0);

    await put(reading('2026-11-24', 940000)); // −6% vs 16 Nov... but 24−16 = 8 days, from = 16th
    expect(await dropCheck(e, new Date(), push.impl)).toBe(1);
    const msg = JSON.parse(await browser.decrypt(push.sent[0].body));
    expect(msg.title).toBe('T212 ISA is down 6.0% this week');
    expect(msg.body).toContain('£10,000.00');

    await put(reading('2026-11-25', 900000)); // still down, but alerted 1 day ago
    expect(await dropCheck(e, new Date(), push.impl)).toBe(0);
  });
});

describe('push endpoints', () => {
  const req = (path: string, body?: unknown) =>
    new Request(`https://w${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it('serves the public key, registers a phone, sends a test, and unregisters', async () => {
    const e = env();
    const browser = await fakeBrowser();
    const key = (await (await handleRequest(req('/push/key'), e)).json()) as { publicKey: string };
    expect(fromB64url(key.publicKey)).toHaveLength(65);

    const notYet = await handleRequest(req('/push/test', { endpoint: browser.subscription.endpoint }), e);
    expect(notYet.status).toBe(404);

    const reg = await handleRequest(
      req('/push/subscribe', { subscription: browser.subscription, prefs: { monthly: true, promo: false, drop: true }, promos: [{ name: 'Card', endsOn: '2027-03-01' }, { name: 'bad', endsOn: 'soon' }] }),
      e,
    );
    expect(reg.status).toBe(200);

    const push = fakePushService();
    const test = await handleRequest(req('/push/test', { endpoint: browser.subscription.endpoint }), e, () => new Date(), push.impl);
    expect(test.status).toBe(200);
    expect(JSON.parse(await browser.decrypt(push.sent[0].body)).title).toBe('MC Bank reminders are on');

    await handleRequest(req('/push/unsubscribe', { endpoint: browser.subscription.endpoint }), e);
    expect((await handleRequest(req('/push/test', { endpoint: browser.subscription.endpoint }), e)).status).toBe(404);
  });

  it('rejects a registration that isn’t an https push subscription', async () => {
    const res = await handleRequest(req('/push/subscribe', { subscription: { endpoint: 'http://x', keys: {} } }), env());
    expect(res.status).toBe(400);
  });

  it('needs the access token', async () => {
    const res = await handleRequest(new Request('https://w/push/key'), env());
    expect(res.status).toBe(401);
  });
});

describe('cron routing', () => {
  it('runs reminders at 9am UK in both GMT and BST, and nothing at other hours', async () => {
    const e = env();
    const push = fakePushService();
    expect(await onSchedule(e, new Date('2026-12-01T09:00:00Z'), push.impl)).toBe('reminded'); // GMT
    expect(await onSchedule(e, new Date('2026-07-01T08:00:00Z'), push.impl)).toBe('reminded'); // BST
    expect(await onSchedule(e, new Date('2026-12-01T08:00:00Z'), push.impl)).toBe('skipped'); // 8am GMT
  });

  it('runs the payday reminder at 4:30pm UK in both GMT and BST', async () => {
    const e = env();
    const push = fakePushService();
    expect(await onSchedule(e, new Date('2026-11-27T16:30:00Z'), push.impl)).toBe('reminded'); // GMT
    expect(await onSchedule(e, new Date('2026-07-30T15:30:00Z'), push.impl)).toBe('reminded'); // BST
    expect(await onSchedule(e, new Date('2026-11-27T15:30:00Z'), push.impl)).toBe('skipped'); // 3:30pm GMT
  });
});
