import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useApp, patchDevice } from '../model/store';
import {
  effectiveSnapshots,
  debtProgress,
  changeSince,
  dayBefore,
  daysBetween,
  formatDay,
  growthProgress,
  lastManualUpdate,
  latestPayday,
  loanProgress,
  monthlyToTarget,
  dueWithinMonth,
  toDay,
  todayISO,
} from '../logic/progress';
import { formatMoneyWhole } from '../logic/money';
import { lastWorkingDay } from '../../worker/src/ukdates';
import { checkInFor, latestUpdateBatch } from '../logic/checkin';
import { heldAccounts, HeldRows } from './Held';
import { whenSplashGone } from './components/Splash';
import { LogoMark } from './components/LogoMark';
import { Confetti } from './components/Confetti';
import { navigate } from '../router';
import { CheckInCard, NewsLine, PaydayCard, SyncLine } from './components/HomeCards';
import { GROWTH_KINDS, OWED_KINDS, POT_KINDS, type DashboardSectionKey } from '../model/types';
import { latestBalances } from '../model/repo';
import { Chart } from './components/Chart';
import { ProgressRing } from './components/ProgressRing';
import { Icon } from './components/Icon';
import { APP_NAME } from '../appName';

const SECTION_META: Record<DashboardSectionKey, { heading: string }> = {
  growth: { heading: 'Savings & investments' },
  debt: { heading: 'Credit card debt' },
  loans: { heading: 'Loans' },
  held: { heading: 'Held apart · not in net worth' },
};

interface Drag {
  key: DashboardSectionKey;
  startClientY: number;
  startIndex: number; // index of `key` within `visibleBase`
  visibleBase: DashboardSectionKey[]; // frozen for the whole drag — see note below
  // Collapsed rows are (near enough) uniform height, so the target slot is
  // just offset / rowHeight — recomputed fresh from the total drag distance
  // on every move, never accumulated, so there's nothing to drift or desync.
  rowHeight: number;
  lastOffset: number;
}

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Re-insert keys hidden during the drag (e.g. 'loans' with no accounts) at their original slot. */
function mergeVisibleOrder(
  fullOrder: DashboardSectionKey[],
  visibleBase: DashboardSectionKey[],
  reorderedVisible: DashboardSectionKey[],
): DashboardSectionKey[] {
  let i = 0;
  return fullOrder.map((k) => (visibleBase.includes(k) ? reorderedVisible[i++] : k));
}

