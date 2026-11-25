/**
 * Reminder notifications. Each phone that turns reminders on registers its
 * push subscription here, along with which reminders it wants and the facts
 * they need (the cards' 0% end dates, the Trading 212 account's name). The
 * Worker's cron then sends:
 *   - 9am UK on the last working day of the month (payday): "time to update your balances"
 *   - 9am UK, 30 / 7 / 1 days before (and on the day) a card's 0% deal ends
 *   - after the 9pm Trading 212 reading: if the account is down 5%+ on the week
 */

import type { Env, KV, Reading } from './index';
import { listReadings, ukTime } from './index';
import { sendPush, type PushMessage, type PushSubscriptionJSON } from './push';
import { isLastWorkingDay } from './ukdates';

export interface ReminderPrefs {
  monthly: boolean;
  promo: boolean;
  drop: boolean;
  /** "Your partner just updated the balances" (automatic sync). Absent on older registrations = on. */
  partner?: boolean;
}

export interface Promo {
  name: string;
  endsOn: string; // YYYY-MM-DD
}

export interface Registration {
  subscription: PushSubscriptionJSON;
  prefs: ReminderPrefs;
  promos: Promo[];
  t212Name: string | null;
  /** The phone's automatic-sync pair (see relay.ts); partner notices stay within it. */
  channel?: string | null;
  updatedAt: string;
}

const SUB_PREFIX = 'sub:';
const DAILY_MARKER = 'reminded:';
const DROP_MARKER = 'dropAlert';
export const PROMO_WARN_DAYS = [30, 7, 1, 0];
export const DROP_THRESHOLD = -0.05;
const REMINDER_HOUR = 9;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const subKey = async (endpoint: string) => SUB_PREFIX + (await sha256Hex(endpoint)).slice(0, 32);

const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Validate a registration posted by the app. Throws a readable message if it's wrong. */
export function parseRegistration(body: unknown, now: Date): Registration {
  const b = body as Partial<Registration> | null;
  const sub = b?.subscription;
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint)) {
    throw new Error('subscription.endpoint must be an https URL.');
  }
  if (typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string') {
    throw new Error('subscription.keys are missing.');
  }
  const p = b?.prefs;
  const promos = Array.isArray(b?.promos) ? b!.promos : [];
  return {
    subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
    prefs: {
      monthly: p?.monthly !== false,
      promo: p?.promo !== false,
      drop: p?.drop !== false,
      partner: p?.partner !== false,
    },
    promos: promos
      .filter((x): x is Promo => !!x && typeof x.name === 'string' && isDay(x.endsOn))
      .slice(0, 50)
      .map((x) => ({ name: x.name.slice(0, 80), endsOn: x.endsOn })),
    t212Name: typeof b?.t212Name === 'string' ? b.t212Name.slice(0, 80) : null,
    channel: typeof b?.channel === 'string' && /^[0-9a-f]{16,64}$/.test(b.channel) ? b.channel : null,
    updatedAt: now.toISOString(),
  };
}

export async function saveRegistration(kv: KV, reg: Registration): Promise<void> {
  await kv.put(await subKey(reg.subscription.endpoint), JSON.stringify(reg));
}

export async function deleteRegistration(kv: KV, endpoint: string): Promise<void> {
  await kv.delete(await subKey(endpoint));
}

export async function getRegistration(kv: KV, endpoint: string): Promise<Registration | null> {
  const raw = await kv.get(await subKey(endpoint));
  return raw ? (JSON.parse(raw) as Registration) : null;
}

