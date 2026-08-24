import { useApp } from '../model/store';
import { debtProgress, growthProgress, toDay, todayISO } from '../logic/progress';
import { formatMoney } from '../logic/money';
import { Chart } from './components/Chart';
import { ProgressRing } from './components/ProgressRing';

function daysAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function Dashboard() {
  const app = useApp();
  if (!app) return null;
  const { state, device } = app;
  const currency = state.settings.currency;
  const today = toDay(todayISO());
  const debt = debtProgress(state, today);
  const growth = growthProgress(state, today);
  const syncOverdue =
    device.lastSyncAt !== null && Date.now() - new Date(device.lastSyncAt).getTime() > 14 * 86400000;

  return (
    <div>
      <h1>
        {state.settings.partnerAName} &amp; {state.settings.partnerBName}
      </h1>

      <h2>Credit card debt</h2>
      <div class="card">
        {debt.baseline > 0 ? (
          <>
            <div class="hero">
              <ProgressRing pct={debt.pct} />
              <div class="hero-figures">
                <div class="big-number">{formatMoney(debt.current, currency)}</div>
                <div class="muted">left to clear</div>
                <div class="small delta-up" style="margin-top:6px">
                  {formatMoney(debt.paidOff, currency)} of {formatMoney(debt.baseline, currency)} paid off
                </div>
              </div>
            </div>
            <div style="margin-top:12px">
              <Chart series={debt.series} currency={currency} color="var(--debt)" />
            </div>
          </>
        ) : (
          <p class="muted">
            No credit-card accounts yet. Add your cards and their balances to start tracking the
            payoff together.
          </p>
        )}
      </div>

      <h2>Savings &amp; investments</h2>
      <div class="card">
        {growth.series.length > 0 ? (
          <>
            <div class="row spread">
              <div>
                <div class="big-number">{formatMoney(growth.current, currency)}</div>
                <div class="muted">combined savings &amp; investments</div>
              </div>
              <div style="text-align:right">
                <div class={growth.delta30 >= 0 ? 'delta-up' : 'delta-down'}>
                  {growth.delta30 >= 0 ? '+' : ''}
                  {formatMoney(growth.delta30, currency)}
                </div>
                <div class="muted small">last 30 days</div>
              </div>
            </div>
            <div style="margin-top:12px">
              <Chart series={growth.series} currency={currency} color="var(--accent)" />
            </div>
          </>
        ) : (
          <p class="muted">No savings or investment accounts yet.</p>
        )}
      </div>

      <div class="stack" style="margin-top:18px">
        <a class="btn btn-primary btn-big" href="#/update">
          Update balances
        </a>
        <a class="btn btn-big" href="#/sync">
          Sync with partner
          {device.lastSyncAt ? (
            <span class="muted small"> — last synced {daysAgo(device.lastSyncAt)}</span>
          ) : (
            <span class="muted small"> — never synced</span>
          )}
        </a>
        {syncOverdue && (
          <p class="muted small" style="text-align:center">
            It's been a while since your phones talked — worth a sync next time you're together.
          </p>
        )}
      </div>
    </div>
  );
}