export function Dashboard() {
  const app = useApp();
  const drag = useRef<Drag | null>(null);
  const sectionRefs = useRef(new Map<DashboardSectionKey, HTMLDivElement>());
  const [dragKey, setDragKey] = useState<DashboardSectionKey | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  // Reordering lives behind "Reorder cards" so the grips aren't on every card
  // all the time; it's done once in a while, not every visit.
  const [editing, setEditing] = useState(false);

  // The latest payday update, from the shared history — so the partner who
  // didn't do it sees the same card after syncing. Each phone keeps its own
  // note of whether it has celebrated and whether it has dismissed it.
  const [celebrating, setCelebrating] = useState(false);
  const [confetti, setConfetti] = useState(false);
  const day0 = toDay(todayISO());
  const batch = app ? latestUpdateBatch(app.state) : null;
  const memo = app && batch && app.device.checkIn?.key === batch.key ? app.device.checkIn : null;
  const mine = !!app && !!batch && batch.deviceId === app.device.deviceId;
  const showCheckIn =
    !!batch && daysBetween(toDay(batch.at), day0) <= 10 && !memo?.dismissed && (!batch.voided || mine);
  const checkIn = app && showCheckIn && !batch!.voided ? checkInFor(app.state, batch!, day0) : null;
  const undone = showCheckIn && !!batch?.voided;
  const shouldCelebrate = !!checkIn && checkIn.netChange > 0 && !memo?.celebrated;

  // A better-off update plays its moment once per phone: on the saving phone
  // on arriving Home, on the other the first time Home opens after syncing —
  // after the welcome splash, so it isn't hidden behind it.
  useEffect(() => {
    if (!shouldCelebrate || !batch) return;
    let live = true;
    let buzz = 0;
    whenSplashGone(() => {
      if (!live) return;
      setCelebrating(true);
      setConfetti(true);
      void patchDevice({ checkIn: { key: batch.key, celebrated: true, dismissed: false } });
      // One light tap as the count lands, alongside the logo's pulse.
      buzz = window.setTimeout(() => navigator.vibrate?.(15), 1050);
    });
    return () => {
      live = false;
      clearTimeout(buzz);
    };
  }, [batch?.key, shouldCelebrate]);
  const dismissCheckIn = () => {
    if (batch) void patchDevice({ checkIn: { key: batch.key, celebrated: memo?.celebrated ?? true, dismissed: true } });
  };

  // All cards collapse to their heading row for the duration of any drag —
  // measure that row's real height once it's rendered, rather than assuming
  // a hard-coded pixel value that could drift from the actual CSS.
  useLayoutEffect(() => {
    const d = drag.current;
    if (!d || d.key !== dragKey) return;
    const el = sectionRefs.current.get(dragKey);
    if (el) d.rowHeight = el.getBoundingClientRect().height;
  }, [dragKey]);

  if (!app) return null;
  const { state, device } = app;
  const { settings } = state;
  const currency = settings.currency;
  const today = toDay(todayISO());
  const debt = debtProgress(state, today);
  const growth = growthProgress(state, today);
  const loans = loanProgress(state, today);
  // Archived loans still count in the history, but once every loan is archived
  // (paid off / closed) the Loans card drops away.
  const showLoans =
    loans.series.length > 0 && state.accounts.some((a) => a.kind === 'loan' && !a.archived);
  const netWorth = growth.current - debt.current - loans.current;

  // Per-account goals (set on each account's form): savings pots have a target
  // to save up to; cards and loans have a date to pay them off by.
  const balances = latestBalances(state);
  const pots = state.accounts
    .filter((a) => !a.archived && POT_KINDS.includes(a.kind) && (a.goalMinor ?? 0) > 0)
    .map((a) => {
      const current = balances.get(a.id)?.balance ?? 0;
      const goal = a.goalMinor!;
      return {
        account: a,
        current,
        goal,
        pct: Math.max(0, Math.min(100, (current / goal) * 100)),
        monthly: monthlyToTarget(current, goal, 'up', a.goalDate ?? null, today),
      };
    })
    .sort((x, y) => y.pct - x.pct);
  const effective = effectiveSnapshots(state.snapshots, state.voids);
  const payoffs = state.accounts
    .filter((a) => !a.archived && OWED_KINDS.includes(a.kind) && a.goalDate)
    .map((a) => {
      const current = balances.get(a.id)?.balance ?? 0;
      // Progress is measured from the most this account has owed.
      const peak = effective.reduce((m, s) => (s.accountId === a.id ? Math.max(m, s.balance) : m), current);
      return {
        account: a,
        current,
        peak,
        pct: peak > 0 ? Math.max(0, Math.min(100, ((peak - current) / peak) * 100)) : 100,
        monthly: monthlyToTarget(current, 0, 'down', a.goalDate, today),
      };
    })
    .sort((x, y) => x.account.goalDate!.localeCompare(y.account.goalDate!));
  // Savings pots' goals sit in the savings card; pay-off goals in the debt and
  // loan cards; pension and Junior ISA goals on the Held apart page.
  const savingsPots = pots.filter((p) => GROWTH_KINDS.includes(p.account.kind));
  // Pensions and Junior ISAs: one compact card of rows, never in net worth.
  const showHeld = heldAccounts(state).length > 0;
  // Each held account's move in the check-in's update, so its row agrees with
  // the card above (balances just after the update vs just before it).
  const heldNow = new Map<string, number>();
  const heldBefore = new Map<string, number>();
  if (batch && !batch.voided) {
    const ids = new Set(batch.ids);
    const upTo = state.snapshots.filter((s) => s.at <= batch.at);
    for (const [id, snap] of latestBalances({ ...state, snapshots: upTo })) heldNow.set(id, snap.balance);
    for (const [id, snap] of latestBalances({ ...state, snapshots: upTo.filter((s) => !ids.has(s.id)) })) {
      heldBefore.set(id, snap.balance);
    }
  }
  const headingFor = (key: DashboardSectionKey) => SECTION_META[key].heading;

  // Trading 212 link: the linked account's move on its latest day, and its
  // overall gain from the Worker's latest reading.
  const t212Link = settings.t212;
  const t212Account = t212Link ? state.accounts.find((a) => a.id === t212Link.accountId && !a.archived) : undefined;
  let t212Day: { day: string; change: number } | null = null;
  if (t212Account) {
    const byDay = new Map<string, number>();
    for (const s of effectiveSnapshots(state.snapshots, state.voids)) {
      if (s.accountId === t212Account.id) byDay.set(toDay(s.at), s.balance);
    }
    const days = [...byDay.keys()].sort();
    if (days.length >= 2) {
      const [prev, last] = days.slice(-2);
      t212Day = { day: last, change: byDay.get(last)! - byDay.get(prev)! };
    }
  }
  const t212Latest = t212Account ? device.t212?.latest : null;
  const signed = (minor: number) => `${minor >= 0 ? '+' : '−'}${formatMoneyWhole(Math.abs(minor), currency)}`;

  const reordering = dragKey !== null || editing;
  const names = `${settings.partnerAName} & ${settings.partnerBName}`;
  const changeWindow = checkIn ? 'since the last update' : 'last 30 days';
  // For a check-in that went the wrong way: one line of what's still true.
  const perspective =
    debt.pct >= 1
      ? `Still ${Math.round(debt.pct)}% of your card debt cleared overall. One month doesn't undo that.`
      : loans.pct >= 1
        ? `Still ${Math.round(loans.pct)}% of your loans paid off overall. One month doesn't undo that.`
        : growth.current > 0
          ? `Your savings still stand at ${formatMoneyWhole(growth.current, currency)}.`
          : null;
  const hasAccounts = state.accounts.some((a) => !a.archived);
  const lastUpdate = lastManualUpdate(state);
  const payday = latestPayday(today, lastWorkingDay);
  const paydayDue = hasAccounts && (lastUpdate === null || lastUpdate < payday);
  // The month's verdict, every day: what's moved since the last payday. Not
  // shown while the check-in or payday card is already telling that story.
  const since = dayBefore(payday);
  const verdictParts = [
    { label: 'card debt', change: changeSince(debt.series, debt.current, since), goodWhen: 'down' },
    { label: 'loans', change: changeSince(loans.series, loans.current, since), goodWhen: 'down' },
    { label: 'savings', change: changeSince(growth.series, growth.current, since), goodWhen: 'up' },
  ]
    .filter((m) => m.change !== 0)
    .map((m) => ({ ...m, good: m.goodWhen === 'down' ? m.change < 0 : m.change > 0 }));
  const monthVerdict = !showCheckIn && !paydayDue && verdictParts.length > 0 ? verdictParts : null;
  const baseVisible = device.dashboardOrder.filter(
    (k) =>
      (k !== 'loans' || showLoans) &&
      (k !== 'held' || showHeld),
  );
  // The rendered order stays fixed at the pre-drag order for the whole drag:
  // Chromium silently releases pointer capture when the captured element is
  // moved in the DOM (which is exactly what reordering a keyed list node
  // does), so actually reordering mid-drag would drop tracking the moment a
  // card crossed a neighbour. The new position is only committed — and the
  // DOM only reordered — once, on release, after capture has already ended.
  const visible = baseVisible;

  const targetIndexFor = (d: Drag, offset: number): number =>
    d.rowHeight
      ? Math.min(d.visibleBase.length - 1, Math.max(0, d.startIndex + Math.round(offset / d.rowHeight)))
      : d.startIndex;

  const startDrag = (key: DashboardSectionKey, e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = {
      key,
      startClientY: e.clientY,
      startIndex: baseVisible.indexOf(key),
      visibleBase: baseVisible,
      rowHeight: 0, // set by the layout effect just after every card collapses
      lastOffset: 0,
    };
    setDragKey(key);
    setDragOffset(0);
  };

  const continueDrag = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const offset = e.clientY - d.startClientY;
    d.lastOffset = offset;
    setDragOffset(offset);
  };

  // Keyboard and screen-reader alternative to dragging, in Reorder mode.
  const moveBy = (key: DashboardSectionKey, by: -1 | 1) => {
    const from = baseVisible.indexOf(key);
    const to = from + by;
    if (to < 0 || to >= baseVisible.length) return;
    void patchDevice({ dashboardOrder: mergeVisibleOrder(device.dashboardOrder, baseVisible, moveItem(baseVisible, from, to)) });
  };

  const endDrag = () => {
    const d = drag.current;
    if (!d) return;
    const targetIndex = targetIndexFor(d, d.lastOffset);
    const reorderedVisible = moveItem(d.visibleBase, d.startIndex, targetIndex);
    drag.current = null;
    setDragKey(null);
    setDragOffset(0);
    void patchDevice({ dashboardOrder: mergeVisibleOrder(device.dashboardOrder, d.visibleBase, reorderedVisible) });
  };

  // Non-dragged sections shift by one row to preview the gap the dragged
  // card would land in — a CSS transform only, never a real DOM move.
  const shiftFor = (key: DashboardSectionKey): number => {
    const d = drag.current;
    if (!d || key === d.key || !d.rowHeight) return 0;
    const targetIndex = targetIndexFor(d, dragOffset);
    const otherIndex = d.visibleBase.indexOf(key);
    if (d.startIndex < targetIndex && otherIndex > d.startIndex && otherIndex <= targetIndex) {
      return -d.rowHeight;
    }
    if (d.startIndex > targetIndex && otherIndex >= targetIndex && otherIndex < d.startIndex) {
      return d.rowHeight;
    }
    return 0;
  };

  // Each card's or loan's own pay-off goal, shown inside its card rather
  // than repeated in a separate Goals card.
  const payoffList = (kind: 'credit_card' | 'loan') => {
    const list = payoffs.filter((p) => p.account.kind === kind);
    if (list.length === 0) return null;
    return (
      <div class="pots payoffs">
        {list.map((p) => (
            <div class="pot" key={p.account.id}>
              <div class="pot-head">
                <span class="pot-name">{p.account.name}</span>
                <span class="pot-figures num">
                  <strong>{formatMoneyWhole(p.current, currency)}</strong> left
                </span>
              </div>
              <div class="goal-bar" role="img" aria-label={`${p.account.name}: ${p.pct.toFixed(0)}% paid off`}>
                <span style={`width:${p.pct}%`} />
              </div>
              <div class="pot-note">
                {p.current <= 0 ? (
                  <span class="positive done-note">
                    <Icon name="check" size={14} /> Paid off
                  </span>
                ) : p.monthly !== null && dueWithinMonth(today, p.account.goalDate!) ? (
                  <>Pay off by {formatDay(p.account.goalDate!)}, this month</>
                ) : p.monthly !== null ? (
                  <>
                    Pay off by {formatDay(p.account.goalDate!)} · about{' '}
                    <strong class="num">{formatMoneyWhole(p.monthly, currency)}/month</strong>
                  </>
                ) : (
                  <>Pay-off date {formatDay(p.account.goalDate!)} has passed — set a new one on the account</>
                )}
              </div>
            </div>
          ))}
      </div>
    );
  };

  // Savings-style goals ("£X of £Y"), for whichever pots belong in a card.
  // `label` replaces the account's name, e.g. "Goal" when the card's heading
  // already is that name.
  const potList = (list: typeof pots, label?: string) =>
    list.length === 0 ? null : (
      <>
        {list.map((p) => (
            <div class="pot" key={p.account.id}>
              <div class="pot-head">
                <span class="pot-name">{label ?? p.account.name}</span>
                <span class="pot-figures num">
                  <strong>{formatMoneyWhole(p.current, currency)}</strong> of {formatMoneyWhole(p.goal, currency)}
                </span>
              </div>
              <div class="goal-bar" role="img" aria-label={`${p.account.name}: ${p.pct.toFixed(0)}% of goal`}>
                <span style={`width:${p.pct}%`} />
              </div>
              <div class="pot-note">
                {p.current >= p.goal ? (
                  <span class="positive done-note">
                    <Icon name="check" size={14} /> Goal reached
                  </span>
                ) : (
                  <>
                    {formatMoneyWhole(p.goal - p.current, currency)} to go
                    {p.account.goalDate &&
                      (p.monthly !== null && dueWithinMonth(today, p.account.goalDate) ? (
                        <> · due by {formatDay(p.account.goalDate)}</>
                      ) : p.monthly !== null ? (
                        <>
                          {' '}
                          · about <strong class="num">{formatMoneyWhole(p.monthly, currency)}/month</strong> to
                          reach it by {formatDay(p.account.goalDate)}
                        </>
                      ) : (
                        <> · goal date {formatDay(p.account.goalDate)} has passed</>
                      ))}
                  </>
                )}
              </div>
            </div>
          ))}
      </>
    );

  const sectionBody = (key: DashboardSectionKey) => {
    if (key === 'held') {
      return (
        <HeldRows
          state={state}
          today={today}
          window={changeWindow}
          change={(a, p) => (checkIn ? (heldNow.get(a.id) ?? 0) - (heldBefore.get(a.id) ?? 0) : p.delta30)}
        />
      );
    }
    if (key === 'debt') {
      return (
        <div class="dash-body">
          {debt.baseline > 0 ? (
            <>
              <div class="debt-hero">
                <ProgressRing pct={debt.pct} />
                <div class="grow">
                  <div class="big-number">{formatMoneyWhole(debt.current, currency)}</div>
                  <div class="figure-caption">left to clear</div>
                  <Change change={checkIn ? checkIn.cardChange : debt.delta30} goodWhen="down" window={changeWindow} currency={currency} />
                </div>
              </div>
              <Chart series={debt.series} currency={currency} color="var(--debt)" />
              {payoffList('credit_card')}
            </>
          ) : (
            <p class="empty-note">
              No credit-card accounts yet. Add your cards and their balances to start tracking the
              payoff together.
            </p>
          )}
        </div>
      );
    }
    if (key === 'loans') {
      return (
        <div class="dash-body">
          <div class="debt-hero">
            <ProgressRing pct={loans.pct} />
            <div class="grow">
              <div class="big-number">{formatMoneyWhole(loans.current, currency)}</div>
              <div class="figure-caption">still owed on loans</div>
              <Change change={checkIn ? checkIn.loanChange : loans.delta30} goodWhen="down" window={changeWindow} currency={currency} />
            </div>
          </div>
          {loans.series.length > 1 && (
            <Chart series={loans.series} currency={currency} color="var(--debt)" />
          )}
          {payoffList('loan')}
        </div>
      );
    }
    return (
      <div class="dash-body">
        {growth.series.length > 0 ? (
          <>
            <div class="figure-row">
              <div class="grow">
                <div class="big-number">{formatMoneyWhole(growth.current, currency)}</div>
                <div class="figure-caption">combined savings &amp; investments</div>
              </div>
              <Change
                change={checkIn ? checkIn.savingsChange : growth.delta30}
                goodWhen="up"
                window={changeWindow}
                currency={currency}
                stacked
              />
            </div>
            {t212Account && (t212Day || t212Latest) && (
              <div class="mini-stats">
                <span class="mini-label">{t212Account.name}</span>
                {t212Day && (
                  <span>
                    <strong class={t212Day.change >= 0 ? 'positive' : 'owed'}>{signed(t212Day.change)}</strong>{' '}
                    {t212Day.day === today ? 'today' : `on ${formatDay(t212Day.day)}`}
                  </span>
                )}
                {t212Latest && t212Latest.costMinor > 0 && (
                  <span>
                    <strong class={t212Latest.unrealisedMinor >= 0 ? 'positive' : 'owed'}>
                      {signed(t212Latest.unrealisedMinor)} (
                      {((t212Latest.unrealisedMinor / t212Latest.costMinor) * 100).toFixed(1)}%)
                    </strong>{' '}
                    overall
                  </span>
                )}
              </div>
            )}
            <Chart series={growth.series} currency={currency} color="var(--accent)" />
            {/* Savings goals live here, with the money they're saved from. */}
            {savingsPots.length > 0 && <div class="pots payoffs">{potList(savingsPots)}</div>}
          </>
        ) : (
          <p class="empty-note">No savings or investment accounts yet.</p>
        )}
      </div>
    );
  };

  return (
    <div>
      <header class="dash-top">
        <LogoMark class="app-logo" celebrate={celebrating} />
        <h1>{APP_NAME}</h1>
        <p class="subtitle">
          {settings.partnerAName} &amp; {settings.partnerBName}
        </p>
      </header>

      {showCheckIn && batch ? (
        <CheckInCard
          checkIn={checkIn}
          undone={undone}
          names={names}
          subtitle={checkInSubtitle(batch, mine, today, settings)}
          perspective={perspective}
          currency={currency}
          canUndo={mine}
          celebrate={celebrating}
          onDismiss={dismissCheckIn}
        />
      ) : (
        paydayDue && <PaydayCard payday={payday} today={today} lastUpdate={lastUpdate} />
      )}
      <NewsLine state={state} device={device} today={today} hidden={showCheckIn || paydayDue} />

      <section class="hero">
        <div class="hero-label">Net worth</div>
        <div class={`net-worth num ${netWorth < 0 ? 'negative' : ''}`}>
          {celebrating && checkIn ? (
            <CountUp from={netWorth - checkIn.netChange} to={netWorth} currency={currency} />
          ) : (
            formatMoneyWhole(netWorth, currency)
          )}
        </div>
        {confetti && checkIn && (
          // Bursts from the figure as the count lands; more when there's a milestone.
          <Confetti
            originSelector=".net-worth"
            delay={1000}
            count={checkIn.milestones.length > 0 ? 64 : 40}
            onDone={() => setConfetti(false)}
          />
        )}
        {celebrating && checkIn && (
          <div class="net-gain num">
            <Icon name="up" size={14} />
            {formatMoneyWhole(checkIn.netChange, currency)} since the last update
          </div>
        )}
        {monthVerdict && (
          <p class="month-verdict">
            Since payday, {formatDay(payday).replace(/ \d{4}$/, '')}:{' '}
            {monthVerdict.map((m, i) => (
              <span key={m.label}>
                {i > 0 && ' · '}
                {m.label} {m.change < 0 ? 'down' : 'up'}{' '}
                <strong class={`num ${m.good ? 'positive' : ''}`}>{formatMoneyWhole(Math.abs(m.change), currency)}</strong>
              </span>
            ))}
          </p>
        )}
        {lastUpdate && <div class="hero-note">Balances as of {formatDay(lastUpdate)}</div>}
        {hasAccounts && <SyncLine state={state} device={device} />}
      </section>

      {!hasAccounts && (
        <section class="home-card">
          <div class="home-card-head">
            <h2>Start with your accounts</h2>
          </div>
          <p class="home-card-text">
            Add your cards, loans and savings, and their balances. Home fills in from there.
          </p>
          <button class="btn-primary btn-big" onClick={() => navigate('/accounts/new')}>
            Add your first account
          </button>
        </section>
      )}

      {visible.map((key) => {
        const meta = { heading: headingFor(key) };
        const dragging = dragKey === key;
        const shift = dragging ? 0 : shiftFor(key);
        return (
          <div
            key={key}
            ref={(el) => {
              if (el) sectionRefs.current.set(key, el);
              else sectionRefs.current.delete(key);
            }}
            class={`dash-section ${dragging ? 'dragging' : ''} ${shift ? 'shifting' : ''}`}
            style={
              dragging
                ? `transform:translateY(${dragOffset}px)`
                : shift
                  ? `transform:translateY(${shift}px)`
                  : undefined
            }
          >
            <h2>
              {meta.heading}
              {editing && (
                <span class="reorder-controls">
                  <button
                    type="button"
                    class="drag-handle"
                    aria-label={`Move ${meta.heading} up`}
                    disabled={baseVisible.indexOf(key) === 0}
                    onClick={() => moveBy(key, -1)}
                  >
                    <Icon name="up" size={16} />
                  </button>
                  <button
                    type="button"
                    class="drag-handle"
                    aria-label={`Move ${meta.heading} down`}
                    disabled={baseVisible.indexOf(key) === baseVisible.length - 1}
                    onClick={() => moveBy(key, 1)}
                  >
                    <Icon name="down" size={16} />
                  </button>
                  <button
                    type="button"
                    class="drag-handle"
                    aria-label={`Drag to reorder ${meta.heading}`}
                    onPointerDown={(e) => startDrag(key, e)}
                    onPointerMove={continueDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  >
                    <Icon name="grip" size={18} />
                  </button>
                </span>
              )}
            </h2>
            {!reordering && sectionBody(key)}
          </div>
        );
      })}

      {visible.length > 1 && (
        <button class={`btn-sm ${editing ? 'btn-primary' : 'btn-quiet'} reorder-toggle`} onClick={() => setEditing(!editing)}>
          {editing ? 'Done' : 'Reorder cards'}
        </button>
      )}
    </div>
  );
}

