import { useId, useState } from 'preact/hooks';
import { formatDay, type SeriesPoint } from '../../logic/progress';
import { formatMoney, formatMoneyCompact } from '../../logic/money';

interface Props {
  series: SeriesPoint[];
  currency: string;
  color: string;
  height?: number;
}

const W = 320;

/** Minimal SVG area chart for a daily money series. Tap to inspect a day. */
export function Chart({ series, currency, color, height = 110 }: Props) {
  const [picked, setPicked] = useState<number | null>(null);
  const gradientId = `chart-fill-${useId()}`;

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

  const pick = (e: PointerEvent) => {
    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const i = Math.round(frac * (series.length - 1));
    setPicked(Math.max(0, Math.min(series.length - 1, i)));
  };

  // Capture the pointer so dragging a thumb left/right keeps updating the
  // reading instead of losing it the moment the finger moves off the exact
  // point it started on.
  const startDrag = (e: PointerEvent) => {
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    pick(e);
  };
  const continueDrag = (e: PointerEvent) => {
    if (e.buttons === 0) return; // finger/button not down — a hover move, not a drag
    pick(e);
  };
  const endDrag = () => setPicked(null);

  const pickedPoint = picked !== null ? series[picked] : null;

  return (
    <div class="chart">
      {/* Above the chart, not below: on a touchscreen a thumb resting on the
          plot to pick a point would otherwise cover a readout placed under it. */}
      <p class="chart-tooltip">
        {pickedPoint ? `${formatDay(pickedPoint.day)}: ${formatMoney(pickedPoint.value, currency)}` : ' '}
      </p>
      <svg
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
