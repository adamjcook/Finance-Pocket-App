interface Props {
  pct: number; // 0..100
  size?: number;
  label?: string;
}

/** Circular progress with the percentage in the middle. */
export function ProgressRing({ pct, size = 108, label = 'paid off' }: Props) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${pct.toFixed(0)}% ${label}`}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--bg-inset)"
        stroke-width={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--accent)"
        stroke-width={stroke}
        stroke-linecap="round"
        stroke-dasharray={`${filled} ${c - filled}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="47%"
        text-anchor="middle"
        dominant-baseline="central"
        fill="var(--text)"
        font-size={size / 4.5}
        font-weight="750"
      >
        {pct.toFixed(0)}%
      </text>
      <text
        x="50%"
        y="66%"
        text-anchor="middle"
        fill="var(--text-dim)"
        font-size={size / 10}
      >
        {label}
      </text>
    </svg>
  );
}
