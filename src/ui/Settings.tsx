import { useState } from 'preact/hooks';
import { useApp, mutate, getStore, patchDevice } from '../model/store';
import { updateSettings, voidSnapshot } from '../model/repo';
import { effectiveSnapshots, formatDay } from '../logic/progress';
import { asSyncPayload, buildPayload } from '../sync/codec';
import { CURRENCIES, DEFAULT_REMINDER_PREFS, GROWTH_KINDS, type ReminderPrefs, type T212Link } from '../model/types';
import { linkReady, pullReadings, readingNow, workerReady } from '../integrations/t212';
import {
  disableReminders,
  enableReminders,
  pushSupported,
  sendTestReminder,
  setReminderPref,
} from '../integrations/push';
import { mergePayload } from '../sync/apply';
import { currencySymbol, formatMoney } from '../logic/money';
import { MoneyInput } from './components/MoneyInput';
import { Icon } from './components/Icon';

export function Settings() {
  const app = useApp();
  const [fixAccountId, setFixAccountId] = useState('');
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [t212Busy, setT212Busy] = useState<'check' | 'reading' | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState<{ text: string; error: boolean } | null>(null);
  // Trading 212 and reminders are one-time setup most visits never need.
  const [connectionsOpen, setConnectionsOpen] = useState(false);

  if (!app) return null;
  const { state, device } = app;
  const currency = state.settings.currency;
  const ctx = () => ({ deviceId: getStore().device.deviceId });

  const saveField = (changes: Parameters<typeof updateSettings>[2]) =>
    void mutate((s) => updateSettings(s, ctx(), changes));

  const exportFile = () => {
    const payload = buildPayload(state, device.deviceId);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `finpair-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    // Revoking straight after click() can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const importFile = async (file: File) => {
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error("This file isn't a FinPair backup.");
      }
      // Not a sync with the partner, so it leaves the Sync screen's check code alone.
      const summary = await mergePayload(asSyncPayload(parsed));
      setImportMsg(
        `Imported ${plural(summary.newSnapshots, 'balance update')} and ${plural(summary.accountsChanged, 'account change')}.`,
      );
    } catch (err) {
      setImportMsg(`That file couldn't be imported. ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const link: T212Link = state.settings.t212 ?? { accountId: '', endpoint: '', token: '' };
  const saveLink = (changes: Partial<T212Link>) => {
    const next = { ...link, ...changes };
    saveField({ t212: next.accountId || next.endpoint || next.token ? next : null });
  };
  const runT212 = async (kind: 'check' | 'reading') => {
    setT212Busy(kind);
    try {
      await (kind === 'check' ? pullReadings({ force: true }) : readingNow());
    } catch {
      // the error is recorded on device.t212 and shown below
    } finally {
      setT212Busy(null);
    }
  };
  const t212Status = device.t212;
  const t212Accounts = state.accounts.filter((a) => GROWTH_KINDS.includes(a.kind) && !a.archived);

  const push = device.push;
  const prefs = push?.prefs ?? DEFAULT_REMINDER_PREFS;
  const runPush = async (action: () => Promise<void>, done?: string) => {
    setPushBusy(true);
    setPushMsg(null);
    try {
      await action();
      if (done) setPushMsg({ text: done, error: false });
    } catch (err) {
      setPushMsg({ text: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      setPushBusy(false);
    }
  };
  const reminderRow = (key: keyof ReminderPrefs, title: string, sub: string) => (
    <div class="list-row">
      <div class="grow">
        <div class="row-title">{title}</div>
        <div class="row-sub" style="white-space:normal">{sub}</div>
      </div>
      <button
        class="switch"
        role="switch"
        aria-checked={prefs[key]}
        aria-label={title}
        disabled={pushBusy}
        onClick={() => void runPush(() => setReminderPref(key, !prefs[key]))}
      />
    </div>
  );

  const nameOf = (who: 'A' | 'B') => (who === 'A' ? state.settings.partnerAName : state.settings.partnerBName);

  const fixSnapshots = fixAccountId
    ? effectiveSnapshots(state.snapshots, state.voids)
        .filter((s) => s.accountId === fixAccountId)
        .slice(-15)
        .reverse()
    : [];

  const clearButton = (label: string, onClick: () => void) => (
    <button type="button" class="clear-btn" aria-label={label} onClick={onClick}>
      <Icon name="x" />
    </button>
  );

  return (
    <div>
      <header class="page-header">
        <h1>Settings</h1>
      </header>

      <section class="group">
        <h2 class="group-label">Appearance</h2>
        <div class="list">
          <div class="list-row">
            <div class="segmented grow" role="group" aria-label="Theme">
              <button aria-pressed={device.theme === 'dark'} onClick={() => void patchDevice({ theme: 'dark' })}>
                Dark
              </button>
              <button aria-pressed={device.theme === 'light'} onClick={() => void patchDevice({ theme: 'light' })}>
                Light
              </button>
            </div>
          </div>
        </div>
        <p class="group-footer">Just for this phone — it doesn't sync to your partner's.</p>
      </section>

      <section class="group">
        <h2 class="group-label">You two</h2>
        <div class="list">
          {/* Which partner this phone belongs to — so the rows below can say
              "You" and "Your partner" and be right on both phones. */}
          <div class="list-row whose-phone">
            <span class="setting-label" id="whose-label">
              {device.me ? 'This phone is' : 'Which of you is this phone?'}
            </span>
            <div class="segmented" role="group" aria-labelledby="whose-label">
              {(['A', 'B'] as const).map((who) => (
                <button key={who} aria-pressed={device.me === who} onClick={() => void patchDevice({ me: who })}>
                  {nameOf(who)}
                </button>
              ))}
            </div>
          </div>
          {(device.me ? ([device.me, device.me === 'A' ? 'B' : 'A'] as const) : (['A', 'B'] as const)).map((who, i) => (
            <label class="list-row setting-row" key={who}>
              <span class="setting-label">{device.me ? (i === 0 ? 'You' : 'Your partner') : 'Name'}</span>
              <input
                value={nameOf(who)}
                onChange={(e) =>
                  saveField(
                    who === 'A'
                      ? { partnerAName: (e.target as HTMLInputElement).value }
                      : { partnerBName: (e.target as HTMLInputElement).value },
                  )
                }
              />
            </label>
          ))}
          <label class="list-row setting-row">
            <span class="setting-label">Currency</span>
            <select
              aria-label="Currency"
              value={currency}
              onChange={(e) => saveField({ currency: (e.target as HTMLSelectElement).value })}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p class="group-footer">
          Shared by both phones. The names label who owns each account, so keep them the same on
          both sides.
        </p>
      </section>

      <section class="group">
        <h2 class="group-label">How “paid off” is measured</h2>
        <div class="list">
          <label class="list-row setting-row">
            <span class="setting-label">Starting debt</span>
            <span class="setting-control">
              <MoneyInput
                initial={state.settings.debtBaselineMinor}
                symbol={currencySymbol(currency)}
                placeholder="Highest so far"
                onChange={(minor) => saveField({ debtBaselineMinor: minor })}
              />
              {state.settings.debtBaselineMinor !== null &&
                clearButton('Go back to your highest debt so far', () => saveField({ debtBaselineMinor: null }))}
            </span>
          </label>
        </div>
        <p class="group-footer">
          "Paid off" is measured against your highest recorded combined card debt. Set a figure
          here to measure from a specific point instead, like what you owed when you started.
        </p>
      </section>

      <section class="group">
        <h2 class="group-label">Undo a mistyped balance</h2>
        <div class="list">
          <label class="list-row setting-row">
            <span class="setting-label">Account</span>
            <select value={fixAccountId} onChange={(e) => setFixAccountId((e.target as HTMLSelectElement).value)}>
              <option value="">Choose…</option>
              {state.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {fixSnapshots.map((s) => (
            <div class="list-row" key={s.id}>
              <div class="grow">
                <div class="row-title num">{formatMoney(s.balance, currency)}</div>
                <div class="row-sub num">
                  {new Date(s.at).toLocaleString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
              <button
                class="btn-sm btn-danger"
                onClick={() => void mutate((st) => voidSnapshot(st, ctx(), s.id))}
              >
                Undo
              </button>
            </div>
          ))}
          {fixAccountId && fixSnapshots.length === 0 && (
            <div class="list-row row-sub">No entries recorded for this account.</div>
          )}
        </div>
        <p class="group-footer">Undoing an entry hides it everywhere, on both phones, without losing anything.</p>
      </section>

      <section class="group">
        <h2 class="group-label">Backup</h2>
        <div class="list">
          <button class="list-row tappable btn-row" onClick={exportFile}>
            <Icon name="download" />
            <span class="grow">Export backup file</span>
            <Icon name="chevron" size={18} class="row-chevron" />
          </button>
          <label class="list-row tappable btn-row">
            <Icon name="upload" />
            <span class="grow">Import / restore backup</span>
            <Icon name="chevron" size={18} class="row-chevron" />
            <input
              type="file"
              accept="application/json"
              style="display:none"
              onChange={(e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) void importFile(file);
              }}
            />
          </label>
        </div>
        <p class="group-footer">
          {importMsg ??
            "Your data lives only on your two phones. Every now and then, save a backup file somewhere safe — it's the same format the sync uses."}
        </p>
      </section>

      <section class="group">
        <h2 class="group-label">Connections (optional)</h2>
        <div class="list">
          <button
            class="list-row tappable btn-row"
            aria-expanded={connectionsOpen}
            aria-controls="connections"
            onClick={() => setConnectionsOpen(!connectionsOpen)}
          >
            <Icon name="link" />
            <span class="grow">
              Trading 212 and reminders
              <span class="row-sub" style="display:block">
                {workerReady(state.settings.t212)
                  ? [
                      linkReady(state.settings.t212) &&
                        `Linked to ${state.accounts.find((a) => a.id === state.settings.t212?.accountId)?.name ?? 'an account'}`,
                      push?.enabled ? 'reminders on' : 'reminders off',
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : 'Not set up · needs your own Worker'}
              </span>
            </span>
            <Icon name="chevron" size={18} class={`row-chevron ${connectionsOpen ? 'open' : ''}`} />
          </button>
        </div>
      </section>
      {connectionsOpen && (
        <div id="connections" class="connections">
      <section class="group">
        <h2 class="group-label">Trading 212</h2>
        <div class="list">
          <label class="list-row setting-row">
            <span class="setting-label">Linked account</span>
            <select
              aria-label="Trading 212 linked account"
              value={link.accountId}
              onChange={(e) => saveLink({ accountId: (e.target as HTMLSelectElement).value })}
            >
              <option value="">Not linked</option>
              {t212Accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label class="list-row setting-row">
            <span class="setting-label">Worker address</span>
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              spellcheck={false}
              placeholder="Paste address"
              value={link.endpoint}
              onChange={(e) => saveLink({ endpoint: (e.target as HTMLInputElement).value.trim() })}
            />
          </label>
          <label class="list-row setting-row">
            <span class="setting-label">Access token</span>
            <input
              type="password"
              name="finpair-token"
              autoComplete="off"
              placeholder="FINPAIR_TOKEN"
              value={link.token}
              onChange={(e) => saveLink({ token: (e.target as HTMLInputElement).value.trim() })}
            />
          </label>
          {linkReady(state.settings.t212) && (
            <div class="list-row" style="gap:8px">
              <button class="btn-sm grow" disabled={t212Busy !== null} onClick={() => void runT212('check')}>
                {t212Busy === 'check' ? 'Checking…' : 'Check now'}
              </button>
              <button class="btn-sm grow" disabled={t212Busy !== null} onClick={() => void runT212('reading')}>
                {t212Busy === 'reading' ? 'Reading…' : 'Read now'}
              </button>
            </div>
          )}
        </div>
        <p class={`group-footer ${t212Status?.error ? 'owed' : ''}`} role="status">
          {!linkReady(state.settings.t212)
            ? 'Records your Trading 212 account total at 9pm every day, so the chart shows each day’s change. Needs your own small Cloudflare Worker: the setup steps are under “Trading 212 link” in FinPair’s README on GitHub.'
            : t212Status?.error
              ? t212Status.error
              : t212Status?.latest
                ? `Last reading ${formatDay(t212Status.latest.day)}, ${new Date(t212Status.latest.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}: ${formatMoney(t212Status.latest.totalMinor, currency)}${t212Status.latest.final ? '' : ' (provisional — the 9pm reading replaces it)'}.`
                : 'Linked. The first reading arrives at 9pm, or tap “Read now”.'}
        </p>
        </section>

        <section class="group">
        <h2 class="group-label">Reminders</h2>
        <div class="list">
          <div class="list-row">
            <div class="grow">
              <div class="row-title">Notifications on this phone</div>
            </div>
            <button
              class="switch"
              role="switch"
              aria-checked={!!push?.enabled}
              aria-label="Notifications on this phone"
              disabled={pushBusy || !pushSupported() || !workerReady(state.settings.t212)}
              onClick={() =>
                void runPush(
                  push?.enabled ? disableReminders : enableReminders,
                  push?.enabled ? undefined : 'Reminders are on for this phone.',
                )
              }
            />
          </div>
          {push?.enabled && (
            <>
              {reminderRow('monthly', 'Update your balances', '9am on payday — the last working day of each month')}
              {reminderRow('promo', '0% deals ending', '30, 7 and 1 days before — set the date on each card')}
              {linkReady(state.settings.t212) &&
                reminderRow('drop', 'Trading 212 drops', 'When the linked account is down 5% or more on the week')}
              <div class="list-row">
                <button
                  class="btn-sm grow"
                  disabled={pushBusy}
                  onClick={() => void runPush(sendTestReminder, 'Test sent — it should appear in a few seconds.')}
                >
                  Send a test notification
                </button>
              </div>
            </>
          )}
        </div>
        <p class={`group-footer ${pushMsg?.error ? 'owed' : ''}`} role="status">
          {pushMsg?.text ??
            (!pushSupported()
              ? "This browser can't show notifications. Install FinPair to your home screen in Chrome to use reminders."
              : !workerReady(state.settings.t212)
                ? 'Reminders are sent by the same Worker as the Trading 212 link — add its address and token above first.'
                : 'Each phone chooses its own reminders. They come from your Worker, so they arrive even when FinPair is closed.')}
        </p>
        </section>

        </div>
      )}

      <p class="about">
        <Icon name="shield" size={16} />
        {workerReady(state.settings.t212)
          ? 'Your data stays on your two phones. Only Sync, your backup files and your own Worker (Trading 212 and reminders) take anything off them'
          : 'Your data never leaves your two phones except through Sync and the backup files you save'}{' '}
        · device {device.deviceId.slice(0, 8)}
      </p>
    </div>
  );
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
