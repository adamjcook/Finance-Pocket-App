import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { formatDay, type SeriesPoint } from '../../logic/progress';
import { formatMoney, formatMoneyCompact } from '../../logic/money';

interface Props {
  series: SeriesPoint[];
  currency: string;
  color: string;
  height?: number;
}

const W = 320;
/** How long a finger has to rest on the chart before it starts reading out days. */
export const HOLD_MS = 250;
/** Movement allowed during that wait before it counts as a scroll instead. */
const SLOP_PX = 10;

/**
 * Minimal SVG area chart for a daily money series. Press and hold to read out
 * a day (a short vibration confirms it), then slide to move along the line.
 * A swipe that starts on the chart still scrolls the page; a mouse reads out
 * days immediately on click-and-drag.
 */
export function Chart({ series, currency, color, height = 110 }: Props) {
  const [picked, setPicked] = useState<number | null>(null);
  const gradientId = `chart-fill-${useId()}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const lengthRef = useRef(series.length);
  lengthRef.current = series.length;
  const hasChart = series.length >= 2;

  /** Which day sits under a screen x-coordinate. */
  const pickAt = (clientX: number) => {
    const svg = svgRef.current;
    const n = lengthRef.current;
    if (!svg || n < 2) return;
    const rect = svg.getBoundingClientRect();
    const i = Math.round(((clientX - rect.left) / rect.width) * (n - 1));
    setPicked(Math.max(0, Math.min(n - 1, i)));
  };

  // Touch: wait for a deliberate hold before taking over, so swipes scroll.
  // Attached by hand because touchmove must be non-passive to stop the page
  // scrolling once a read-out is active.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let start: { x: number; y: number } | null = null;
    let lastX = 0;
    let active = false;

    const reset = () => {
      clearTimeout(timer);
      timer = undefined;
      start = null;
      if (active) {
        active = false;
        setPicked(null);
      }
    };
    const onStart = (e: TouchEvent) => {
      reset();
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
      lastX = t.clientX;
      timer = setTimeout(() => {
        timer = undefined;
        active = true;
        navigator.vibrate?.(12);
        pickAt(lastX);
      }, HOLD_MS);
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (active) {
        e.preventDefault(); // reading out days: don't scroll the page
        pickAt(t.clientX);
        return;
      }
      if (start && Math.hypot(t.clientX - start.x, t.clientY - start.y) > SLOP_PX) {
        reset(); // moved before the hold completed: it's a scroll
      } else {
        lastX = t.clientX;
      }
    };
    // A long press would otherwise open the browser's context menu.
    const onContextMenu = (e: Event) => e.preventDefault();

    svg.addEventListener('touchstart', onStart, { passive: true });
    svg.addEventListener('touchmove', onMove, { passive: false });
    svg.addEventListener('touchend', reset);
    svg.addEventListener('touchcancel', reset);
    svg.addEventListener('contextmenu', onContextMenu);
    return () => {
      reset();
      svg.removeEventListener('touchstart', onStart);
      svg.removeEventListener('touchmove', onMove);
      svg.removeEventListener('touchend', reset);
      svg.removeEventListener('touchcancel', reset);
      svg.removeEventListener('contextmenu', onContextMenu);
    };
  }, [hasChart]);

  if (series.length < 2) {
    return <p class="chart-empty">Add a couple of balance updates to see a trend here.</p>;
  }

  const LABEL_BAND = 16; // reserved row above the plot so labels never hit the line
  const values = series.map((p) => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pad = Math.max((max - min) * 0.1, 1);
  const top = max + pad;
  // A series that never goes negative never gets an axis below zero.
  const bottom = min >= 0 ? Math.max(0, min - pad) : min - pad;
  const x = (i: number) => (i / (series.length - 1)) * W;
  const y = (v: number) => LABEL_BAND + ((top - v) / (top - bottom)) * height;

  const floor = LABEL_BAND + height;
  const line = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const area = `${line}L${W},${floor}L0,${floor}Z`;

  // Mouse (and pen): read out immediately on press, follow while held. Touch
  // is handled by the hold-to-activate listeners above.
  const startDrag = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    pickAt(e.clientX);
  };
  const continueDrag = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || e.buttons === 0) return; // hover, not a drag
    pickAt(e.clientX);
  };
  const endDrag = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') setPicked(null);
  };

  const pickedPoint = picked !== null ? series[picked] : null;

  return (
    <div class="chart">
      {/* Above the chart, not below: on a touchscreen a thumb resting on the
          plot to pick a point would otherwise cover a readout placed under it. */}
      <p class="chart-tooltip">
        {pickedPoint ? `${formatDay(pickedPoint.day)}: ${formatMoney(pickedPoint.value, currency)}` : ' '}
      </p>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${LABEL_BAND + height + 18}`}
        onPointerDown={startDrag}
        onPointerMove={continueDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color={color} stop-opacity="0.28" />
            <stop offset="1" stop-color={color} stop-opacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1="0"
            x2={W}
            y1={LABEL_BAND + f * height}
            y2={LABEL_BAND + f * height}
            stroke="var(--separator)"
            stroke-width="1"
          />
        ))}
        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke={color}
          stroke-width="2.25"
          stroke-linejoin="round"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
        />
        <circle cx={x(series.length - 1)} cy={y(values[values.length - 1])} r="7" fill={color} opacity="0.2" />
        <circle cx={x(series.length - 1)} cy={y(values[values.length - 1])} r="3.5" fill={color} />
        {pickedPoint && (
          <g>
            <line
              x1={x(picked!)}
              x2={x(picked!)}
              y1={LABEL_BAND}
              y2={floor}
              stroke="var(--text-3)"
              stroke-width="1"
              stroke-dasharray="3 3"
            />
            <circle cx={x(picked!)} cy={y(pickedPoint.value)} r="5" fill={color} stroke="var(--surface)" stroke-width="2" />
          </g>
        )}
        <text x="0" y={floor + 14} fill="var(--text-3)" font-size="10" font-weight="500">
          {formatDay(series[0].day)}
        </text>
        <text x={W} y={floor + 14} fill="var(--text-3)" font-size="10" font-weight="500" text-anchor="end">
          {formatDay(series[series.length - 1].day)}
        </text>
        <text x={W} y="10" fill="var(--text-3)" font-size="10" font-weight="500" text-anchor="end">
          High {formatMoneyCompact(max, currency)}
        </text>
      </svg>
    </div>
  );
}
