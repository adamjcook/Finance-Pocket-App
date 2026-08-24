import { useApp } from '../model/store';
import {
  debtProgress,
  growthProgress,
  loanTotals,
  monthlyToTarget,
  toDay,
  todayISO,
} from '../logic/progress';
import { formatMoney } from '../logic/money';
import { Chart } from './components/Chart';
import { ProgressRing } from './components/ProgressRing';

function formatDay(day: string): string {
  return new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function Dashboard() {
  const app = useApp();
  if (!app) return null;
  const { state } = app;
  const { settings } = state;
  const currency = settings.currency;
  const today = toDay(todayISO());
  const debt = debtProgress(state, today);
  const growth = growthProgress(state, today);
  const loans = loanTotals(state, today);

  const debtTargetDate = settings.debtTargetDate ?? null;
  const debtMonthly = monthlyToTarget(debt.current, 0, 'down', debtTargetDate, today);
  const savingsTarget = settings.savingsTargetMinor ?? null;
  const savingsTargetDate = settings.savingsTargetDate ?? null;
  const savingsMonthly =
    savingsTarget !== null
      ? monthlyToTarget(growth.current, savingsTarget, 'up', savingsTargetDate, today)
      : null;

  return (
    <div>
      <h1>
        <span class="name-a">{settings.partnerAName}</span> &amp;{' '}
        <span class="name-b">{settings.partnerBName}</span>
      </h1>

      <h2>
        <span class="h2-dot" style="background:var(--debt)" />
        Credit card debt
      </h2>
      <div class="card card-debt">
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
            {debtTargetDate &&
              (debt.current === 0 ? (
                <p class="small delta-up" style="margin-top:10px">
                  Cards cleared — goal done 🎉
                </p>
              ) : debtMonthly !== null ? (
                <p class="small" style="margin-top:10px">
                  Goal: cleared by <strong>{formatDay(debtTargetDate)}</strong> — needs about{' '}
                  <strong>{formatMoney(debtMonthly, currency)}/month</strong>
                </p>
              ) : (
                <p class="muted small" style="margin-top:10px">
                  Goal date {formatDay(debtTargetDate)} has passed — set a new one in Settings.
                </p>
              ))}
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

      {loans.series.length > 0 && (
        <>
          <h2>
            <span class="h2-dot" style="background:color-mix(in srgb, var(--debt) 55%, var(--bg-raised))" />
            Loans
          </h2>
          <div class="card card-loan">
            <div class="row spread">
              <div>
                <div class="big-number">{formatMoney(loans.current, currency)}</div>
                <div class="muted">still owed on loans</div>
              </div>
            </div>
            {loans.series.length > 1 && (
              <div style="margin-top:12px">
                <Chart series={loans.series} currency={currency} color="var(--debt)" />
              </div>
            )}
          </div>
        </>
      )}

      <h2>
        <span class="h2-dot" style="background:var(--accent)" />
        Savings &amp; investments
      </h2>
      <div class="card card-growth">
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
            {savingsTarget !== null &&
              (growth.current >= savingsTarget ? (
                <p class="small delta-up" style="margin-top:10px">
                  Target of {formatMoney(savingsTarget, currency)} reached 🎉
                </p>
              ) : (
                <p class="small" style="margin-top:10px">
                  Target: <strong>{formatMoney(savingsTarget, currency)}</strong> (
                  {((growth.current / savingsTarget) * 100).toFixed(0)}% there)
                  {savingsMonthly !== null && savingsTargetDate ? (
                    <>
                      {' '}
                      — about <strong>{formatMoney(savingsMonthly, currency)}/month</strong> to get
                      there by {formatDay(savingsTargetDate)}
                    </>
                  ) : savingsTargetDate ? (
                    <span class="muted"> — goal date {formatDay(savingsTargetDate)} has passed</span>
                  ) : null}
                </p>
              ))}
            <div style="margin-top:12px">
              <Chart series={growth.series} currency={currency} color="var(--accent)" />
            </div>
          </>
        ) : (
          <p class="muted">No savings or investment accounts yet.</p>
        )}
      </div>

    </div>
  );
}