/**
 * A total's recent move. Teal only for good news (debt down, savings up);
 * a move the wrong way is stated plainly in neutral grey, never dressed up.
 * The window is "since the last update" while a check-in is showing, so the
 * cards can't contradict the card above them; otherwise the last 30 days.
 */
function Change({
  change,
  goodWhen,
  window,
  currency,
  stacked = false,
}: {
  change: number;
  goodWhen: 'up' | 'down';
  window: string;
  currency: string;
  /** Pill above its note (beside a figure) rather than in a row with it. */
  stacked?: boolean;
}) {
  if (change === 0) return null;
  const up = change > 0;
  const good = goodWhen === 'up' ? up : !up;
  const pill = (
    <span class={`delta ${good ? 'delta-up' : 'delta-flat'}`}>
      <Icon name={up ? 'up' : 'down'} />
      <span class="visually-hidden">{up ? 'up ' : 'down '}</span>
      {formatMoneyWhole(Math.abs(change), currency)}
    </span>
  );
  return stacked ? (
    <div>
      {pill}
      <div class="delta-note">{window}</div>
    </div>
  ) : (
    <div class="debt-change">
      {pill}
      <span class="delta-note">{window}</span>
    </div>
  );
}

/**
 * Net worth rolling from where it was to where it is now. Decelerates into
 * the new figure; with reduced motion it simply shows the new figure.
 */
