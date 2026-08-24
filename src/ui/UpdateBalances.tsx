import { useRef, useState } from 'preact/hooks';
import { useApp, mutate, getStore } from '../model/store';
import { addSnapshots, latestBalances } from '../model/repo';
import { ACCOUNT_KIND_LABELS } from '../model/types';
import { formatMoney } from '../logic/money';
import { MoneyInput, currencySymbol } from './components/MoneyInput';
import { navigate } from '../app';

/**
 * The core frequent action: run down all active accounts in one sitting,
 * edit only the ones that changed, save them all as one batch of snapshots.
 */
export function UpdateBalances() {
  const app = useApp();
  const [drafts, setDrafts] = useState<Map<string, number | null>>(new Map());
  const [saved, setSaved] = useState(false);
  const inputs = useRef<HTMLInputElement[]>([]);

  if (!app) return null;
  const { state } = app;
  const currency = state.settings.currency;
  const symbol = currencySymbol(currency);
  const balances = latestBalances(state);
  const accounts = state.accounts
    .filter((a) => !a.archived)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

  const changed = accounts.filter((a) => {
    const draft = drafts.get(a.id);
    return draft !== undefined && draft !== null && draft !== (balances.get(a.id)?.balance ?? null);
  });

  const saveAll = async () => {
    if (changed.length === 0) return;
    const { device } = getStore();
    const at = new Date().toISOString();
    await mutate((s) =>
      addSnapshots(
        s,
        { deviceId: device.deviceId, now: at },
        changed.map((a) => ({ accountId: a.id, balance: drafts.get(a.id)!, at })),
      ),
    );
    setDrafts(new Map());
    setSaved(true);
    setTimeout(() => navigate('/'), 900);
  };

  if (accounts.length === 0) {
    return (
      <div>
        <h1>Update balances</h1>
        <p class="muted">No active accounts yet — add some from the Accounts tab first.</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Update balances</h1>
      <p class="muted" style="margin-bottom:14px">
        Type the new figures for anything that's changed — leave the rest alone.
      </p>
      <div class="card" style="padding:6px 14px">
        {accounts.map((a, i) => (
          <div class="account-row" key={a.id}>
            <div class="account-main">
              <div class="account-name">{a.name}</div>
              <div class="muted small">
                {a.kind === 'credit_card' ? 'owed: ' : ''}
                {balances.has(a.id)
                  ? `now ${formatMoney(balances.get(a.id)!.balance, currency)}`
                  : ACCOUNT_KIND_LABELS[a.kind]}
              </div>
            </div>
            <MoneyInput
              initial={balances.get(a.id)?.balance ?? null}
              symbol={symbol}
              inputRef={(el) => {
                if (el) inputs.current[i] = el;
              }}
              onChange={(minor) => {
                setDrafts((prev) => new Map(prev).set(a.id, minor));
              }}
              onEnter={() => inputs.current[i + 1]?.focus()}
            />
          </div>
        ))}
      </div>
      <button class="btn-primary btn-big" disabled={changed.length === 0} onClick={() => void saveAll()}>
        {saved
          ? 'Saved ✓'
          : changed.length === 0
            ? 'Nothing changed yet'
            : `Save ${changed.length} update${changed.length === 1 ? '' : 's'}`}
      </button>
    </div>
  );
}
