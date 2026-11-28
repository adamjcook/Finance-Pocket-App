import { useEffect, useState } from 'preact/hooks';
import { reducedMotion, runSpring, spring } from '../motion';

interface Props {
  pct: number; // 0..100
  size?: number;
  label?: string;
  /** Payday reveal: shows this percentage until `play`, then sweeps to `pct`. */
  from?: number;
  play?: boolean;
  delay?: number;
}

/** Circular progress with the percentage in the middle. */
export function ProgressRing({ pct, size = 104, label = 'paid off', from, play = false, delay = 0 }: Props) {
  const sweeping = from !== undefined && from !== pct && !reducedMotion();
  const [shown, setShown] = useState(sweeping ? from! : pct);
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    if (!sweeping) {
      setShown(pct);
      return;
    }
    // Waiting its turn: hold the old figure (it may have mounted showing the new one).
    if (!play) {
      setShown(from!);
      return;
    }
    return runSpring(
      spring(120, 17),
      delay,
      (p) => setShown(from! + (pct - from!) * p),
      () => {
        setShown(pct);
        setLanded(true);
      },
    );
  }, [play, pct, sweeping]);

  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, shown)) / 100) * c;
  const display = Math.max(0, Math.min(100, shown));
  return (
    <svg
      class={`progress-ring ${landed ? 'landed' : ''}`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`${pct.toFixed(0)}% ${label}`}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--surface-3)"
        stroke-width={stroke}
      />
      <circle
        class="ring-arc"
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
        font-size={size / 4.4}
        font-weight="700"
        letter-spacing="-0.03em"
      >
        {display.toFixed(0)}%
      </text>
      <text
        x="50%"
        y="66%"
        text-anchor="middle"
        fill="var(--text-3)"
        font-size={size / 9.5}
        font-weight="500"
      >
        {label}
      </text>
    </svg>
  );
}
