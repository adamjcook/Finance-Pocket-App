import { useRef, useState } from 'preact/hooks';
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
import type { DashboardSectionKey } from '../model/types';
import { Chart } from './components/Chart';
import { ProgressRing } from './components/ProgressRing';

const SECTION_META: Record<DashboardSectionKey, { heading: string; dot: string }> = {
  growth: { heading: 'Savings & investments', dot: 'var(--accent)' },
  debt: { heading: 'Credit card debt', dot: 'var(--debt)' },
  loans: { heading: 'Loans', dot: 'color-mix(in srgb, var(--debt) 55%, var(--bg-raised))' },
};

interface Drag {
  key: DashboardSectionKey;
  startClientY: number;
  // The dragged section's own resting position, tracked analytically rather
  // than re-read from the DOM each move: its element carries our own
  // translateY, which always lags a render behind the value we just set.
  initialTop: number;
  height: number;
  order: DashboardSectionKey[];
}

export function Dashboard() {
  const app = useApp();
  const drag = useRef<Drag | null>(null);
  const sectionRefs = useRef(new Map<DashboardSectionKey, HTMLDivElement>());
  const [dragKey, setDragKey] = useState<DashboardSectionKey | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  // Working copy of the order while a drag is in progress; committed to the
  // device record (per-phone, never synced) on release.
  const [liveOrder, setLiveOrder] = useState<DashboardSectionKey[] | null>(null);

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

  const currentOrder = liveOrder ?? device.dashboardOrder;
  const visible = currentOrder.filter((k) => k !== 'loans' || loans.series.length > 0);

  const startDrag = (key: DashboardSectionKey, e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const el = sectionRefs.current.get(key);
    const rect = el?.getBoundingClientRect();
    const order = [...device.dashboardOrder];
    drag.current = {
      key,
      startClientY: e.clientY,
      initialTop: rect?.top ?? 0,
      height: rect?.height ?? 0,
      order,
    };
    setDragKey(key);
    setDragOffset(0);
    setLiveOrder(order);
  };

  // Swap the dragged section past a neighbour once it's dragged more than
  // halfway across it, shifting the tracked resting position by the
  // neighbour's height so the pointer offset stays continuous across the swap.
  const continueDrag = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const offset = e.clientY - d.startClientY;
    setDragOffset(offset);

    const draggedCenter = d.initialTop + d.height / 2 + offset;
    const from = d.order.indexOf(d.key);

    for (const otherKey of d.order) {
      if (otherKey === d.key) continue;
      const otherEl = sectionRefs.current.get(otherKey);
      if (!otherEl) continue;
      const otherRect = otherEl.getBoundingClientRect();
      const otherCenter = otherRect.top + otherRect.height / 2;
      const to = d.order.indexOf(otherKey);
      const movingDown = to > from;
      const crossed = movingDown ? draggedCenter > otherCenter : draggedCenter < otherCenter;
      if (!crossed) continue;
      const next = [...d.order];
      next[from] = otherKey;
      next[to] = d.key;
      d.order = next;
      d.initialTop += movingDown ? otherRect.height : -otherRect.height;
      setLiveOrder(next);
      break;
    }
  };

  const endDrag = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragKey(null);
    setDragOffset(0);
    setLiveOrder(null);
    void patchDevice({ dashboardOrder: d.order });
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
        <span class="name-dot name-dot-a" />
        {settings.partnerAName} &amp;{' '}
        <span class="name-dot name-dot-b" />
        {settings.partnerBName}
      </p>

      <div class="net-worth">
        <span class={netWorth >= 0 ? 'delta-up' : 'delta-down'}>
          {netWorth >= 0 ? '' : '-'}
          {formatMoney(Math.abs(netWorth), currency)}
        </span>
      </div>

      {visible.map((key) => {
        const meta = SECTION_META[key];
        const dragging = dragKey === key;
        return (
          <div
            key={key}
            ref={(el) => {
              if (el) sectionRefs.current.set(key, el);
              else sectionRefs.current.delete(key);
            }}
            class={`dash-section ${dragging ? 'dragging' : ''}`}
            style={dragging ? `transform:translateY(${dragOffset}px)` : undefined}
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
            {sectionBody(key)}
          </div>
        );
      })}
    </div>
  );
}
