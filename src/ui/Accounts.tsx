import { useState } from 'preact/hooks';
import { useApp, mutate, getStore } from '../model/store';
import { addSnapshots, aliasForAccount, latestBalances } from '../model/repo';
import type { Account } from '../model/types';
import { ACCOUNT_KIND_LABELS, GROWTH_KINDS, OWED_KINDS } from '../model/types';
import { currencySymbol, formatMoney } from '../logic/money';
import { MoneyInput } from './components/MoneyInput';
import { navigate } from '../router';
import { daysBetween, formatDay, STALE_AFTER_DAYS, toDay, todayISO } from '../logic/progress';
import { Icon } from './components/Icon';

/** Up to two initials from the account name, for its list avatar. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}

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
  const { partnerAName, partnerBName } = state.settings;
  const currency = state.settings.currency;
  const symbol = currencySymbol(currency);
  const balances = latestBalances(state);
  const today = toDay(todayISO());

  const commit = async (accountId: string) => {
    if (draft !== null) {
      const { device } = getStore();
      await mutate((s) => addSnapshots(s, { deviceId: device.deviceId }, [{ accountId, balance: draft }]));
    }
    setEditing(null);
    setDraft(null);
  };

  const visible = state.accounts.filter((a) => showArchived || !a.archived);
  // Which group an account is in already says "debt" or "credit" in plain words
  // via the heading below — balances themselves stay in the ordinary text
  // colour rather than repeating that with debt/growth colour too.
  const groups: { title: string; accounts: Account[] }[] = [
    {
      title: 'Debt',
      accounts: visible.filter((a) => OWED_KINDS.includes(a.kind)),
    },
    {
      title: 'Savings & investments',
      accounts: visible.filter((a) => GROWTH_KINDS.includes(a.kind)),
    },
    {
      title: 'Everything else',
      accounts: visible.filter((a) => !OWED_KINDS.includes(a.kind) && !GROWTH_KINDS.includes(a.kind)),
    },
  ];

  const groupTotal = (accounts: Account[]) =>
    accounts.reduce((sum, a) => (a.archived ? sum : sum + (balances.get(a.id)?.balance ?? 0)), 0);

  return (
    <div>
      <header class="page-header">
        <h1>Accounts</h1>
        <div class="header-actions">
          <a href="#/aliases" class="btn btn-sm">
            Aliases
          </a>
          <button class="btn-icon btn-primary" aria-label="Add account" onClick={() => navigate('/accounts/new')}>
            <Icon name="plus" size={20} />
          </button>
        </div>
      </header>

      {state.accounts.length === 0 && (
        <div class="empty">
          <div class="empty-icon">
            <Icon name="accounts" size={26} />
          </div>
          <h3>No accounts yet</h3>
          <p class="small">Add your cards, loans and savings — then keep their balances up to date together.</p>
          <button class="btn-primary" style="margin-top:18px" onClick={() => navigate('/accounts/new')}>
            Add your first account
          </button>
        </div>
      )}

      {visible.length > 0 && (
        <div class="owner-key">
          <span>
            <span class="owner-dot owner-dot-a" />
            {partnerAName}
          </span>
          <span>
            <span class="owner-dot owner-dot-b" />
            {partnerBName}
          </span>
          <span>
            <span class="owner-dot owner-dot-joint" />
            Joint
          </span>
        </div>
      )}

      {groups.map(
        (g) =>
          g.accounts.length > 0 && (
            <section class="group" key={g.title}>
              <h2 class="group-label">
                {g.title}
                <span class="group-total">{formatMoney(groupTotal(g.accounts), currency)}</span>
              </h2>
              <div class="list">
                {g.accounts.map((a) => {
                  const alias = aliasForAccount(state, a.id);
                  const latest = balances.get(a.id);
                  return (
                    <div class={`list-row with-avatar account-row ${a.archived ? 'archived' : ''}`} key={a.id}>
                      <span class="avatar">
                        <span aria-hidden="true">{initials(a.name)}</span>
                        <span
                          class={`owner-bar owner-bar-${a.owner === 'joint' ? 'joint' : a.owner.toLowerCase()}`}
                          role="img"
                          aria-label={ownerLabel(a.owner, partnerAName, partnerBName)}
                        />
                      </span>
                      <div
                        class="account-main"
                        onClick={() => navigate(`/accounts/${a.id}`)}
                        role="button"
                        tabIndex={0}
                      >
                        <div class="account-name">
                          <span class="name-text">{a.name}</span>
                        </div>
                        {/* Pills sit on the second line, after the bank, so they never
                            squeeze the account name off the first. */}
                        <div class="account-meta">
                          <span class="meta-text">{a.institution || ACCOUNT_KIND_LABELS[a.kind]}</span>
                          {alias && <span class="chip chip-alias">{alias.name}</span>}
                          {state.settings.t212?.accountId === a.id && (
                            <span class="chip" title="Updated daily from Trading 212">
                              Auto
                            </span>
                          )}
                          {a.archived && <span class="chip">Archived</span>}
                          {(() => {
                            if (a.archived || a.kind !== 'credit_card' || !a.promoEndsOn) return null;
                            const left = daysBetween(today, a.promoEndsOn);
                            if (left < 0) return null;
                            return (
                              <span class={`chip ${left <= 30 ? 'chip-warn' : ''}`} title="0% deal end date">
                                0% until {formatDay(a.promoEndsOn)}
                              </span>
                            );
                          })()}
                          {(() => {
                            if (a.archived || !latest || state.settings.t212?.accountId === a.id) return null;
                            const age = daysBetween(toDay(latest.at), today);
                            return age > STALE_AFTER_DAYS ? (
                              <span class="chip chip-warn" title="Balance not updated for over a month">
                                Updated {age} days ago
                              </span>
                            ) : null;
                          })()}
                        </div>
                      </div>
                      {editing === a.id ? (
                        <span class="inline-edit">
                          <MoneyInput
                            initial={latest?.balance ?? null}
                            symbol={symbol}
                            autoFocus
                            onChange={setDraft}
                            onEnter={() => void commit(a.id)}
                          />
                          <button
                            class="btn-icon btn-primary"
                            aria-label="Save balance"
                            onClick={() => void commit(a.id)}
                          >
                            <Icon name="check" size={20} />
                          </button>
                        </span>
                      ) : (
                        <button
                          class={`balance-btn ${latest ? '' : 'unset'}`}
                          onClick={() => {
                            setEditing(a.id);
                            setDraft(latest?.balance ?? null);
                          }}
                          title="Tap to update this balance"
                        >
                          {latest ? formatMoney(latest.balance, currency) : 'Set balance'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ),
      )}

      {state.accounts.some((a) => a.archived) && (
        <label class="toggle-row">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived((e.target as HTMLInputElement).checked)}
          />
          Show archived accounts
        </label>
      )}
    </div>
  );
}
