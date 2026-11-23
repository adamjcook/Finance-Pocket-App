import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useApp, patchDevice } from '../model/store';
import {
  debtProgress,
  formatDay,
  growthProgress,
  loanTotals,
  monthlyToTarget,
  toDay,
  todayISO,
} from '../logic/progress';
import { formatMoney } from '../logic/money';
import { dashboardSummary } from '../logic/wisdom';
import type { DashboardSectionKey } from '../model/types';
import { Chart } from './components/Chart';
import { ProgressRing } from './components/ProgressRing';
import { TypedText } from './components/TypedText';
import { Icon } from './components/Icon';

const SECTION_META: Record<DashboardSectionKey, { heading: string }> = {
  growth: { heading: 'Savings & investments' },
  debt: { heading: 'Credit card debt' },
  loans: { heading: 'Loans' },
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
  const loans = loanTotals(state, today);
  // Archived loans still count in the history, but once every loan is archived
  // (paid off / closed) the Loans card and summary line drop away.
  const showLoans =
    loans.series.length > 0 && state.accounts.some((a) => a.kind === 'loan' && !a.archived);
  const netWorth = growth.current - debt.current - loans.current;

  const debtTargetDate = settings.debtTargetDate ?? null;
  const debtMonthly = monthlyToTarget(debt.current, 0, 'down', debtTargetDate, today);
  const loanTargetDate = settings.loanTargetDate ?? null;
  const loanMonthly = monthlyToTarget(loans.current, 0, 'down', loanTargetDate, today);
  const savingsTarget = settings.savingsTargetMinor ?? null;
  const savingsTargetDate = settings.savingsTargetDate ?? null;
  const savingsMonthly =
    savingsTarget !== null
      ? monthlyToTarget(growth.current, savingsTarget, 'up', savingsTargetDate, today)
      : null;

  const summary = dashboardSummary({
    today,
    currency,
    debt: { baseline: debt.baseline, current: debt.current, pct: debt.pct },
    growth: { delta30: growth.delta30, hasHistory: growth.series.length > 0 },
    loans: { current: loans.current, hasLoans: showLoans },
  });

  const reordering = dragKey !== null;
  const baseVisible = device.dashboardOrder.filter((k) => k !== 'loans' || showLoans);
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

  const goalLine = (targetDate: string, current: number, monthly: number | null, doneLabel: string) =>
    current === 0 ? (
      <p class="goal done">{doneLabel} — goal done 🎉</p>
    ) : monthly !== null ? (
      <p class="goal">
        Goal: cleared by <strong>{formatDay(targetDate)}</strong> — needs about{' '}
        <strong class="num">{formatMoney(monthly, currency)}/month</strong>
      </p>
    ) : (
      <p class="goal">Goal date {formatDay(targetDate)} has passed — set a new one in Settings.</p>
    );

  const sectionBody = (key: DashboardSectionKey) => {
    if (key === 'debt') {
      return (
        <div class="dash-body">
          {debt.baseline > 0 ? (
            <>
              <div class="debt-hero">
                <ProgressRing pct={debt.pct} />
                <div class="grow">
                  <div class="big-number">{formatMoney(debt.current, currency)}</div>
                  <div class="figure-caption">left to clear</div>
                  <div class="figure-caption positive num" style="margin-top:8px;font-weight:550">
                    {formatMoney(debt.paidOff, currency)} of {formatMoney(debt.baseline, currency)} paid off
                  </div>
                </div>
              </div>
              {debtTargetDate && goalLine(debtTargetDate, debt.current, debtMonthly, 'Cards cleared')}
              <Chart series={debt.series} currency={currency} color="var(--debt)" />
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
          <div class="big-number">{formatMoney(loans.current, currency)}</div>
          <div class="figure-caption">still owed on loans</div>
          {loanTargetDate && goalLine(loanTargetDate, loans.current, loanMonthly, 'Loans cleared')}
          {loans.series.length > 1 && (
            <Chart series={loans.series} currency={currency} color="var(--debt)" />
          )}
        </div>
      );
    }
    const up = growth.delta30 >= 0;
    return (
      <div class="dash-body">
        {growth.series.length > 0 ? (
          <>
            <div class="figure-row">
              <div class="grow">
                <div class="big-number">{formatMoney(growth.current, currency)}</div>
                <div class="figure-caption">combined savings &amp; investments</div>
              </div>
              <div>
                <span class={`delta ${up ? 'delta-up' : 'delta-down'}`}>
                  <Icon name={up ? 'up' : 'down'} />
                  {formatMoney(Math.abs(growth.delta30), currency)}
                </span>
                <div class="delta-note">last 30 days</div>
              </div>
            </div>
            {savingsTarget !== null &&
              (growth.current >= savingsTarget ? (
                <p class="goal done">Target of {formatMoney(savingsTarget, currency)} reached 🎉</p>
              ) : (
                <div class="goal">
                  <p>
                    Target: <strong class="num">{formatMoney(savingsTarget, currency)}</strong> (
                    {((growth.current / savingsTarget) * 100).toFixed(0)}% there)
                    {savingsMonthly !== null && savingsTargetDate ? (
                      <>
                        {' '}
                        — about <strong class="num">{formatMoney(savingsMonthly, currency)}/month</strong> to
                        get there by {formatDay(savingsTargetDate)}
                      </>
                    ) : savingsTargetDate ? (
                      <> — goal date {formatDay(savingsTargetDate)} has passed</>
                    ) : null}
                  </p>
                  <div class="goal-bar">
                    <span style={`width:${Math.max(0, Math.min(100, (growth.current / savingsTarget) * 100))}%`} />
                  </div>
                </div>
              ))}
            <Chart series={growth.series} currency={currency} color="var(--accent)" />
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
        <img src={`${import.meta.env.BASE_URL}${import.meta.env.VITE_ICON_DIR}/favicon.svg`} class="app-logo" alt="" />
        <h1>FinPair</h1>
        <p class="subtitle">
          <span class="pair-dots" aria-hidden="true">
            <span style="background:var(--partner-a-display)" />
            <span style="background:var(--partner-b-display)" />
          </span>
          {settings.partnerAName} &amp; {settings.partnerBName}
        </p>
      </header>

      <section class="hero">
        <div class="hero-label">Net worth</div>
        <div class={`net-worth ${netWorth < 0 ? 'negative' : ''}`}>
          {netWorth >= 0 ? '' : '-'}
          {formatMoney(Math.abs(netWorth), currency)}
        </div>
        <TypedText class="wisdom" text={summary} />
      </section>

      {visible.map((key) => {
        const meta = SECTION_META[key];
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
              <button
                type="button"
                class="drag-handle"
                aria-label={`Reorder ${meta.heading}`}
                onPointerDown={(e) => startDrag(key, e)}
                onPointerMove={continueDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <Icon name="grip" size={18} />
              </button>
            </h2>
            {!reordering && sectionBody(key)}
          </div>
        );
      })}
    </div>
  );
}
