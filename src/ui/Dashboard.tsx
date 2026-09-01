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

const SECTION_META: Record<DashboardSectionKey, { heading: string; dot: string }> = {
  growth: { heading: 'Savings & investments', dot: 'var(--accent)' },
  debt: { heading: 'Credit card debt', dot: 'var(--debt)' },
  loans: { heading: 'Loans', dot: 'color-mix(in srgb, var(--debt) 55%, var(--bg-raised))' },
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
    loans: { current: loans.current, hasLoans: loans.series.length > 0 },
  });

  const reordering = dragKey !== null;
  const baseVisible = device.dashboardOrder.filter((k) => k !== 'loans' || loans.series.length > 0);
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

  const sectionBody = (key: DashboardSectionKey) => {
    if (key === 'debt') {
      return (
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
      );
    }
    if (key === 'loans') {
      return (
        <div class="card card-loan">
          <div class="row spread">
            <div>
              <div class="big-number">{formatMoney(loans.current, currency)}</div>
              <div class="muted">still owed on loans</div>
            </div>
          </div>
          {loanTargetDate &&
            (loans.current === 0 ? (
              <p class="small delta-up" style="margin-top:10px">
                Loans cleared — goal done 🎉
              </p>
            ) : loanMonthly !== null ? (
              <p class="small" style="margin-top:10px">
                Goal: cleared by <strong>{formatDay(loanTargetDate)}</strong> — needs about{' '}
                <strong>{formatMoney(loanMonthly, currency)}/month</strong>
              </p>
            ) : (
              <p class="muted small" style="margin-top:10px">
                Goal date {formatDay(loanTargetDate)} has passed — set a new one in Settings.
              </p>
            ))}
          {loans.series.length > 1 && (
            <div style="margin-top:12px">
              <Chart series={loans.series} currency={currency} color="var(--debt)" />
            </div>
          )}
        </div>
      );
    }
    return (
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
    );
  };

  return (
    <div>
      <div class="title-row" style="margin-bottom:2px">
        <img src={`${import.meta.env.BASE_URL}icons/favicon.svg`} class="app-logo" alt="" />
        <h1>FinPair</h1>
      </div>
      <p class="subtitle">
        {settings.partnerAName} &amp; {settings.partnerBName}
      </p>
      <TypedText class="wisdom" text={summary} />

      <div class="net-worth">
        <span class={netWorth >= 0 ? 'delta-up' : 'delta-down'}>
          {netWorth >= 0 ? '' : '-'}
          {formatMoney(Math.abs(netWorth), currency)}
        </span>
      </div>

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
            <h2 class="row spread">
              <span class="row" style="gap:6px">
                <span class="h2-dot" style={`background:${meta.dot}`} />
                {meta.heading}
              </span>
              <button
                type="button"
                class="drag-handle"
                aria-label={`Reorder ${meta.heading}`}
                onPointerDown={(e) => startDrag(key, e)}
                onPointerMove={continueDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                ⋮⋮
              </button>
            </h2>
            {!reordering && sectionBody(key)}
          </div>
        );
      })}
    </div>
  );
}
