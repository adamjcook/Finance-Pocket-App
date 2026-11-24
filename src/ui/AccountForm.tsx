import { useState } from 'preact/hooks';
import { useApp, mutate, getStore } from '../model/store';
import { addAccount, updateAccount } from '../model/repo';
import type { AccountKind, Owner } from '../model/types';
import { ACCOUNT_KIND_LABELS, GROWTH_KINDS, OWED_KINDS } from '../model/types';
import { MoneyInput } from './components/MoneyInput';
import { currencySymbol } from '../logic/money';
import { navigate } from '../router';
import { Icon } from './components/Icon';

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
  const [goalMinor, setGoalMinor] = useState<number | null>(existing?.goalMinor ?? null);
  const [goalDate, setGoalDate] = useState(existing?.goalDate ?? '');
  const [promoEndsOn, setPromoEndsOn] = useState(existing?.promoEndsOn ?? '');

  if (!app) return null;
  if (id && !existing) return <p class="empty">Account not found.</p>;
  const { state } = app;

  const save = async () => {
    if (!name.trim()) return;
    const { device } = getStore();
    const ctx = { deviceId: device.deviceId };
    // Only keep the extras that apply to this kind of account.
    const isPot = GROWTH_KINDS.includes(kind);
    const extras = {
      goalMinor: isPot ? goalMinor : null,
      // Pots: the date to reach the target by. Cards/loans: the date to pay off by.
      goalDate: isPot ? (goalMinor !== null ? goalDate || null : null) : OWED_KINDS.includes(kind) ? goalDate || null : null,
      promoEndsOn: kind === 'credit_card' ? promoEndsOn || null : null,
    };
    if (existing) {
      await mutate((s) =>
        updateAccount(s, ctx, existing.id, {
          name: name.trim(),
          institution: institution.trim(),
          kind,
          owner,
          ...extras,
        }),
      );
    } else {
      await mutate((s) => addAccount(s, ctx, {
        name: name.trim(),
        institution: institution.trim(),
        kind,
        owner,
        openingBalance: opening,
        ...extras,
      }).state);
    }
    navigate('/accounts');
  };

  const setArchived = async (archived: boolean) => {
    const { device } = getStore();
    await mutate((s) => updateAccount(s, { deviceId: device.deviceId }, existing!.id, { archived }));
    navigate('/accounts');
  };

  const owners: { value: Owner; label: string }[] = [
    { value: 'A', label: state.settings.partnerAName },
    { value: 'B', label: state.settings.partnerBName },
    { value: 'joint', label: 'Joint' },
  ];

  return (
    <div>
      <button class="back-link" onClick={() => navigate('/accounts')}>
        <Icon name="back" size={20} />
        Accounts
      </button>
      <header class="page-header" style="padding-top:6px">
        <h1>{existing ? 'Edit account' : 'New account'}</h1>
      </header>

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
          <span>Bank or provider</span>
          <input
            value={institution}
            onInput={(e) => setInstitution((e.target as HTMLInputElement).value)}
            placeholder="Optional — e.g. Barclays"
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
        <div class="field">
          <span class="field-label" id="owner-label">
            Whose is it?
          </span>
          <div class="segmented" role="group" aria-labelledby="owner-label">
            {owners.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={owner === o.value}
                onClick={() => setOwner(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        {GROWTH_KINDS.includes(kind) && (
          <div class="field">
            <span class="field-label">Goal for this pot</span>
            <div class="row" style="gap:8px">
              <MoneyInput
                initial={goalMinor}
                symbol={currencySymbol(state.settings.currency)}
                placeholder="No goal"
                ariaLabel="Goal amount"
                onChange={setGoalMinor}
                wide
              />
              <input
                type="date"
                aria-label="Reach the goal by"
                value={goalDate}
                disabled={goalMinor === null}
                onInput={(e) => setGoalDate((e.target as HTMLInputElement).value)}
              />
            </div>
            <p class="field-hint">Optional. Add a date and Home works out the monthly amount.</p>
          </div>
        )}
        {OWED_KINDS.includes(kind) && (
          <label class="field">
            <span>Pay off by</span>
            <input
              type="date"
              aria-label="Pay off by"
              value={goalDate}
              onInput={(e) => setGoalDate((e.target as HTMLInputElement).value)}
            />
            <p class="field-hint">Optional. Home's Goals card shows the monthly amount it takes.</p>
          </label>
        )}
        {kind === 'credit_card' && (
          <label class="field">
            <span>0% deal ends</span>
            <input
              type="date"
              aria-label="0% deal ends"
              value={promoEndsOn}
              onInput={(e) => setPromoEndsOn((e.target as HTMLInputElement).value)}
            />
            <p class="field-hint">Optional. You can get a reminder 30, 7 and 1 days before.</p>
          </label>
        )}
        {!existing && (
          <label class="field">
            <span>{OWED_KINDS.includes(kind) ? 'Amount owed today' : 'Balance today'}</span>
            <MoneyInput
              initial={null}
              symbol={currencySymbol(state.settings.currency)}
              onChange={setOpening}
              wide
            />
            <p class="field-hint">Optional — you can add it later from Update.</p>
          </label>
        )}
      </div>

      <div class="stack" style="margin-top:20px">
        <button class="btn-primary btn-big" disabled={!name.trim()} onClick={() => void save()}>
          {existing ? 'Save changes' : 'Add account'}
        </button>
        <button class="btn-big btn-quiet" onClick={() => navigate('/accounts')}>
          Cancel
        </button>
      </div>

      {existing && (
        <section class="group" style="margin-top:30px">
          <button
            class={`btn-big ${existing.archived ? '' : 'btn-danger'}`}
            onClick={() => void setArchived(!existing.archived)}
          >
            {existing.archived ? 'Restore account' : 'Archive account'}
          </button>
          <p class="group-footer">
            {existing.archived
              ? 'This account is archived. Its history still counts up to the point it was archived.'
              : "Closed this account? Archiving hides it; its history still counts up to today, and it stays synced to your partner's phone."}
          </p>
        </section>
      )}
    </div>
  );
}
