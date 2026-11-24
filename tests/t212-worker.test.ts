import { describe, expect, it } from 'vitest';
import {
  fetchReading,
  handleRequest,
  onSchedule,
  ukTime,
  type Env,
  type Reading,
} from '../worker/src/index';
import { memoryKV } from './worker/memoryKV';

const SUMMARY = {
  id: 12345678,
  currency: 'GBP',
  totalValue: 10234.56,
  cash: { availableToTrade: 120.5, inPies: 14.06, reservedForOrders: 0 },
  investments: { currentValue: 10100, totalCost: 9000, realizedProfitLoss: 50, unrealizedProfitLoss: 1100 },
};

function fakeT212(body: unknown = SUMMARY, status = 200) {
  const calls: { url: string; auth: string | null }[] = [];
  const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), auth: new Headers(init?.headers).get('Authorization') });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { impl, calls };
}

function env(overrides: Partial<Env> = {}): Env & { DAYS: ReturnType<typeof memoryKV> } {
  return {
    DAYS: memoryKV(),
    T212_API_KEY: 'key',
    T212_API_SECRET: 'secret',
    FINPAIR_TOKEN: 'tok',
    ALLOWED_ORIGINS: 'https://adamjcook.github.io',
    ...overrides,
  } as Env & { DAYS: ReturnType<typeof memoryKV> };
}

// 2026-11-23 is GMT; 2026-07-01 is BST.
const WINTER_9PM = new Date('2026-11-23T21:00:00Z');
const SUMMER_9PM = new Date('2026-07-01T20:00:00Z');

describe('ukTime', () => {
  it('follows GMT in winter and BST in summer', () => {
    expect(ukTime(WINTER_9PM)).toEqual({ day: '2026-11-23', hour: 21 });
    expect(ukTime(SUMMER_9PM)).toEqual({ day: '2026-07-01', hour: 21 });
    expect(ukTime(new Date('2026-07-01T23:30:00Z'))).toEqual({ day: '2026-07-02', hour: 0 });
  });
});

describe('fetchReading', () => {
  it('calls the live summary endpoint with Basic auth and converts to pence', async () => {
    const t212 = fakeT212();
    const { reading, note } = await fetchReading(env(), WINTER_9PM, t212.impl);
    expect(t212.calls[0].url).toBe('https://live.trading212.com/api/v0/equity/account/summary');
    expect(t212.calls[0].auth).toBe(`Basic ${btoa('key:secret')}`);
    expect(reading).toEqual({
      day: '2026-11-23',
      at: WINTER_9PM.toISOString(),
      currency: 'GBP',
      totalMinor: 1023456,
      costMinor: 900000,
      unrealisedMinor: 110000,
      final: true,
    });
    expect(note).toBeUndefined();
  });

  it('uses cash + investments if totalValue turns out to exclude cash', async () => {
    const t212 = fakeT212({ ...SUMMARY, totalValue: 10100 });
    const { reading, note } = await fetchReading(env(), WINTER_9PM, t212.impl);
    expect(reading.totalMinor).toBe(1023456);
    expect(note).toMatch(/used the sum/);
  });

  it('explains auth failures in plain words', async () => {
    await expect(fetchReading(env(), WINTER_9PM, fakeT212({}, 401).impl)).rejects.toThrow(/rejected the API key/);
    await expect(fetchReading(env(), WINTER_9PM, fakeT212({}, 403).impl)).rejects.toThrow(/"account" permission/);
  });

  it('can point at the demo environment', async () => {
    const t212 = fakeT212();
    await fetchReading(env({ T212_BASE_URL: 'https://demo.trading212.com/' }), WINTER_9PM, t212.impl);
    expect(t212.calls[0].url).toBe('https://demo.trading212.com/api/v0/equity/account/summary');
  });
});

