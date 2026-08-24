import { useState } from 'preact/hooks';
import { useApp, mutate, getStore } from '../model/store';
import { addAccount, updateAccount } from '../model/repo';
import type { AccountKind, Owner } from '../model/types';
import { ACCOUNT_KIND_LABELS } from '../model/types';
import { MoneyInput, currencySymbol } from './components/MoneyInput';
import { navigate } from '../app';

interface Props {
  id: string | null; // null = create
}

export function AccountForm({ id }: Props) {
  const app = useApp();
  const existing = id ? app?.state.accounts.find((a) => a.id === id) : undefined;

  const [name, setName] = useState(existing?.name ?? '');
  const [institution, setInstitution] = useState(existing?.institution ?? '');
  const [kind, setKind] = useState<AccountKind>(existing?.kind ?? 'credit_card');
  const [owner, setOwner] = useState<Owner>(existing?.owner ?? 'joint');
  const [opening, setOpening] = useState<number | null>(null);

  if (!app) return null;
  if (id && !existing) return <p class="muted">Account not found.</p>;
  const { state } = app;

  const save = async () => {
    if (!name.trim()) return;
    const { device } = getStore();
    const ctx = { deviceId: device.deviceId };
    if (existing) {
      await mutate((s) =>
        updateAccount(s, ctx, existing.id, { name: name.trim(), institution: institution.trim(), kind, owner }),
      );
    } else {
      await mutate((s) => addAccount(s, ctx, {
        name: name.trim(),
        institution: institution.trim(),
        kind,
        owner,
        openingBalance: opening,
      }).state);
    }
    navigate('/accounts');
  };

  const setArchived = async (archived: boolean) => {
    const { device } = getStore();
    await mutate((s) => updateAccount(s, { deviceId: device.deviceId }, existing!.id, { archived }));
    navigate('/accounts');
  };

  return (
    <div>
      <h1>{existing ? 'Edit account' : 'New account'}</h1>
      <div class="card">
        <label class="field">
          <span>Name</span>
          <input
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            placeholder="e.g. Barclaycard, Marcus saver"
            autofocus={!existing}
          />
        </label>
        <label class="field">
          <span>Bank / provider (optional)</span>
          <input
            value={institution}
            onInput={(e) => setInstitution((e.target as HTMLInputElement).value)}
            placeholder="e.g. Barclays"
          />
        </label>
        <label class="field">
          <span>Type</span>
          <select value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value as AccountKind)}>
            {(Object.keys(ACCOUNT_KIND_LABELS) as AccountKind[]).map((k) => (
              <option key={k} value={k}>
                {ACCOUNT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>Whose is it?</span>
          <select value={owner} onChange={(e) => setOwner((e.target as HTMLSelectElement).value as Owner)}>
            <option value="A">{state.settings.partnerAName}</option>
            <option value="B">{state.settings.partnerBName}</option>
            <option value="joint">Joint</option>
          </select>
        </label>
        {!existing && (
          <label class="field">
            <span>{kind === 'credit_card' ? 'Current amount owed' : 'Current balance'} (optional)</span>
            <MoneyInput initial={null} symbol={currencySymbol(state.settings.currency)} onChange={setOpening} />
          </label>
        )}
        <div class="stack">
          <button class="btn-primary btn-big" disabled={!name.trim()} onClick={() => void save()}>
            {existing ? 'Save changes' : 'Add account'}
          </button>
          <button class="btn-big" onClick={() => navigate('/accounts')}>
            Cancel
          </button>
        </div>
      </div>

      {existing && (
        <div class="card">
          {existing.archived ? (
            <>
              <p class="muted small" style="margin-bottom:10px">
                This account is archived. Its history still counts up to the point it was archived.
              </p>
              <button class="btn-big" onClick={() => void setArchived(false)}>
                Restore account
              </button>
            </>
          ) : (
            <>
              <p class="muted small" style="margin-bottom:10px">
                Closed this account? Archiving hides it and stops it counting towards your totals —
                all its history is kept and it stays synced to your partner's phone.
              </p>
              <button class="btn-danger btn-big" onClick={() => void setArchived(true)}>
                Archive account
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
