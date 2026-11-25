/**
 * finpair-t212 — records a Trading 212 account's total value once a day and
 * serves that history to the FinPair app.
 *
 * Trading 212 has no "portfolio value over time" endpoint, so the history has
 * to be recorded as it happens: a cron trigger reads the account summary at
 * 9pm UK time every day and keeps one small record per day in KV. The app
 * pulls any days it hasn't seen yet when it opens.
 *
 * Secrets (set in the Cloudflare dashboard, never in the repo):
 *   T212_API_KEY, T212_API_SECRET — a Trading 212 key with the "account" scope only
 *   FINPAIR_TOKEN — shared with the app; required on every app request
 * Vars (wrangler.jsonc): ALLOWED_ORIGINS, optional T212_BASE_URL (demo/live)
 *
 * It also sends the app's reminder notifications (see reminders.ts / push.ts).
 */

import {
  dailyReminders,
  deleteRegistration,
  dropCheck,
  getRegistration,
  isReminderHour,
  parseRegistration,
  saveRegistration,
} from './reminders';
import { sendPush, vapidKeys } from './push';
import { allSlots, isChannel, notifyPartner, parseSlot, saveSlot, type RelayNotice } from './relay';

export interface KVListKey<M> {
  name: string;
  metadata?: M;
}

/** The slice of Cloudflare's KVNamespace this Worker uses. */
export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
  list<M = unknown>(options: {
    prefix: string;
    cursor?: string;
  }): Promise<{ keys: KVListKey<M>[]; list_complete: boolean; cursor?: string }>;
}

export interface Env {
  DAYS: KV;
  T212_API_KEY: string;
  T212_API_SECRET: string;
  FINPAIR_TOKEN: string;
  /** Comma-separated origins allowed to call this Worker from a browser. */
  ALLOWED_ORIGINS?: string;
  /** Defaults to the live (real-money) environment. */
  T212_BASE_URL?: string;
  /** Contact for push services (VAPID "sub"): a mailto: or https: URL. Optional. */
  VAPID_SUBJECT?: string;
}

/** One day's reading. Amounts are minor units (pence) in `currency`. */
export interface Reading {
  day: string; // YYYY-MM-DD, UK date
  at: string; // ISO time the reading was taken
  currency: string;
  totalMinor: number; // what the app records as the account balance
  costMinor: number; // cost basis of the current investments
  unrealisedMinor: number; // current gain/loss on them
  /** True for the 9pm reading (or any taken after 9pm); earlier same-day readings are provisional. */
  final: boolean;
}

export interface Status {
  ok: boolean;
  at: string;
  day?: string;
  error?: string;
  /** Set when Trading 212's totalValue didn't match cash + investments and the sum was used instead. */
  note?: string;
}

const LIVE_BASE = 'https://live.trading212.com';
const READING_HOUR = 21; // 9pm UK time
const DAY_PREFIX = 'day:';
const STATUS_KEY = 'status';

/** UK calendar date and hour for an instant (handles GMT/BST). */
export function ukTime(date: Date): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

const toMinor = (major: number) => Math.round(major * 100);