describe('onSchedule', () => {
  it('only acts at 9pm UK, whichever UTC hour that is', async () => {
    const e = env();
    const t212 = fakeT212();
    expect(await onSchedule(e, new Date('2026-11-23T20:00:00Z'), t212.impl)).toBe('skipped'); // 8pm GMT
    expect(await onSchedule(e, SUMMER_9PM, t212.impl)).toBe('taken'); // 9pm BST
    expect(await onSchedule(e, WINTER_9PM, t212.impl)).toBe('taken'); // 9pm GMT
    expect(t212.calls).toHaveLength(2);
  });

  it('takes one final reading a day, retrying later in the hour if one failed', async () => {
    const e = env();
    await expect(onSchedule(e, WINTER_9PM, fakeT212({}, 408).impl)).rejects.toThrow(/timed out/);
    expect(JSON.parse((await e.DAYS.get('status'))!)).toMatchObject({ ok: false });

    const t212 = fakeT212();
    expect(await onSchedule(e, new Date('2026-11-23T21:15:00Z'), t212.impl)).toBe('taken');
    expect(await onSchedule(e, new Date('2026-11-23T21:30:00Z'), t212.impl)).toBe('skipped');
    expect(t212.calls).toHaveLength(1);
    expect(JSON.parse((await e.DAYS.get('status'))!)).toMatchObject({ ok: true, day: '2026-11-23' });
  });

  it('replaces a provisional same-day reading with the 9pm one', async () => {
    const e = env();
    const ctx = () => new Date('2026-11-23T12:00:00Z');
    const res = await handleRequest(
      new Request('https://w/refresh', { method: 'POST', headers: { Authorization: 'Bearer tok' } }),
      e,
      ctx,
      fakeT212().impl,
    );
    expect(((await res.json()) as { reading: Reading }).reading.final).toBe(false);
    expect(await onSchedule(e, WINTER_9PM, fakeT212({ ...SUMMARY, totalValue: 10300.56, cash: { ...SUMMARY.cash }, investments: { ...SUMMARY.investments, currentValue: 10166 } }).impl)).toBe('taken');
    const stored = JSON.parse((await e.DAYS.get('day:2026-11-23'))!) as Reading;
    expect(stored).toMatchObject({ final: true, totalMinor: 1030056 });
  });
});

describe('handleRequest', () => {
  const get = (path: string, headers: Record<string, string> = { Authorization: 'Bearer tok' }) =>
    new Request(`https://w${path}`, { headers });

  it('health check reports which secrets are set, without revealing them', async () => {
    const res = await handleRequest(new Request('https://w/'), env({ FINPAIR_TOKEN: '' }));
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({
      service: 'finpair-t212',
      ok: true,
      secrets: { T212_API_KEY: true, T212_API_SECRET: true, FINPAIR_TOKEN: false },
    });
    expect(body).not.toContain('secret"');
    expect(body).not.toContain('"key"');
  });

  it('needs the access token', async () => {
    const res = await handleRequest(get('/days', { Authorization: 'Bearer nope' }), env());
    expect(res.status).toBe(401);
  });

  it('lists readings on or after `since`, oldest first', async () => {
    const e = env();
    for (const day of ['2026-11-21', '2026-11-23', '2026-11-22']) {
      await onSchedule(e, new Date(`${day}T21:00:00Z`), fakeT212().impl);
    }
    const res = await handleRequest(get('/days?since=2026-11-22'), e);
    const body = (await res.json()) as { readings: Reading[]; status: unknown };
    expect(body.readings.map((r) => r.day)).toEqual(['2026-11-22', '2026-11-23']);
    expect(body.status).toMatchObject({ ok: true });
  });

  it('rejects a malformed since', async () => {
    expect((await handleRequest(get('/days?since=yesterday'), env())).status).toBe(400);
  });

  it('answers CORS only for the app origins (and localhost)', async () => {
    const pre = (origin: string) =>
      handleRequest(new Request('https://w/days', { method: 'OPTIONS', headers: { Origin: origin } }), env());
    expect((await pre('https://adamjcook.github.io')).headers.get('Access-Control-Allow-Origin')).toBe(
      'https://adamjcook.github.io',
    );
    expect((await pre('http://localhost:5173')).headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect((await pre('https://evil.example')).headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('refuses a second manual reading within Trading 212’s 5-second limit', async () => {
    const e = env();
    const post = () => new Request('https://w/refresh', { method: 'POST', headers: { Authorization: 'Bearer tok' } });
    const t = new Date('2026-11-23T12:00:00Z');
    expect((await handleRequest(post(), e, () => t, fakeT212().impl)).status).toBe(200);
    expect((await handleRequest(post(), e, () => new Date(t.getTime() + 2000), fakeT212().impl)).status).toBe(429);
  });
});
