import { useState } from 'preact/hooks';
import { useApp, mutate, getStore, patchDevice } from '../model/store';
import { updateSettings, voidSnapshot } from '../model/repo';
import { mergeState, stateHash, summarizeMerge } from '../logic/merge';
import { effectiveSnapshots } from '../logic/progress';
import { buildPayload } from '../sync/codec';
import { DEFAULT_PARTNER_A_COLOR, DEFAULT_PARTNER_B_COLOR, type SyncPayload } from '../model/types';
import { formatMoney } from '../logic/money';
import { MoneyInput, currencySymbol } from './components/MoneyInput';

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
    URL.revokeObjectURL(a.href);
  };

  const importFile = async (file: File) => {
    try {
      const payload = JSON.parse(await file.text()) as SyncPayload;
      if (payload.v !== 1 || !Array.isArray(payload.accounts)) {
        throw new Error('Not a FinPair backup file');
      }
      const before = getStore().state;
      const merged = mergeState(before, payload);
      await mutate(() => merged);
      const summary = summarizeMerge(before, merged);
      await patchDevice({ lastSyncStateHash: await stateHash(merged) });
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

  return (
    <div>
      <h1>Settings</h1>

      <h2>Appearance</h2>
      <div class="card">
        <p class="muted small" style="margin-bottom:10px">
          This is a per-phone preference — it doesn't sync to your partner's phone.
        </p>
        <div class="row">
          <button
            class={device.theme === 'dark' ? 'btn-primary' : ''}
            style="flex:1"
            aria-pressed={device.theme === 'dark'}
            onClick={() => void patchDevice({ theme: 'dark' })}
          >
            Dark
          </button>
          <button
            class={device.theme === 'light' ? 'btn-primary' : ''}
            style="flex:1"
            aria-pressed={device.theme === 'light'}
            onClick={() => void patchDevice({ theme: 'light' })}
          >
            Light
          </button>
        </div>
      </div>

      <h2>Names &amp; colours</h2>
      <div class="card">
        <p class="muted small" style="margin-bottom:10px">
          These names are shared between both phones and label who owns each account — keep them
          the same on both sides.
        </p>
        <label class="field">
          <span>Partner 1</span>
          <div class="row">
            <input
              style="flex:1"
              value={state.settings.partnerAName}
              onChange={(e) => saveField({ partnerAName: (e.target as HTMLInputElement).value })}
            />
            <input
              type="color"
              class="color-swatch"
              aria-label="Partner 1 colour"
              value={state.settings.partnerAColor ?? DEFAULT_PARTNER_A_COLOR}
              onInput={(e) => saveField({ partnerAColor: (e.target as HTMLInputElement).value })}
            />
          </div>
        </label>
        <label class="field">
          <span>Partner 2</span>
          <div class="row">
            <input
              style="flex:1"
              value={state.settings.partnerBName}
              onChange={(e) => saveField({ partnerBName: (e.target as HTMLInputElement).value })}
            />
            <input
              type="color"
              class="color-swatch"
              aria-label="Partner 2 colour"
              value={state.settings.partnerBColor ?? DEFAULT_PARTNER_B_COLOR}
              onInput={(e) => saveField({ partnerBColor: (e.target as HTMLInputElement).value })}
            />
          </div>
        </label>
        <p class="muted small">
          These colours label whose account is whose throughout the app — the dashboard names,
          owner dots, and section markers.
        </p>
      </div>

      <h2>Currency</h2>
      <div class="card">
        <select
          aria-label="Currency"
          value={currency}
          onChange={(e) => saveField({ currency: (e.target as HTMLSelectElement).value })}
        >
          {['GBP', 'EUR', 'USD'].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <h2>Debt baseline</h2>
      <div class="card">
        <p class="muted small" style="margin-bottom:10px">
          "Paid off" progress is measured against your highest recorded combined debt. Set a manual
          starting figure here if you'd rather measure from a specific point (e.g. what you owed
          when you started clearing it).
        </p>
        <div class="row">
          <MoneyInput
            initial={state.settings.debtBaselineMinor}
            symbol={currencySymbol(currency)}
            placeholder="auto (peak)"
            onChange={(minor) => saveField({ debtBaselineMinor: minor })}
          />
          {state.settings.debtBaselineMinor !== null && (
            <button onClick={() => saveField({ debtBaselineMinor: null })}>Use auto</button>
          )}
        </div>
      </div>

      <h2>Goals</h2>
      <div class="card">
        <label class="field">
          <span>Clear the credit cards by</span>
          <div class="row">
            <input
              type="date"
              value={state.settings.debtTargetDate ?? ''}
              onChange={(e) =>
                saveField({ debtTargetDate: (e.target as HTMLInputElement).value || null })
              }
            />
            {state.settings.debtTargetDate && (
              <button onClick={() => saveField({ debtTargetDate: null })}>Clear</button>
            )}
          </div>
        </label>
        <label class="field">
          <span>Clear the loans by</span>
          <div class="row">
            <input
              type="date"
              value={state.settings.loanTargetDate ?? ''}
              onChange={(e) =>
                saveField({ loanTargetDate: (e.target as HTMLInputElement).value || null })
              }
            />
            {state.settings.loanTargetDate && (
              <button onClick={() => saveField({ loanTargetDate: null })}>Clear</button>
            )}
          </div>
        </label>
        <label class="field">
          <span>Savings &amp; investments target</span>
          <div class="row">
            <MoneyInput
              initial={state.settings.savingsTargetMinor ?? null}
              symbol={currencySymbol(currency)}
              placeholder="no target"
              onChange={(minor) => saveField({ savingsTargetMinor: minor })}
            />
            {state.settings.savingsTargetMinor != null && (
              <button onClick={() => saveField({ savingsTargetMinor: null })}>Clear</button>
            )}
          </div>
        </label>
        <label class="field">
          <span>Reach the savings target by (optional)</span>
          <div class="row">
            <input
              type="date"
              value={state.settings.savingsTargetDate ?? ''}
              onChange={(e) =>
                saveField({ savingsTargetDate: (e.target as HTMLInputElement).value || null })
              }
            />
            {state.settings.savingsTargetDate && (
              <button onClick={() => saveField({ savingsTargetDate: null })}>Clear</button>
            )}
          </div>
        </label>
        <p class="muted small">
          The dashboard shows roughly how much per month gets you there. Goals sync to your
          partner's phone like everything else.
        </p>
      </div>

      <h2>Fix a mistyped balance</h2>
      <div class="card">
        <label class="field">
          <span>Account</span>
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
          <div class="account-row" key={s.id}>
            <div class="account-main">
              <div>{formatMoney(s.balance, currency)}</div>
              <div class="muted small">{s.at.slice(0, 16).replace('T', ' ')}</div>
            </div>
            <button
              class="btn-danger"
              style="padding:7px 12px"
              onClick={() => void mutate((st) => voidSnapshot(st, ctx(), s.id))}
            >
              Undo entry
            </button>
          </div>
        ))}
        {fixAccountId && fixSnapshots.length === 0 && (
          <p class="muted small">No entries recorded for this account.</p>
        )}
      </div>

      <h2>Backup</h2>
      <div class="card stack">
        <p class="muted small">
          Your data lives only on your two phones. Every now and then, save a backup file
          somewhere safe (it's the same format the sync uses).
        </p>
        <button class="btn-big" onClick={exportFile}>
          Export backup file
        </button>
        <label class="btn btn-big" style="display:block">
          Import / restore backup
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
        {importMsg && <p class="muted small">{importMsg}</p>}
      </div>

      <p class="muted small" style="margin-top:16px">
        This phone's device ID: {device.deviceId.slice(0, 8)} · data never leaves your phones
        except via Sync and backups.
      </p>
    </div>
  );
}
