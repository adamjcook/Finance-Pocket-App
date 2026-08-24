import { useState } from 'preact/hooks';
import { useApp, mutate, getStore } from '../model/store';
import { addSnapshots, aliasForAccount, latestBalances } from '../model/repo';
import type { Account } from '../model/types';
import { ACCOUNT_KIND_LABELS, DEBT_KINDS, GROWTH_KINDS } from '../model/types';
import { formatMoney } from '../logic/money';
import { MoneyInput, currencySymbol } from './components/MoneyInput';
import { navigate } from '../app';

function ownerLabel(owner: Account['owner'], a: string, b: string): string {
  return owner === 'A' ? a : owner === 'B' ? b : 'Joint';
}

export function Accounts() {
  const app = useApp();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<number | null>(null);

  if (!app) return null;
  const { state } = app;
  const currency = state.settings.currency;
  const symbol = currencySymbol(currency);
  const balances = latestBalances(state);

  const commit = async (accountId: string) => {
    if (draft !== null) {
      const { device } = getStore();
      await mutate((s) => addSnapshots(s, { deviceId: device.deviceId }, [{ accountId, balance: draft }]));
    }
    setEditing(null);
    setDraft(null);
  };

  const visible = state.accounts.filter((a) => showArchived || !a.archived);
  const groups: { title: string; accounts: Account[] }[] = [
    { title: 'Debt', accounts: visible.filter((a) => DEBT_KINDS.includes(a.kind)) },
    { title: 'Savings & investments', accounts: visible.filter((a) => GROWTH_KINDS.includes(a.kind)) },
    {
      title: 'Everything else',
      accounts: visible.filter((a) => !DEBT_KINDS.includes(a.kind) && !GROWTH_KINDS.includes(a.kind)),
    },
  ];

  return (
    <div>
      <div class="row spread">
        <h1>Accounts</h1>
        <a href="#/aliases" class="btn" style="padding:8px 14px">
          Aliases
        </a>
      </div>

      {state.accounts.length === 0 && (
        <p class="muted">No accounts yet — tap + to add your first one.</p>
      )}

      {groups.map(
        (g) =>
          g.accounts.length > 0 && (
            <div key={g.title}>
              <h2>{g.title}</h2>
              <div class="card" style="padding:4px 12px">
                {g.accounts.map((a) => {
                  const alias = aliasForAccount(state, a.id);
                  const latest = balances.get(a.id);
                  return (
                    <div class="account-row" key={a.id} style={a.archived ? 'opacity:.55' : ''}>
                      <div
                        class="account-main"
                        onClick={() => navigate(`/accounts/${a.id}`)}
                        role="button"
                        tabIndex={0}
                      >
                        <div class="account-name">
                          {a.name}{' '}
                          {alias && <span class="chip chip-alias">{alias.name}</span>}
                          {a.archived && <span class="chip">archived</span>}
                        </div>
                        <div class="muted small">
                          {ownerLabel(a.owner, state.settings.partnerAName, state.settings.partnerBName)}
                          {' · '}
                          {a.institution || ACCOUNT_KIND_LABELS[a.kind]}
                        </div>
                      </div>
                      {editing === a.id ? (
                        <span class="row">
                          <MoneyInput
                            initial={latest?.balance ?? null}
                            symbol={symbol}
                            autoFocus
                            onChange={setDraft}
                            onEnter={() => void commit(a.id)}
                          />
                          <button class="btn-primary" style="padding:8px 12px" onClick={() => void commit(a.id)}>
                            ✓
                          </button>
                        </span>
                      ) : (
                        <button
                          class="balance-btn"
                          onClick={() => {
                            setEditing(a.id);
                            setDraft(latest?.balance ?? null);
                          }}
                          title="Tap to update this balance"
                        >
                          {latest ? formatMoney(latest.balance, currency) : 'set balance'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ),
      )}

      <label class="row muted small" style="margin-top:14px">
        <input
          type="checkbox"
          style="width:auto"
          checked={showArchived}
          onChange={(e) => setShowArchived((e.target as HTMLInputElement).checked)}
        />
        Show archived accounts
      </label>

      <button class="fab" aria-label="Add account" onClick={() => navigate('/accounts/new')}>
        +
      </button>
    </div>
  );
}
