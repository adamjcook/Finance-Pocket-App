import type { ReminderPrefs, SyncedState } from '../model/types';
import { DEFAULT_REMINDER_PREFS } from '../model/types';
import { getStore, patchDevice } from '../model/store';
import { call, workerReady } from './t212';
import { APP_NAME } from '../appName';

/**
 * Reminder notifications. The app can't run in the background, so the
 * finpair-t212 Worker sends them (worker/src/reminders.ts) as Web Push
 * messages. This phone subscribes with the Worker's public key and registers
 * that subscription with the Worker, together with which reminders it wants
 * and the facts the Worker needs: the cards' 0% end dates and the Trading 212
 * account's name. Re-registered whenever those change.
 */

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** What the Worker is told about this phone's reminders. */
export function registrationFacts(state: SyncedState) {
  const t212 = state.settings.t212;
  return {
    promos: state.accounts
      .filter((a) => !a.archived && a.kind === 'credit_card' && a.promoEndsOn)
      .map((a) => ({ name: a.name, endsOn: a.promoEndsOn! }))
      .sort((x, y) => x.endsOn.localeCompare(y.endsOn) || x.name.localeCompare(y.name)),
    t212Name: (t212 && state.accounts.find((a) => a.id === t212.accountId)?.name) ?? null,
  };
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.length) return false;
  const x = new Uint8Array(a);
  return x.every((v, i) => v === b[i]);
}

/** Cheap fingerprint, only to tell whether the registration needs resending. */
function fingerprint(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function link() {
  const l = getStore().state.settings.t212;
  if (!workerReady(l)) throw new Error('Add the Worker address and token in the Trading 212 section first.');
  return l;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function register(sub: PushSubscription, prefs: ReminderPrefs): Promise<void> {
  const body = JSON.stringify({ subscription: sub.toJSON(), prefs, ...registrationFacts(getStore().state), channel: getStore().device.relay?.channel ?? null });
  await call(link(), '/push/subscribe', { method: 'POST', body });
  await patchDevice({ push: { enabled: true, prefs, sentHash: fingerprint(body) } });
}

/** Ask permission, subscribe this phone, and register it with the Worker. */
export async function enableReminders(): Promise<void> {
  const prefs = getStore().device.push?.prefs ?? DEFAULT_REMINDER_PREFS;
  const l = link();
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(`Notifications are blocked for ${APP_NAME} — allow them in Chrome's site settings, then try again.`);
  }
  const { publicKey } = await call<{ publicKey: string }>(l, '/push/key');
  const key = fromB64url(publicKey);
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // Subscribed to a different Worker before? Start again with this one's key.
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await register(sub, prefs);
}

export async function disableReminders(): Promise<void> {
  const prefs = getStore().device.push?.prefs ?? DEFAULT_REMINDER_PREFS;
  const sub = await currentSubscription().catch(() => null);
  if (sub) {
    await call(link(), '/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(
      () => undefined, // the Worker forgets it anyway once pushes start failing
    );
    await sub.unsubscribe().catch(() => undefined);
  }
  await patchDevice({ push: { enabled: false, prefs, sentHash: null } });
}

export async function setReminderPref(key: keyof ReminderPrefs, value: boolean): Promise<void> {
  const push = getStore().device.push;
  const prefs = { ...(push?.prefs ?? DEFAULT_REMINDER_PREFS), [key]: value };
  if (!push?.enabled) {
    await patchDevice({ push: { enabled: false, prefs, sentHash: null } });
    return;
  }
  const sub = await currentSubscription();
  if (!sub) throw new Error('This phone is no longer subscribed — turn reminders off and on again.');
  await register(sub, prefs);
}

export async function sendTestReminder(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) throw new Error('This phone is no longer subscribed — turn reminders off and on again.');
  await call(link(), '/push/test', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
}

/**
 * On app open (and when cards' 0% dates or the linked account change): keep
 * the Worker's copy of this phone's registration current. Quietly does
 * nothing if reminders are off, and notes it if the browser dropped the
 * subscription (e.g. notification permission was revoked).
 */
export async function refreshReminders(): Promise<void> {
  const { device } = getStore();
  const push = device.push;
  if (!push?.enabled || !pushSupported() || !workerReady(getStore().state.settings.t212)) return;
  try {
    const sub = await currentSubscription();
    if (!sub || Notification.permission !== 'granted') {
      await patchDevice({ push: { ...push, enabled: false, sentHash: null } });
      return;
    }
    const body = JSON.stringify({ subscription: sub.toJSON(), prefs: push.prefs, ...registrationFacts(getStore().state), channel: getStore().device.relay?.channel ?? null });
    if (fingerprint(body) !== push.sentHash) await register(sub, push.prefs);
  } catch {
    // offline or Worker unreachable — try again next time the app opens
  }
}
