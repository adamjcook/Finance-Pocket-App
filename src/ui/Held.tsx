import { useEffect } from 'preact/hooks';
import type { Account, SyncedState } from '../model/types';
import { ACCOUNT_KIND_LABELS, JUNIOR_KINDS, PENSION_KINDS } from '../model/types';
import { useApp } from '../model/store';
import { heldProgress, monthlyToTarget, dueWithinMonth, formatDay, toDay, todayISO } from '../logic/progress';
import { formatMoneyWhole } from '../logic/money';
import { navigate } from '../router';
import { Chart } from './components/Chart';
import { Icon } from './components/Icon';

/**
 * Money held apart from net worth: pensions (can't be used yet) and
 * children's Junior ISAs (their money). Home shows them as one compact card
 * of rows, a row per account, so another child's ISA adds a line rather than
 * a whole card; each row opens this page, where the charts and goals live.
 */

/** Pensions first, then children's accounts, each in the order they were added. */
export function heldAccounts(state: SyncedState): Account[] {
  const active = state.accounts.filter((a) => !a.archived);
  return [
    ...active.filter((a) => PENSION_KINDS.includes(a.kind)),
    ...active.filter((a) => JUNIOR_KINDS.includes(a.kind)),
  ];
}

/** One account's total, 30-day change and history. */
export function accountProgress(state: SyncedState, account: Account, today: string) {
  return heldProgress({ ...state, accounts: [account] }, [account.kind], today);
}

function Goal({ account, current, currency, today }: { account: Account; current: number; currency: string; today: string }) {
  const goal = account.goalMinor ?? 0;
  if (goal <= 0) return null;
  const pct = Math.max(0, Math.min(100, (current / goal) * 100));
  const monthly = monthlyToTarget(current, goal, 'up', account.goalDate ?? null, today);
  return (
    <div class="held-goal">
      <div class="goal-bar" role="img" aria-label={`${account.name}: ${pct.toFixed(0)}% of goal`}>
        <span style={`width:${pct}%`} />
      </div>
      <div class="pot-note num">
        {current >= goal ? (
          <span class="positive done-note">
            <Icon name="check" size={14} /> Goal of {formatMoneyWhole(goal, currency)} reached
          </span>
        ) : (
          <>
            {formatMoneyWhole(current, currency)} of {formatMoneyWhole(goal, currency)}
            {account.goalDate && monthly !== null && dueWithinMonth(today, account.goalDate) && (
              <> · due by {formatDay(account.goalDate)}</>
            )}
            {account.goalDate && monthly !== null && !dueWithinMonth(today, account.goalDate) && (
              <>
                {' '}
                · about <strong>{formatMoneyWhole(monthly, currency)}/month</strong> by {formatDay(account.goalDate)}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Home's card body: a row per account, each opening its place on the Held apart page. */
export function HeldRows({
  state,
  today,
  change,
  window,
}: {
  state: SyncedState;
  today: string;
  /** The change to show for an account, in the same window as Home's other cards. */
  change: (account: Account, progress: ReturnType<typeof accountProgress>) => number;
  window: string;
}) {
  const currency = state.settings.currency;
  return (
    <div class="dash-body held-rows">
      {heldAccounts(state).map((a) => {
        const p = accountProgress(state, a, today);
        const moved = change(a, p);
        return (
          <a class="held-row" href={`#/held/${a.id}`} key={a.id}>
            <span class="held-row-main">
              <span class="held-row-name">{a.name}</span>
              <span class="held-row-sub">
                {ACCOUNT_KIND_LABELS[a.kind]}
                {moved !== 0 && (
                  <>
                    {' · '}
                    <span class={moved > 0 ? 'positive' : ''}>
                      {moved > 0 ? 'up' : 'down'} {formatMoneyWhole(Math.abs(moved), currency)}
                    </span>{' '}
                    {window}
                  </>
                )}
              </span>
            </span>
            <span class="held-row-figure num">{formatMoneyWhole(p.current, currency)}</span>
            <Icon name="chevron" size={18} class="row-chevron" />
          </a>
        );
      })}
    </div>
  );
}

/** #/held and #/held/<accountId>: every held account with its chart and goal. */
export function HeldPage({ focus }: { focus: string | null }) {
  const app = useApp();
  useEffect(() => {
    if (!focus) return;
    document.getElementById(`held-${focus}`)?.scrollIntoView({ block: 'start' });
  }, [focus]);
  if (!app) return null;
  const { state } = app;
  const today = toDay(todayISO());
  const currency = state.settings.currency;
  const accounts = heldAccounts(state);

  return (
    <div>
      <button class="back-link" onClick={() => navigate('/')}>
        <Icon name="back" size={20} />
        Home
      </button>
      <header class="page-header" style="display:block;padding-top:6px">
        <h1>Held apart</h1>
        <p class="lede">
          Pensions and your children's savings. They're kept out of net worth: a pension can't be
          used until you retire, and a Junior ISA is your child's money.
        </p>
      </header>
      {accounts.length === 0 && <p class="empty-note">No pensions or Junior ISAs yet. Add one from Accounts.</p>}
      {accounts.map((a) => {
        const p = accountProgress(state, a, today);
        return (
          <section class={`dash-section held-section ${focus === a.id ? 'focused' : ''}`} id={`held-${a.id}`} key={a.id}>
            <h2>{a.name}</h2>
            <div class="dash-body">
              <div class="figure-row">
                <div class="grow">
                  <div class="big-number">{formatMoneyWhole(p.current, currency)}</div>
                  <div class="figure-caption">
                    {ACCOUNT_KIND_LABELS[a.kind]}
                    {a.institution ? ` · ${a.institution}` : ''}
                  </div>
                </div>
                {p.delta30 !== 0 && (
                  <div>
                    <span class={`delta ${p.delta30 > 0 ? 'delta-up' : 'delta-flat'}`}>
                      <Icon name={p.delta30 > 0 ? 'up' : 'down'} />
                      <span class="visually-hidden">{p.delta30 > 0 ? 'up ' : 'down '}</span>
                      {formatMoneyWhole(Math.abs(p.delta30), currency)}
                    </span>
                    <div class="delta-note">last 30 days</div>
                  </div>
                )}
              </div>
              {p.series.length > 1 && <Chart series={p.series} currency={currency} color="var(--accent)" />}
              <Goal account={a} current={p.current} currency={currency} today={today} />
              <button class="btn-sm btn-quiet held-edit" onClick={() => navigate(`/accounts/${a.id}`)}>
                Edit account
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
