import { useState } from 'preact/hooks';
import { useApp, mutate, getStore } from '../model/store';
import { addAlias, aliasSeries, repointAlias, updateAccount, updateAlias } from '../model/repo';
import { toDay, todayISO } from '../logic/progress';
import { Chart } from './components/Chart';
import { Icon } from './components/Icon';
import { navigate } from '../router';

export function Aliases() {
  const app = useApp();
  const [newName, setNewName] = useState('');
  const [newAccountId, setNewAccountId] = useState('');
  const [repointing, setRepointing] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  if (!app) return null;
  const { state } = app;
  const today = toDay(todayISO());
  const activeAccounts = state.accounts.filter((a) => !a.archived);
  const accountName = (id: string | null) =>
    state.accounts.find((a) => a.id === id)?.name ?? 'unknown account';

  const create = async () => {
    if (!newName.trim() || !newAccountId) return;
    const { device } = getStore();
    await mutate((s) => addAlias(s, { deviceId: device.deviceId }, newName.trim(), newAccountId));
    setNewName('');
    setNewAccountId('');
  };

  const repoint = async (aliasId: string, accountId: string, archiveOldId: string | null) => {
    const { device } = getStore();
    const ctx = { deviceId: device.deviceId };
    await mutate((s) => {
      let next = repointAlias(s, ctx, aliasId, accountId);
      if (archiveOldId) next = updateAccount(next, ctx, archiveOldId, { archived: true });
      return next;
    });
    setRepointing(null);
  };

  const live = state.aliases.filter((al) => !al.archived);

  return (
    <div>
      <button class="back-link" onClick={() => navigate('/accounts')}>
        <Icon name="back" size={20} />
        Accounts
      </button>
      <header class="page-header" style="display:block;padding-top:6px">
        <h1>Aliases</h1>
        <p class="lede">
          An alias is a role — like "Main Savings" — pointed at whichever real account currently
          plays it. Change banks, switch the alias over, and its chart carries straight on.
        </p>
      </header>

      {live.map((al) => {
        const series = aliasSeries(state, al, today);
        const others = activeAccounts.filter((a) => a.id !== al.accountId);
        return (
          <div class="card" key={al.id}>
            <div class="row spread" style="align-items:flex-start">
              <div class="grow">
                <div class="row" style="gap:8px">
                  <Icon name="link" size={18} class="faint" />
                  <span class="row-title">{al.name}</span>
                </div>
                <div class="row-sub" style="margin-top:2px">currently: {accountName(al.accountId)}</div>
              </div>
              <button class="btn-sm" onClick={() => setRepointing(repointing === al.id ? null : al.id)}>
                Switch account
              </button>
            </div>
            {series.length > 1 && <Chart series={series} currency={state.settings.currency} color="var(--accent)" />}
            {al.history.length > 1 && (
              <p class="small faint" style="margin-top:10px">
                History: {al.history.map((h) => accountName(h.accountId)).join(' → ')}
              </p>
            )}
            {repointing === al.id && (
              <div class="goal">
                {others.length === 0 ? (
                  <p>No other active account to point at — add the new bank's account first (Accounts tab).</p>
                ) : (
                  <>
                    <p style="margin-bottom:10px">
                      Point "{al.name}" at which account? The old account will be archived (its
                      history is kept and still shows in this alias's chart).
                    </p>
                    <div class="stack" style="gap:6px">
                      {others.map((a) => (
                        <button
                          key={a.id}
                          style="justify-content:space-between;background:var(--surface)"
                          onClick={() => void repoint(al.id, a.id, al.accountId)}
                        >
                          <span>
                            {a.name}
                            {a.institution ? ` · ${a.institution}` : ''}
                          </span>
                          <Icon name="chevron" size={16} class="row-chevron" />
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {/* Two taps: removing an alias drops its chart, and there's no undo. */}
            <button
              class={`btn-sm ${confirmRemove === al.id ? 'btn-danger' : 'btn-quiet'}`}
              style="margin:12px 0 0 -14px"
              onClick={() => {
                if (confirmRemove !== al.id) {
                  setConfirmRemove(al.id);
                  return;
                }
                setConfirmRemove(null);
                const { device } = getStore();
                void mutate((s) => updateAlias(s, { deviceId: device.deviceId }, al.id, { archived: true }));
              }}
              onBlur={() => setConfirmRemove((c) => (c === al.id ? null : c))}
            >
              {confirmRemove === al.id ? 'Tap again to remove' : 'Remove alias'}
            </button>
          </div>
        );
      })}

      <section class="group" style="margin-top:28px">
        <h2 class="group-label">New alias</h2>
        <div class="card">
          <label class="field">
            <span>Alias name</span>
            <input
              value={newName}
              onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
              placeholder="e.g. Main Savings"
            />
          </label>
          <label class="field">
            <span>Points at</span>
            <select value={newAccountId} onChange={(e) => setNewAccountId((e.target as HTMLSelectElement).value)}>
              <option value="">Choose an account…</option>
              {activeAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <button
            class="btn-primary btn-big"
            style="margin-top:18px"
            disabled={!newName.trim() || !newAccountId}
            onClick={() => void create()}
          >
            Create alias
          </button>
        </div>
      </section>
    </div>
  );
}
