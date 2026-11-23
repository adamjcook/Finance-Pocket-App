import { useRef, useState } from 'preact/hooks';
import { useApp, mutate, getStore } from '../model/store';
import { addSnapshots, latestBalances } from '../model/repo';
import { ACCOUNT_KIND_LABELS, GROWTH_KINDS, OWED_KINDS } from '../model/types';
import type { Account } from '../model/types';
import { currencySymbol, formatMoney } from '../logic/money';
import { MoneyInput } from './components/MoneyInput';
import { navigate } from '../router';
import { Icon } from './components/Icon';

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

  // Same grouping as the Accounts tab, so the two lists read alike.
  const groups: { title: string; accounts: Account[] }[] = [
    { title: 'Debt', accounts: accounts.filter((a) => OWED_KINDS.includes(a.kind)) },
    { title: 'Savings & investments', accounts: accounts.filter((a) => GROWTH_KINDS.includes(a.kind)) },
    {
      title: 'Everything else',
      accounts: accounts.filter((a) => !OWED_KINDS.includes(a.kind) && !GROWTH_KINDS.includes(a.kind)),
    },
  ].filter((g) => g.accounts.length > 0);
  // Enter moves to the next field in on-screen order, across groups.
  const order = groups.flatMap((g) => g.accounts.map((a) => a.id));

  if (accounts.length === 0) {
    return (
      <div>
        <header class="page-header">
          <h1>Update</h1>
        </header>
        <div class="empty">
          <div class="empty-icon">
            <Icon name="update" size={26} />
          </div>
          <h3>Nothing to update yet</h3>
          <p class="small">Add some accounts from the Accounts tab first.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <header class="page-header" style="display:block">
        <h1>Update</h1>
        <p class="lede">Type the new figures for anything that's changed — leave the rest alone.</p>
      </header>
      {groups.map((g) => (
        <section class="group" key={g.title}>
          <h2 class="group-label">{g.title}</h2>
          <div class="list">
            {g.accounts.map((a) => {
              const i = order.indexOf(a.id);
              const current = balances.get(a.id)?.balance ?? null;
              const draft = drafts.get(a.id);
              const isChanged = draft !== undefined && draft !== null && draft !== current;
              return (
                <div class={`list-row account-row update-row ${isChanged ? 'changed' : ''}`} key={a.id}>
                  <div class="grow">
                    <div class="row-title">{a.name}</div>
                    <div class="row-sub num">
                      {current !== null
                        ? `${OWED_KINDS.includes(a.kind) ? 'Owed' : 'Was'} ${formatMoney(current, currency)}`
                        : ACCOUNT_KIND_LABELS[a.kind]}
                    </div>
                  </div>
                  <MoneyInput
                    initial={current}
                    symbol={symbol}
                    ariaLabel={`New balance for ${a.name}`}
                    inputRef={(el) => {
                      if (el) inputs.current[i] = el;
                    }}
                    onChange={(minor) => {
                      setDrafts((prev) => new Map(prev).set(a.id, minor));
                    }}
                    onEnter={() => inputs.current[i + 1]?.focus()}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <div class="sticky-action">
        <button class="btn-primary btn-big" disabled={changed.length === 0} onClick={() => void saveAll()}>
          {saved ? (
            <>
              <Icon name="check" size={20} /> Saved
            </>
          ) : changed.length === 0 ? (
            'Nothing changed yet'
          ) : (
            `Save ${changed.length} update${changed.length === 1 ? '' : 's'}`
          )}
        </button>
      </div>
    </div>
  );
}