function CountUp({ from, to, currency }: { from: number; to: number; currency: string }) {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [value, setValue] = useState(reduce ? to : from);
  const [done, setDone] = useState(reduce);
  useEffect(() => {
    if (reduce) return;
    const delay = 150;
    const duration = 900;
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t); // ease-out expo
      setValue(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else setDone(true);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <>
      {/* Screen readers get the final figure, not every frame of the count. */}
      {/* Once landed it always shows the live figure, so nothing can go stale. */}
      <span aria-hidden="true">{formatMoneyWhole(done ? to : value, currency)}</span>
      <span class="visually-hidden">{formatMoneyWhole(to, currency)}</span>
    </>
  );
}

/** Who did the update and when, from this phone's point of view. */
function checkInSubtitle(
  batch: { at: string; by: 'A' | 'B' | null },
  mine: boolean,
  today: string,
  settings: { partnerAName: string; partnerBName: string },
): string {
  const day = toDay(batch.at);
  const when = day === today ? 'today' : `on ${formatDay(day)}`;
  if (mine) return day === today ? 'Since your last update' : `Your update ${when}`;
  const who = batch.by === 'A' ? settings.partnerAName : batch.by === 'B' ? settings.partnerBName : null;
  return who ? `${who} updated ${when}` : `Updated ${when}`;
}
