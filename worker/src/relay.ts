/**
 * Automatic sync between the two phones, through this Worker.
 *
 * Each phone keeps one slot here holding an encrypted copy of its data and
 * replaces it after every change; each phone reads the other's slot when it
 * opens and merges it in (FinPair's merge is order-free and safe to repeat,
 * so phones can catch up whenever). The data is encrypted on the phone with a
 * key the two phones swapped over QR: this Worker only ever stores bytes it
 * cannot read, and never sees the key.
 *
 * Saving a payday update can also ask for a "your partner just updated"
 * notification, sent to every phone registered for reminders except the one
 * that saved it (and only those that keep the "Partner updates" reminder on).
 */

import type { Env, KV } from './index';
import { allRegistrations, deleteRegistration } from './reminders';
import { sendPush } from './push';

const RELAY_PREFIX = 'relay:';
/** Generous: a couple's whole history compresses to tens of kilobytes. */
const MAX_DATA_CHARS = 2_000_000;

export interface RelaySlot {
  /**
   * Which linked pair of phones this belongs to: a fingerprint of their
   * shared key (not the key). Keeps the dev app's phones, or any other pair,
   * from ever seeing each other's copies.
   */
  channel: string;
  deviceId: string;
  /** When the phone uploaded it (its own clock). */
  at: string;
  /** AES-GCM nonce and ciphertext, base64url. */
  iv: string;
  data: string;
}

export interface RelayNotice {
  title: string;
  body: string;
  /** The saving phone's push endpoint, so it isn't told about its own update. */
  exceptEndpoint?: string | null;
}

const isB64url = (s: unknown, max: number): s is string =>
  typeof s === 'string' && s.length > 0 && s.length <= max && /^[A-Za-z0-9_-]+$/.test(s);

/** Validate an upload. Throws a readable message if it's wrong. */
export function parseSlot(body: unknown): RelaySlot {
  const b = body as Partial<RelaySlot> | null;
  if (!b || !isChannel(b.channel)) throw new Error('channel is missing or malformed.');
  if (typeof b.deviceId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(b.deviceId)) {
    throw new Error('deviceId is missing or malformed.');
  }
  if (typeof b.at !== 'string' || Number.isNaN(Date.parse(b.at))) throw new Error('at must be an ISO time.');
  if (!isB64url(b.iv, 64)) throw new Error('iv must be base64url.');
  if (!isB64url(b.data, MAX_DATA_CHARS)) throw new Error('data must be base64url and under 2 MB.');
  return { channel: b.channel, deviceId: b.deviceId, at: b.at, iv: b.iv, data: b.data };
}

export const isChannel = (c: unknown): c is string => typeof c === 'string' && /^[0-9a-f]{16,64}$/.test(c);

export async function saveSlot(kv: KV, slot: RelaySlot): Promise<void> {
  await kv.put(`${RELAY_PREFIX}${slot.channel}:${slot.deviceId}`, JSON.stringify(slot), { metadata: { at: slot.at } });
}

export async function allSlots(kv: KV, channel: string): Promise<RelaySlot[]> {
  const out: RelaySlot[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: `${RELAY_PREFIX}${channel}:`, cursor });
    for (const k of page.keys) {
      const raw = await kv.get(k.name);
      if (raw) out.push(JSON.parse(raw) as RelaySlot);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

/**
 * Tell the other phone of the same pair about a payday update. Returns how
 * many were sent. Phones in other pairs (the dev app's, say) never hear of it.
 */
export async function notifyPartner(
  env: Env,
  channel: string,
  notice: RelayNotice,
  now: Date,
  fetchImpl: typeof fetch,
): Promise<number> {
  const title = String(notice.title).slice(0, 80);
  const body = String(notice.body).slice(0, 160);
  let sent = 0;
  for (const reg of await allRegistrations(env.DAYS)) {
    if (reg.channel !== channel || reg.subscription.endpoint === notice.exceptEndpoint) continue;
    if (reg.prefs.partner === false) continue;
    const result = await sendPush(
      env.DAYS,
      reg.subscription,
      { title, body, tag: 'partner-update', url: '#/' },
      now,
      fetchImpl,
      env.VAPID_SUBJECT,
    );
    if (result === 'gone') await deleteRegistration(env.DAYS, reg.subscription.endpoint);
    if (result === 'sent') sent++;
  }
  return sent;
}