export async function allRegistrations(kv: KV): Promise<Registration[]> {
  const out: Registration[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: SUB_PREFIX, cursor });
    for (const k of page.keys) {
      const raw = await kv.get(k.name);
      if (raw) out.push(JSON.parse(raw) as Registration);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

/** Send to every registration that wants it; forget phones that have unsubscribed. */
async function broadcast(
  env: Env,
  regs: Registration[],
  pick: (r: Registration) => PushMessage[],
  now: Date,
  fetchImpl: typeof fetch,
): Promise<number> {
  let sent = 0;
  for (const reg of regs) {
    for (const msg of pick(reg)) {
      const result = await sendPush(env.DAYS, reg.subscription, msg, now, fetchImpl, env.VAPID_SUBJECT);
      if (result === 'gone') {
        await deleteRegistration(env.DAYS, reg.subscription.endpoint);
        break;
      }
      if (result === 'sent') sent++;
    }
  }
  return sent;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
}

function niceDate(day: string): string {
  return new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function money(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(minor / 100);
}

export function monthlyMessage(): PushMessage {
  return {
    title: 'Payday — time to update your balances',
    body: "It's the last working day of the month. A couple of minutes in MC Bank keeps your charts and goals accurate.",
    tag: 'monthly',
    url: '#/update',
  };
}

export function promoMessages(promos: Promo[], today: string): PushMessage[] {
  const out: PushMessage[] = [];
  for (const p of promos) {
    const left = daysBetween(today, p.endsOn);
    if (!PROMO_WARN_DAYS.includes(left)) continue;
    const when = left === 0 ? 'today' : left === 1 ? 'tomorrow' : left === 7 ? 'in a week' : `in ${left} days`;
    out.push({
      title: `0% deal ends ${when}`,
      body: `${p.name}: the 0% rate ends ${left === 0 ? 'today' : `on ${niceDate(p.endsOn)}`}. Worth a plan for the balance — a transfer or paying it down.`,
      tag: `promo:${p.name}:${p.endsOn}`,
      url: '#/accounts',
    });
  }
  return out;
}

/** The 9am run: payday reminder (last working day of the month), 0% deal countdowns. Once per day. */
export async function dailyReminders(env: Env, now: Date, fetchImpl: typeof fetch = fetch): Promise<number> {
  const { day } = ukTime(now);
  if (await env.DAYS.get(DAILY_MARKER + day)) return 0;
  await env.DAYS.put(DAILY_MARKER + day, now.toISOString());
  const regs = await allRegistrations(env.DAYS);
  const payday = isLastWorkingDay(day);
  return broadcast(
    env,
    regs,
    (r) => [
      ...(r.prefs.monthly && payday ? [monthlyMessage()] : []),
      ...(r.prefs.promo ? promoMessages(r.promos, day) : []),
    ],
    now,
    fetchImpl,
  );
}

/**
 * Week-on-week change for the latest reading: compares it with the latest
 * reading at least 7 days older. null if there isn't one yet.
 */
export function weeklyChange(readings: Reading[]): { from: Reading; to: Reading; change: number } | null {
  if (readings.length < 2) return null;
  const to = readings[readings.length - 1];
  const from = [...readings].reverse().find((r) => daysBetween(r.day, to.day) >= 7);
  if (!from || from.totalMinor <= 0) return null;
  return { from, to, change: (to.totalMinor - from.totalMinor) / from.totalMinor };
}

/** After the 9pm reading: a heads-up if the account is down 5%+ on the week (at most once a week). */
export async function dropCheck(env: Env, now: Date, fetchImpl: typeof fetch = fetch): Promise<number> {
  const week = weeklyChange(await listReadings(env, null));
  if (!week || week.change > DROP_THRESHOLD) return 0;
  const last = await env.DAYS.get(DROP_MARKER);
  if (last && daysBetween(last, week.to.day) < 7) return 0;
  await env.DAYS.put(DROP_MARKER, week.to.day);
  const pct = Math.abs(week.change * 100).toFixed(1);
  const regs = await allRegistrations(env.DAYS);
  return broadcast(
    env,
    regs,
    (r) =>
      r.prefs.drop
        ? [
            {
              title: `${r.t212Name ?? 'Your Trading 212 account'} is down ${pct}% this week`,
              body: `${money(week.from.totalMinor, week.to.currency)} on ${niceDate(week.from.day)} → ${money(week.to.totalMinor, week.to.currency)} today. Markets move — just a heads-up.`,
              tag: 'drop',
              url: '#/',
            },
          ]
        : [],
    now,
    fetchImpl,
  );
}

export const isReminderHour = (now: Date) => ukTime(now).hour === REMINDER_HOUR;
