/**
 * Web Push from the Worker, using only WebCrypto (no dependencies):
 *  - VAPID (RFC 8292): each push request carries a short-lived ES256 JWT
 *    signed with this Worker's own key pair, which it generates on first use
 *    and keeps in KV. Phones subscribe with the matching public key.
 *  - Message encryption (RFC 8291, aes128gcm per RFC 8188): only the phone
 *    that subscribed can read a notification's text; the push service (e.g.
 *    Google's, for Chrome on Android) just relays ciphertext.
 */

import type { KV } from './index';

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushMessage {
  title: string;
  body: string;
  /** Notifications with the same tag replace each other on the phone. */
  tag: string;
  /** In-app route to open when tapped, e.g. '#/update'. */
  url: string;
}

const VAPID_KEY = 'vapid';
const DEFAULT_SUBJECT = 'mailto:finpair@localhost';
const RECORD_SIZE = 4096;

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array | ArrayBuffer): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// WebCrypto's types want ArrayBuffer-backed views; ours always are.
const buf = (u: Uint8Array) => u as Uint8Array<ArrayBuffer>;

export async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', buf(ikm), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info) },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** The aes128gcm-encoded request body for one push message (single record). */
export async function encryptPayload(
  sub: PushSubscriptionJSON,
  plaintext: Uint8Array,
  salt: Uint8Array = crypto.getRandomValues(new Uint8Array(16)),
): Promise<Uint8Array> {
  const uaPublic = fromB64url(sub.keys.p256dh);
  const authSecret = fromB64url(sub.keys.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('Malformed push subscription keys.');

  // A fresh sender key pair for every message.
  const sender = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', buf(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, sender.privateKey, 256),
  );

  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode('WebPush: info\0'), uaPublic, senderPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', buf(cek), 'AES-GCM', false, ['encrypt']);
  // 0x02 marks the last (only) record; no extra padding.
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(nonce) }, aesKey, buf(concat(plaintext, new Uint8Array([2])))),
  );

  const header = new Uint8Array(16 + 4 + 1 + senderPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = senderPublic.length;
  header.set(senderPublic, 21);
  return concat(header, ciphertext);
}

interface StoredVapid {
  publicKey: string; // base64url uncompressed P-256 point — the phone's applicationServerKey
  privateJwk: JsonWebKey;
}

/** This Worker's VAPID key pair, created and stored on first use. */
export async function vapidKeys(kv: KV): Promise<StoredVapid> {
  const existing = await kv.get(VAPID_KEY);
  if (existing) return JSON.parse(existing) as StoredVapid;
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const stored: StoredVapid = {
    publicKey: b64url(await crypto.subtle.exportKey('raw', pair.publicKey)),
    privateJwk: (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey,
  };
  await kv.put(VAPID_KEY, JSON.stringify(stored));
  return stored;
}

/** `Authorization` header value for a push to `endpoint`. */
export async function vapidAuthorization(
  vapid: StoredVapid,
  endpoint: string,
  now: Date,
  subject: string = DEFAULT_SUBJECT,
): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(
    enc.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now.getTime() / 1000) + 12 * 3600,
        sub: subject,
      }),
    ),
  );
  const key = await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ]);
  // WebCrypto's ECDSA signature is already the raw r||s form JWS expects.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${vapid.publicKey}`;
}

export type PushResult = 'sent' | 'gone' | 'failed';

/** Send one notification. 'gone' means the phone unsubscribed — drop the registration. */
export async function sendPush(
  kv: KV,
  sub: PushSubscriptionJSON,
  message: PushMessage,
  now: Date,
  fetchImpl: typeof fetch = fetch,
  subject?: string,
): Promise<PushResult> {
  const vapid = await vapidKeys(kv);
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(message)));
  const res = await fetchImpl(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(vapid, sub.endpoint, now, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(24 * 3600),
      Urgency: 'normal',
    },
    body: buf(body),
  });
  if (res.status === 404 || res.status === 410) return 'gone';
  return res.ok ? 'sent' : 'failed';
}
