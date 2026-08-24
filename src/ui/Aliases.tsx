import { useState } from 'preact/hooks';
import { useApp, mutate, getStore } from '../model/store';
import { addAlias, aliasSeries, repointAlias, updateAccount, updateAlias } from '../model/repo';
import { toDay, todayISO } from '../logic/progress';
import { Chart } from './components/Chart';

export function Aliases() {
  const app = useApp();
  const [newName, setNewName] = useState('');
  const [newAccountId, setNewAccountId] = useState('');
  const [repointing, setRepointing] = useState<string | null>(null);

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

  return (
    <div>
      <h1>Aliases</h1>
      <p class="muted" style="margin-bottom:14px">
        An alias is a role — like "Main Savings" — that you can point at whichever real account
        currently plays it. Switch banks and re-point the alias: its chart carries straight on.
      </p>

      {state.aliases
        .filter((al) => !al.archived)
        .map((al) => {
          const series = aliasSeries(state, al, today);
          const others = activeAccounts.filter((a) => a.id !== al.accountId);
          return (
            <div class="card" key={al.id}>
              <div class="row spread">
                <div>
                  <div class="account-name">{al.name}</div>
                  <div class="muted small">currently: {accountName(al.accountId)}</div>
                </div>
                <button style="padding:8px 12px" onClick={() => setRepointing(repointing === al.id ? null : al.id)}>
                  Re-point
                </button>
              </div>
              {series.length > 1 && (
                <div style="margin-top:10px">
                  <Chart series={series} currency={state.settings.currency} color="var(--accent)" />
                </div>
              )}
              {al.history.length > 1 && (
                <p class="muted small" style="margin-top:8px">
                  History: {al.history.map((h) => accountName(h.accountId)).join(' → ')}
                </p>
              )}
              {repointing === al.id && (
                <div style="margin-top:12px">
                  {others.length === 0 ? (
                    <p class="muted small">
                      No other active account to point at — add the new bank's account first (Accounts tab).
                    </p>
                  ) : (
                    <div class="stack">
                      <p class="muted small">
                        Point "{al.name}" at which account? The old account will be archived (its
                        history is kept and still shows in this alias's chart).
                      </p>
                      {others.map((a) => (
                        <button key={a.id} onClick={() => void repoint(al.id, a.id, al.accountId)}>
                          {a.name}
                          {a.institution ? ` · ${a.institution}` : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button
                class="small"
                style="margin-top:10px;padding:6px 10px;color:var(--text-dim)"
                onClick={() => {
                  const { device } = getStore();
                  void mutate((s) => updateAlias(s, { deviceId: device.deviceId }, al.id, { archived: true }));
                }}
              >
                Remove alias
              </button>
            </div>
          );
        })}

      <h2>New alias</h2>
      <div class="card">
        <label class="field">
          <span>Alias name</span>
          <input
            value={newName}
            onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
            placeholder='e.g. "Main Savings", "Emergency fund"'
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
        <button class="btn-primary btn-big" disabled={!newName.trim() || !newAccountId} onClick={() => void create()}>
          Create alias
        </button>
      </div>
    </div>
  );
}
