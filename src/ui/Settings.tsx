import { useState } from 'preact/hooks';
import { useApp, mutate, getStore, patchDevice } from '../model/store';
import { updateSettings, voidSnapshot } from '../model/repo';
import { effectiveSnapshots } from '../logic/progress';
import { asSyncPayload, buildPayload } from '../sync/codec';
import { CURRENCIES } from '../model/types';
import { mergePayload } from '../sync/apply';
import { currencySymbol, formatMoney } from '../logic/money';
import { MoneyInput } from './components/MoneyInput';
import { Icon } from './components/Icon';

export function Settings() {
  const app = useApp();
  const [fixAccountId, setFixAccountId] = useState('');
  const [importMsg, setImportMsg] = useState<string | null>(null);

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
        `Imported: ${summary.newSnapshots} balance update(s), ${summary.accountsChanged} account change(s).`,
      );
    } catch (err) {
      setImportMsg(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

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

  const dateRow = (label: string, value: string | null | undefined, onChange: (v: string | null) => void) => (
    <label class="list-row setting-row">
      <span class="setting-label">{label}</span>
      <span class="setting-control">
        <input
          type="date"
          value={value ?? ''}
          onChange={(e) => onChange((e.target as HTMLInputElement).value || null)}
        />
        {value && clearButton(`Clear ${label.toLowerCase()}`, () => onChange(null))}
      </span>
    </label>
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
          <label class="list-row setting-row">
            <span class="setting-label row" style="gap:8px">
              <span class="owner-dot owner-dot-a" />
              Partner 1
            </span>
            <input
              value={state.settings.partnerAName}
              onChange={(e) => saveField({ partnerAName: (e.target as HTMLInputElement).value })}
            />
          </label>
          <label class="list-row setting-row">
            <span class="setting-label row" style="gap:8px">
              <span class="owner-dot owner-dot-b" />
              Partner 2
            </span>
            <input
              value={state.settings.partnerBName}
              onChange={(e) => saveField({ partnerBName: (e.target as HTMLInputElement).value })}
            />
          </label>
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
        <h2 class="group-label">Goals</h2>
        <div class="list">
          {dateRow('Clear the cards by', state.settings.debtTargetDate, (v) => saveField({ debtTargetDate: v }))}
          {dateRow('Clear the loans by', state.settings.loanTargetDate, (v) => saveField({ loanTargetDate: v }))}
          <label class="list-row setting-row">
            <span class="setting-label">Savings target</span>
            <span class="setting-control">
              <MoneyInput
                initial={state.settings.savingsTargetMinor ?? null}
                symbol={currencySymbol(currency)}
                placeholder="no target"
                onChange={(minor) => saveField({ savingsTargetMinor: minor })}
              />
              {state.settings.savingsTargetMinor != null &&
                clearButton('Clear savings target', () => saveField({ savingsTargetMinor: null }))}
            </span>
          </label>
          {dateRow('Reach it by', state.settings.savingsTargetDate, (v) => saveField({ savingsTargetDate: v }))}
        </div>
        <p class="group-footer">
          The dashboard works out roughly how much per month gets you there. Goals sync to your
          partner's phone like everything else.
        </p>
      </section>

      <section class="group">
        <h2 class="group-label">Debt baseline</h2>
        <div class="list">
          <label class="list-row setting-row">
            <span class="setting-label">Starting debt</span>
            <span class="setting-control">
              <MoneyInput
                initial={state.settings.debtBaselineMinor}
                symbol={currencySymbol(currency)}
                placeholder="auto (peak)"
                onChange={(minor) => saveField({ debtBaselineMinor: minor })}
              />
              {state.settings.debtBaselineMinor !== null &&
                clearButton('Use auto', () => saveField({ debtBaselineMinor: null }))}
            </span>
          </label>
        </div>
        <p class="group-footer">
          "Paid off" is measured against your highest recorded combined card debt. Set a figure
          here to measure from a specific point instead, like what you owed when you started.
        </p>
      </section>

      <section class="group">
        <h2 class="group-label">Fix a mistyped balance</h2>
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
                <div class="row-sub num">{s.at.slice(0, 16).replace('T', ' ')}</div>
              </div>
              <button
                class="btn-sm btn-danger"
                onClick={() => void mutate((st) => voidSnapshot(st, ctx(), s.id))}
              >
                Undo entry
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

      <p class="about">
        <Icon name="shield" size={16} />
        Data never leaves your phones except via Sync and backups · device {device.deviceId.slice(0, 8)}
      </p>
    </div>
  );
}