function num(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Trading 212 response is missing ${field}.`);
  }
  return value;
}

const ERRORS: Record<number, string> = {
  401: 'Trading 212 rejected the API key — check T212_API_KEY and T212_API_SECRET.',
  403: 'The Trading 212 API key is missing the "account" permission.',
  408: 'Trading 212 timed out.',
  429: 'Trading 212 rate limit hit — try again in a few seconds.',
};

/** Read the account summary and turn it into a Reading (does not store it). */
export async function fetchReading(env: Env, now: Date, fetchImpl: typeof fetch = fetch): Promise<{ reading: Reading; note?: string }> {
  const base = (env.T212_BASE_URL || LIVE_BASE).replace(/\/+$/, '');
  const res = await fetchImpl(`${base}/api/v0/equity/account/summary`, {
    headers: { Authorization: `Basic ${btoa(`${env.T212_API_KEY}:${env.T212_API_SECRET}`)}` },
  });
  if (!res.ok) throw new Error(ERRORS[res.status] ?? `Trading 212 returned HTTP ${res.status}.`);
  const body = (await res.json()) as {
    currency?: unknown;
    totalValue?: unknown;
    cash?: { availableToTrade?: unknown; inPies?: unknown; reservedForOrders?: unknown };
    investments?: { currentValue?: unknown; totalCost?: unknown; unrealizedProfitLoss?: unknown };
  };
  if (typeof body.currency !== 'string') throw new Error('Trading 212 response is missing currency.');

  const reported = num(body.totalValue, 'totalValue');
  const components =
    num(body.cash?.availableToTrade ?? 0, 'cash.availableToTrade') +
    num(body.cash?.inPies ?? 0, 'cash.inPies') +
    num(body.cash?.reservedForOrders ?? 0, 'cash.reservedForOrders') +
    num(body.investments?.currentValue, 'investments.currentValue');
  // The docs describe totalValue both as "total account value" and as
  // "investments value". If it doesn't equal cash + investments (to within a
  // pound of rounding), trust the sum of the parts instead and say so.
  const mismatch = Math.abs(reported - components) > 1;
  const { day, hour } = ukTime(now);
  return {
    reading: {
      day,
      at: now.toISOString(),
      currency: body.currency,
      totalMinor: toMinor(mismatch ? components : reported),
      costMinor: toMinor(num(body.investments?.totalCost, 'investments.totalCost')),
      unrealisedMinor: toMinor(num(body.investments?.unrealizedProfitLoss, 'investments.unrealizedProfitLoss')),
      final: hour >= READING_HOUR,
    },
    note: mismatch
      ? `totalValue (${reported}) didn't match cash + investments (${components.toFixed(2)}); used the sum.`
      : undefined,
  };
}

