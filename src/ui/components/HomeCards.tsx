import type { CheckIn } from '../../logic/checkin';
import { formatMoney } from '../../logic/money';
import { daysBetween, formatDay } from '../../logic/progress';
import { getStore, mutate } from '../../model/store';
import { voidSnapshot } from '../../model/repo';
import { markCheckInUndone, setLastCheckIn } from '../../model/lastCheckIn';
import { navigate } from '../../router';
import { Icon } from './Icon';

/**
 * The end of the payday update: how the two of you did since last time, any
 * milestones worth naming, and a way to take the update back. Changes that
 * went the wrong way are stated plainly, never as a telling-off.
 */
export function CheckInCard({
  checkIn,
  undone,
  names,
  currency,
}: {
  checkIn: CheckIn;
  undone: boolean;
  names: string;
  currency: string;
}) {
  const money = (minor: number) => formatMoney(Math.abs(minor), currency);
  const lines: { label: string; text: string; good: boolean }[] = [];
  if (checkIn.has.cards && checkIn.cardChange !== 0) {
    const down = checkIn.cardChange < 0;
    lines.push({ label: 'Card debt', text: `${down ? 'down' : 'up'} ${money(checkIn.cardChange)}`, good: down });
  }
  if (checkIn.has.loans && checkIn.loanChange !== 0) {
    const down = checkIn.loanChange < 0;
    lines.push({ label: 'Loans', text: `${down ? 'down' : 'up'} ${money(checkIn.loanChange)}`, good: down });
  }
  if (checkIn.has.savings && checkIn.savingsChange !== 0) {
    const up = checkIn.savingsChange > 0;
    lines.push({ label: 'Savings', text: `${up ? 'up' : 'down'} ${money(checkIn.savingsChange)}`, good: up });
  }
  const anyGood = checkIn.milestones.length > 0 || lines.some((l) => l.good);

  const dismiss = () => setLastCheckIn(null);
  const undo = async () => {
    const { device } = getStore();
    await mutate((s) =>
      checkIn.snapshotIds.reduce((acc, id) => voidSnapshot(acc, { deviceId: device.deviceId }, id), s),
    );
    markCheckInUndone();
  };

  if (undone) {
    return (
      <section class="home-card checkin" aria-live="polite">
        <div class="home-card-head">
          <h2>Update undone</h2>
          <button class="btn-icon btn-quiet" aria-label="Dismiss" onClick={dismiss}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <p class="home-card-text">Your balances are back as they were before it.</p>
        <button class="btn-sm" onClick={() => navigate('/update')}>
          Update again
        </button>
      </section>
    );
  }

  return (
    <section class="home-card checkin" aria-live="polite">
      <div class="home-card-head">
        <h2>{anyGood ? `Nicely done, ${names}` : `All up to date, ${names}`}</h2>
        <button class="btn-icon btn-quiet" aria-label="Dismiss" onClick={dismiss}>
          <Icon name="x" size={18} />
        </button>
      </div>
      {lines.length > 0 ? (
        <>
          <p class="home-card-text">Since your last update</p>
          <ul class="checkin-lines">
            {lines.map((l) => (
              <li key={l.label}>
                <span>{l.label}</span>
                <strong class={`num ${l.good ? 'positive' : ''}`}>{l.text}</strong>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p class="home-card-text">Balances saved. Nothing in your totals moved this time.</p>
      )}
      {checkIn.milestones.length > 0 && (
        <ul class="milestones">
          {checkIn.milestones.map((m) => (
            <li key={m}>
              <span class="milestone-mark" aria-hidden="true">
                <Icon name="check" size={14} />
              </span>
              {m}
            </li>
          ))}
        </ul>
      )}
      <button class="btn-sm btn-quiet checkin-undo" onClick={() => void undo()}>
        Undo this update
      </button>
    </section>
  );
}

/**
 * Shown on Home when balances haven't been updated since the latest payday,
 * so the monthly update is one tap from where the app opens.
 */
export function PaydayCard({ payday, today, lastUpdate }: { payday: string; today: string; lastUpdate: string | null }) {
  const isToday = payday === today;
  const since = lastUpdate ? daysBetween(lastUpdate, today) : null;
  return (
    <section class="home-card payday">
      <div class="home-card-head">
        <h2>{isToday ? "It's payday" : 'Time for your payday update'}</h2>
      </div>
      <p class="home-card-text">
        {lastUpdate
          ? `Last updated ${formatDay(lastUpdate)}${since !== null && since > 0 ? ` · ${since} day${since === 1 ? '' : 's'} ago` : ''}`
          : 'No balances typed in yet'}
      </p>
      <button class="btn-primary btn-big" onClick={() => navigate('/update')}>
        <Icon name="update" size={18} />
        Update balances
      </button>
    </section>
  );
}
