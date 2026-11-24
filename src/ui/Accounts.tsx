import { useRef, useState } from 'preact/hooks';
import { useApp, mutate, getStore } from '../model/store';
import { addSnapshots, aliasForAccount, latestBalances } from '../model/repo';
import type { Account } from '../model/types';
import { ACCOUNT_KIND_LABELS, GROWTH_KINDS, OWED_KINDS } from '../model/types';
import { currencySymbol, formatMoney } from '../logic/money';
import { MoneyInput } from './components/MoneyInput';
import { navigate } from '../router';
import { daysBetween, formatDay, STALE_AFTER_DAYS, toDay, todayISO } from '../logic/progress';
import { Icon } from './components/Icon';
import { looksLikeATypo, summariseCheckIn } from '../logic/checkin';
import { clearDraft, loadDraft, saveDraft, setLastCheckIn } from '../model/lastCheckIn';

/**
 * The accounts list, and — at #/update — the same list in update mode: every
 * balance becomes an input, and the ones that changed are saved together as
 * one batch of snapshots. Balances on the list are read-only; the Update
 * button is the one way in.
 */
export function Accounts({ updating = false }: { updating?: boolean }) {
  const app = useApp();
  const [showArchived, setShowArchived] = useState(false);
  // Update mode picks up where it left off if the app was closed mid-update.
  const [drafts, setDrafts] = useState<Map<string, number | null>>(() => (updating ? loadDraft() : new Map()));
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const inputs = useRef(new Map<string, HTMLInputElement>());

  // The list and update mode are separate instances (keyed in app.tsx), so
  // update mode always opens with no leftover edits.

  if (!app) return null;
  const { state } = app;
  const currency = state.settings.currency;
  const symbol = currencySymbol(currency);
  const balances = latestBalances(state);
  const today = toDay(todayISO());
  const t212Id = state.settings.t212?.accountId;

  // Archived accounts can be shown on the list, but are never updated.
  const visible = state.accounts.filter((a) => (updating ? !a.archived : showArchived || !a.archived));
  // Which group an account is in already says "debt" or "credit" in plain words
  // via the heading below — balances themselves stay in the ordinary text
  // colour rather than repeating that with debt/growth colour too.
  const groups: { title: string; accounts: Account[] }[] = [
    { title: 'Debt', accounts: visible.filter((a) => OWED_KINDS.includes(a.kind)) },
    { title: 'Savings & investments', accounts: visible.filter((a) => GROWTH_KINDS.includes(a.kind)) },
    {
      title: 'Everything else',
      accounts: visible.filter((a) => !OWED_KINDS.includes(a.kind) && !GROWTH_KINDS.includes(a.kind)),
    },
  ].filter((g) => g.accounts.length > 0);
  // Enter moves to the next input in on-screen order, across groups.
  const order = groups.flatMap((g) => g.accounts.map((a) => a.id));

  const groupTotal = (accounts: Account[]) =>
    accounts.reduce((sum, a) => (a.archived ? sum : sum + (balances.get(a.id)?.balance ?? 0)), 0);

  const changed = visible.filter((a) => {
    const draft = drafts.get(a.id);
    return draft !== undefined && draft !== null && draft !== (balances.get(a.id)?.balance ?? null);
  });

  const setDraft = (id: string, minor: number | null, isInvalid: boolean) => {
    setDrafts((prev) => {
      const next = new Map(prev).set(id, minor);
      saveDraft(next);
      return next;
    });
    setInvalid((prev) => {
      if (prev.has(id) === isInvalid) return prev;
      const next = new Set(prev);
      if (isInvalid) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  // Save, then go Home to see how the two of you did (the check-in card).
  const saveAll = async () => {
    if (changed.length === 0 || invalid.size > 0) return;
    const { device, state: before } = getStore();
    const at = new Date().toISOString();
    await mutate((s) =>
      addSnapshots(
        s,
        { deviceId: device.deviceId, now: at },
        changed.map((a) => ({ accountId: a.id, balance: drafts.get(a.id)!, at })),
      ),
    );
    const after = getStore().state;
    const ids = after.snapshots.slice(before.snapshots.length).map((s) => s.id);
    setLastCheckIn(summariseCheckIn(before, after, at, ids, toDay(todayISO())));
    clearDraft();
    navigate('/');
  };

  const cancel = () => {
    clearDraft();
    navigate('/accounts');
  };

  const pills = (a: Account) => {
    const latest = balances.get(a.id);
    const alias = aliasForAccount(state, a.id);
    const left = a.kind === 'credit_card' && a.promoEndsOn ? daysBetween(today, a.promoEndsOn) : -1;
    const age = latest ? daysBetween(toDay(latest.at), today) : 0;
    return (
      <>
        {alias && <span class="chip chip-alias">{alias.name}</span>}
        {t212Id === a.id && (
          <span class="chip" title="Updated daily from Trading 212">
            Auto
          </span>
        )}
        {a.archived && <span class="chip">Archived</span>}
        {!a.archived && left >= 0 && (
          <span class={`chip ${left <= 30 ? 'chip-warn' : ''}`} title="0% deal end date">
            0% until {formatDay(a.promoEndsOn!)}
          </span>
        )}
        {!a.archived && latest && t212Id !== a.id && age > STALE_AFTER_DAYS && (
          <span class="chip chip-warn" title="Balance not updated for over a month">
            Updated {age} days ago
          </span>
        )}
      </>
    );
  };

  return (
    <div>
      <header class="page-header">
        <h1>{updating ? 'Update' : 'Accounts'}</h1>
        <div class="header-actions">
          {updating ? (
            <button class="btn-sm" onClick={cancel}>
              Cancel
            </button>
          ) : (
            <>
              {/* The payday update is the main job here, so it's the primary button. */}
              {visible.some((a) => !a.archived) && (
                <button class="btn-sm btn-primary" onClick={() => navigate('/update')}>
                  <Icon name="update" size={16} />
                  Update
                </button>
              )}
              <button class="btn-icon" aria-label="Add account" onClick={() => navigate('/accounts/new')}>
                <Icon name="plus" size={20} />
              </button>
            </>
          )}
        </div>
      </header>
      {updating && (
        <p class="lede" style="margin:-8px 0 18px">
          Type the new figures for anything that's changed — leave the rest alone.
        </p>
      )}

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

      {groups.map((g) => (
        <section class="group" key={g.title}>
          <h2 class="group-label">
            {g.title}
            {!updating && <span class="group-total">{formatMoney(groupTotal(g.accounts), currency)}</span>}
          </h2>
          <div class="list">
            {g.accounts.map((a) => {
              const latest = balances.get(a.id);
              if (updating) {
                const i = order.indexOf(a.id);
                const current = latest?.balance ?? null;
                const draft = drafts.get(a.id);
                const isChanged = draft !== undefined && draft !== null && draft !== current;
                const isInvalid = invalid.has(a.id);
                const typo = isChanged && looksLikeATypo(current, draft);
                const noteId = `note-${a.id}`;
                return (
                  <div
                    class={`list-row account-row update-row ${isChanged ? 'changed' : ''} ${isInvalid ? 'is-invalid' : ''}`}
                    key={a.id}
                  >
                    <div class="grow">
                      <div class="row-title">{a.name}</div>
                      {isInvalid ? (
                        <div class="row-sub row-error" id={noteId}>
                          Not a valid amount
                        </div>
                      ) : typo ? (
                        <div class="row-sub row-warn num" id={noteId}>
                          {formatMoney(draft!, currency)}? It was {formatMoney(current!, currency)}
                        </div>
                      ) : (
                        <div class="row-sub num">
                          {t212Id === a.id && 'Auto daily · '}
                          {current !== null
                            ? `${OWED_KINDS.includes(a.kind) ? 'Owed' : 'Was'} ${formatMoney(current, currency)}`
                            : ACCOUNT_KIND_LABELS[a.kind]}
                        </div>
                      )}
                    </div>
                    <MoneyInput
                      initial={draft ?? current}
                      symbol={symbol}
                      ariaLabel={`New balance for ${a.name}`}
                      describedBy={isInvalid || typo ? noteId : undefined}
                      inputRef={(el) => {
                        if (el) inputs.current.set(a.id, el);
                        else inputs.current.delete(a.id);
                      }}
                      onChange={(minor, bad) => setDraft(a.id, minor, bad)}
                      onEnter={() => inputs.current.get(order[i + 1])?.focus()}
                    />
                  </div>
                );
              }
              return (
                <div class={`list-row account-row ${a.archived ? 'archived' : ''}`} key={a.id}>
                  <div
                    class="account-main"
                    onClick={() => navigate(`/accounts/${a.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/accounts/${a.id}`);
                      }
                    }}
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
                      {pills(a)}
                    </div>
                  </div>
                  <span class={`balance ${latest ? '' : 'unset'}`}>
                    {latest ? formatMoney(latest.balance, currency) : 'No balance yet'}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {updating ? (
        visible.length > 0 && (
          <div class="sticky-action">
            <button
              class="btn-primary btn-big"
              disabled={changed.length === 0 || invalid.size > 0}
              onClick={() => void saveAll()}
            >
              {invalid.size > 0
                ? `Fix the amount${invalid.size === 1 ? '' : 's'} in red first`
                : changed.length === 0
                  ? 'Nothing changed yet'
                  : `Save ${changed.length} update${changed.length === 1 ? '' : 's'}`}
            </button>
          </div>
        )
      ) : (
        <>
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
          {state.accounts.length > 0 && (
            <section class="group" style="margin-top:26px">
              <div class="list">
                <a href="#/aliases" class="list-row tappable btn-row" style="color:var(--text);text-decoration:none">
                  <Icon name="link" />
                  <span class="grow">
                    Aliases
                    <span class="row-sub" style="display:block">
                      Keep charts going after a bank switch
                    </span>
                  </span>
                  <Icon name="chevron" size={18} class="row-chevron" />
                </a>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
