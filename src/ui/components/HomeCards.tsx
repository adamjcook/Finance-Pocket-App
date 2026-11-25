import { useEffect, useState } from 'preact/hooks';
import { stateHash } from '../../logic/merge';
import { workerReady } from '../../integrations/t212';
import type { CheckIn } from '../../logic/checkin';
import type { DeviceState, SyncedState } from '../../model/types';
import {
  cardForecast,
  EMPTY_NEWS_MEMORY,
  homeNews,
  rememberDismissed,
  rememberForecast,
  rememberShown,
} from '../../logic/news';
import { formatMoneyWhole } from '../../logic/money';
import { daysBetween, formatDay } from '../../logic/progress';
import { getStore, mutate, patchDevice } from '../../model/store';
import { voidSnapshot } from '../../model/repo';
import { navigate } from '../../router';
import { Icon } from './Icon';

/**
 * The end of the payday update: how the two of you did, any milestones worth
 * naming, and (on the phone that saved it) a way to take it back. Worked out
 * from the shared history, so the partner who didn't do the update sees it
 * too. Changes that went the wrong way are stated plainly, never as a
 * telling-off, with one line of what's still true.
 */
export function CheckInCard({
  checkIn,
  undone,
  names,
  subtitle,
  perspective,
  currency,
  canUndo,
  celebrate = false,
  onDismiss,
}: {
  /** Null once the update has been undone. */
  checkIn: CheckIn | null;
  undone: boolean;
  names: string;
  /** "Since your last update", or "Adam updated on 30 Nov". */
  subtitle: string;
  /** For a month that went the wrong way: what's still true. */
  perspective: string | null;
  currency: string;
  /** Only the phone that saved the update offers to undo it. */
  canUndo: boolean;
  /** Net worth went up: the card arrives with a little more ceremony. */
  celebrate?: boolean;
  onDismiss: () => void;
}) {
  const money = (minor: number) => formatMoneyWhole(Math.abs(minor), currency);

  if (undone || !checkIn) {
    return (
      <section class="home-card checkin" aria-live="polite">
        <div class="home-card-head">
          <h2>Update undone</h2>
          <button class="btn-icon btn-quiet" aria-label="Dismiss" onClick={onDismiss}>
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
  // Judged on the whole picture: savings up £250 doesn't make a month where
  // card debt rose by much more a "nicely done" one.
  const anyGood = checkIn.milestones.length > 0 || checkIn.netChange > 0;

  const undo = async () => {
    const { device } = getStore();
    await mutate((s) =>
      checkIn.snapshotIds.reduce((acc, id) => voidSnapshot(acc, { deviceId: device.deviceId }, id), s),
    );
  };

  return (
    <section class={`home-card checkin ${celebrate ? 'celebrate' : ''}`} aria-live="polite">
      <div class="home-card-head">
        <h2>{anyGood ? `Nicely done, ${names}` : `All up to date, ${names}`}</h2>
        <button class="btn-icon btn-quiet" aria-label="Dismiss" onClick={onDismiss}>
          <Icon name="x" size={18} />
        </button>
      </div>
      <p class="home-card-text">{subtitle}</p>
      {lines.length > 0 ? (
        <ul class="checkin-lines">
          {lines.map((l) => (
            <li key={l.label}>
              <span>{l.label}</span>
              <strong class={`num ${l.good ? 'positive' : ''}`}>{l.text}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p class="home-card-text">Balances saved. Nothing in your totals moved this time.</p>
      )}
      {!anyGood && perspective && <p class="checkin-perspective">{perspective}</p>}
      {checkIn.milestones.length > 0 && (
        <ul class="milestones">
          {checkIn.milestones.map((m, i) => (
            <li key={m} style={`--i:${i}`}>
              <span class="milestone-mark" aria-hidden="true">
                <Icon name="check" size={14} />
              </span>
              {m}
            </li>
          ))}
        </ul>
      )}
      {canUndo && (
        <button class="btn-sm btn-quiet checkin-undo" onClick={() => void undo()}>
          Undo this update
        </button>
      )}
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

/**
 * One line of news, only on days there is some (see logic/news.ts). Always
 * mounted so this phone keeps noticing forecast changes; renders nothing when
 * quiet or when a check-in or payday card already has the top of Home.
 */
export function NewsLine({ state, device, today, hidden }: { state: SyncedState; device: DeviceState; today: string; hidden: boolean }) {
  const memory = device.news ?? EMPTY_NEWS_MEMORY;
  const forecast = cardForecast(state, today);
  useEffect(() => {
    const next = rememberForecast(memory, forecast, today);
    if (next !== memory) void patchDevice({ news: next });
  }, [forecast]);

  const news = hidden ? null : homeNews(state, today, memory);
  useEffect(() => {
    if (!news) return;
    const next = rememberShown(memory, news.key, today);
    if (next !== memory) void patchDevice({ news: next });
  }, [news?.key]);

  if (!news) return null;
  return (
    <section class="home-card news" aria-live="polite">
      <p>{news.text}</p>
      <button
        class="btn-icon btn-quiet"
        aria-label="Dismiss"
        onClick={() => void patchDevice({ news: rememberDismissed(memory, news.key) })}
      >
        <Icon name="x" size={18} />
      </button>
    </section>
  );
}

/**
 * One quiet line under net worth saying whether the two phones agree — the
 * "one honest picture" made visible. It only claims what this phone can know:
 * the partner's last copy matching, this phone's changes sent but not yet
 * picked up, or not sent at all.
 */
export function SyncLine({ state, device }: { state: SyncedState; device: DeviceState }) {
  const [hash, setHash] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void stateHash(state).then((h) => live && setHash(h));
    return () => {
      live = false;
    };
  }, [state]);
  if (!hash) return null;

  const { partnerAName, partnerBName } = state.settings;
  const partner = device.me === 'A' ? partnerBName : device.me === 'B' ? partnerAName : null;
  const theirPhone = partner ? `${partner}’s phone` : 'your partner’s phone';
  const relay = device.relay;
  const auto = !!relay?.key && relay.enabled !== false && workerReady(state.settings.t212);
  const when = (iso: string) => {
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const day = iso.slice(0, 10);
    return day === new Date().toISOString().slice(0, 10)
      ? `today at ${new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
      : `on ${formatDay(day)}`;
  };

  let text: string;
  let agreed = false;
  if (auto) {
    if (relay!.partnerHash === hash) {
      agreed = true;
      text = `Same on ${theirPhone}${relay!.checkedAt ? ` · checked ${when(relay!.checkedAt)}` : ''}`;
    } else if (relay!.error) {
      text = `Couldn’t check ${theirPhone}`;
    } else if (relay!.pushedHash === hash) {
      text = `Sent to ${theirPhone}: it updates next time FinPair opens there`;
    } else {
      text = `Not on ${theirPhone} yet`;
    }
  } else if (device.lastSyncAt) {
    agreed = device.lastSyncStateHash === hash;
    text = agreed
      ? `Same as ${theirPhone} · synced ${when(device.lastSyncAt)}`
      : `Changed since you last synced with ${theirPhone.replace('’s phone', '')}`;
  } else {
    text = `Not synced with ${theirPhone} yet`;
  }

  return agreed ? (
    <p class="sync-line agreed">
      <Icon name="check" size={14} />
      {text}
    </p>
  ) : (
    <a class="sync-line" href="#/sync">
      <Icon name="sync" size={14} />
      {text}
      <span class="sync-line-action">Sync</span>
    </a>
  );
}