/** Take a reading now, store it as that UK day's record, and record the outcome. */
export async function takeReading(env: Env, now: Date, fetchImpl: typeof fetch = fetch): Promise<Reading> {
  try {
    const { reading, note } = await fetchReading(env, now, fetchImpl);
    await env.DAYS.put(DAY_PREFIX + reading.day, JSON.stringify(reading), { metadata: reading });
    await putStatus(env, { ok: true, at: reading.at, day: reading.day, note });
    return reading;
  } catch (err) {
    await putStatus(env, { ok: false, at: now.toISOString(), error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

async function putStatus(env: Env, status: Status) {
  await env.DAYS.put(STATUS_KEY, JSON.stringify(status));
}

async function getStatus(env: Env): Promise<Status | null> {
  const raw = await env.DAYS.get(STATUS_KEY);
  return raw ? (JSON.parse(raw) as Status) : null;
}

/**
 * Cron handler. Cloudflare crons run in UTC, so wrangler.jsonc schedules runs
 * across both possible UTC hours for each UK time (GMT/BST) and the handler
 * only acts on the ones that land on the right UK hour:
 *   - 9pm UK: the day's Trading 212 reading. Runs every 15 minutes through
 *     the hour; once a final reading exists the rest are no-ops, so the later
 *     ones are automatic retries. A new reading then gets the weekly drop check.
 *   - 9am UK: reminder notifications (monthly update, 0% deals ending).
 */
export async function onSchedule(
  env: Env,
  now: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<'skipped' | 'taken' | 'reminded'> {
  if (isReminderHour(now)) {
    await dailyReminders(env, now, fetchImpl);
    return 'reminded';
  }
  const { day, hour } = ukTime(now);
  if (hour !== READING_HOUR) return 'skipped';
  const existing = await env.DAYS.get(DAY_PREFIX + day);
  if (existing && (JSON.parse(existing) as Reading).final) return 'skipped';
  await takeReading(env, now, fetchImpl);
  await dropCheck(env, now, fetchImpl);
  return 'taken';
}

/** Every stored reading on or after `since` (YYYY-MM-DD), oldest first. */
export async function listReadings(env: Env, since: string | null): Promise<Reading[]> {
  const out: Reading[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.DAYS.list<Reading>({ prefix: DAY_PREFIX, cursor });
    for (const k of page.keys) {
      if (since && k.name < DAY_PREFIX + since) continue;
      const reading = k.metadata ?? (JSON.parse((await env.DAYS.get(k.name)) ?? 'null') as Reading | null);
      if (reading) out.push(reading);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

/** Constant-time string comparison, so the token can't be guessed byte by byte from timing. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function corsHeaders(env: Env, request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!origin || !(allowed.includes(origin) || isLocal)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export async function handleRequest(
  request: Request,
  env: Env,
  now: () => Date = () => new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const cors = corsHeaders(env, request);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors },
    });

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const url = new URL(request.url);
  if (url.pathname === '/') {
    // Which secrets this deployment can see (never their values) — the quick
    // way to tell a secret saved under Build settings, or misnamed, from one
    // the running Worker actually has.
    const has = (v: string | undefined) => typeof v === 'string' && v.length > 0;
    return json({
      service: 'finpair-t212',
      ok: true,
      secrets: {
        T212_API_KEY: has(env.T212_API_KEY),
        T212_API_SECRET: has(env.T212_API_SECRET),
        FINPAIR_TOKEN: has(env.FINPAIR_TOKEN),
      },
    });
  }

  if (!env.FINPAIR_TOKEN) return json({ error: 'FINPAIR_TOKEN is not set on the Worker.' }, 500);
  const auth = request.headers.get('Authorization') ?? '';
  if (!safeEqual(auth, `Bearer ${env.FINPAIR_TOKEN}`)) return json({ error: 'Wrong access token.' }, 401);

  if (request.method === 'GET' && url.pathname === '/days') {
    const since = url.searchParams.get('since');
    if (since !== null && !/^\d{4}-\d{2}-\d{2}$/.test(since)) return json({ error: 'since must be YYYY-MM-DD.' }, 400);
    return json({ readings: await listReadings(env, since), status: await getStatus(env) });
  }

  if (request.method === 'POST' && url.pathname === '/refresh') {
    // Trading 212 allows one summary request per 5 seconds per account.
    const last = await getStatus(env);
    if (last && now().getTime() - Date.parse(last.at) < 6000) {
      return json({ error: 'Just took a reading — try again in a few seconds.' }, 429);
    }
    try {
      return json({ reading: await takeReading(env, now(), fetchImpl) });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  }

  // Automatic sync: each phone's encrypted copy (see relay.ts).
  if (request.method === 'GET' && url.pathname === '/relay') {
    const channel = url.searchParams.get('channel');
    if (!isChannel(channel)) return json({ error: 'channel is missing or malformed.' }, 400);
    return json({ slots: await allSlots(env.DAYS, channel) });
  }
  if (request.method === 'POST' && url.pathname === '/relay') {
    const body = (await request.json().catch(() => null)) as { slot?: unknown; notify?: RelayNotice } | null;
    let slot;
    try {
      slot = parseSlot(body?.slot);
      await saveSlot(env.DAYS, slot);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
    const notify = body?.notify;
    const notified =
      notify && typeof notify.title === 'string' && typeof notify.body === 'string'
        ? await notifyPartner(env, slot.channel, notify, now(), fetchImpl)
        : 0;
    return json({ ok: true, notified });
  }

  if (url.pathname.startsWith('/push/')) {
    const body = request.method === 'POST' ? await request.json().catch(() => null) : null;
    const endpoint = (body as { endpoint?: unknown } | null)?.endpoint;

    // The public key phones subscribe with (created on first use).
    if (request.method === 'GET' && url.pathname === '/push/key') {
      return json({ publicKey: (await vapidKeys(env.DAYS)).publicKey });
    }
    if (request.method === 'POST' && url.pathname === '/push/subscribe') {
      try {
        await saveRegistration(env.DAYS, parseRegistration(body, now()));
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, 400);
      }
      return json({ ok: true });
    }
    if (request.method === 'POST' && url.pathname === '/push/unsubscribe') {
      if (typeof endpoint === 'string') await deleteRegistration(env.DAYS, endpoint);
      return json({ ok: true });
    }
    if (request.method === 'POST' && url.pathname === '/push/test') {
      const reg = typeof endpoint === 'string' ? await getRegistration(env.DAYS, endpoint) : null;
      if (!reg) return json({ error: 'This phone isn’t registered for reminders yet.' }, 404);
      const result = await sendPush(
        env.DAYS,
        reg.subscription,
        { title: 'MC Bank reminders are on', body: 'This is what a reminder looks like.', tag: 'test', url: '#/settings' },
        now(),
        fetchImpl,
        env.VAPID_SUBJECT,
      );
      if (result === 'gone') await deleteRegistration(env.DAYS, reg.subscription.endpoint);
      return result === 'sent'
        ? json({ ok: true })
        : json({ error: result === 'gone' ? 'The phone’s subscription has expired — turn reminders off and on again.' : 'The push service refused the message.' }, 502);
    }
  }

  return json({ error: 'Not found.' }, 404);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
  async scheduled(controller: { scheduledTime: number }, env: Env): Promise<void> {
    await onSchedule(env, new Date(controller.scheduledTime));
  },
};
