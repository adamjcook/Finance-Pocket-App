import { useState } from 'preact/hooks';
import { MIN_TICK_GAP_MS, TICK_MS } from '../logic/chartTicks';

const LENGTHS = [8, 12, 15, 20, 25, 30];

/**
 * Dev build only (Settings): plays five chart-style ticks at a chosen length,
 * to find the shortest pulse this phone's motor actually delivers.
 */
export function HapticsTester() {
  const [last, setLast] = useState<string | null>(null);
  const play = (ms: number) => {
    // Five ticks with the same gap the chart uses between them.
    const pattern = Array.from({ length: 9 }, (_, i) => (i % 2 === 0 ? ms : MIN_TICK_GAP_MS * 2));
    const ok = navigator.vibrate?.(pattern) ?? false;
    setLast(ok ? `Played 5 × ${ms} ms` : "This browser didn't accept the vibration.");
  };
  return (
    <section class="group">
      <h2 class="group-label">Haptics tester (dev build only)</h2>
      <div class="list">
        <div class="list-row" style="flex-wrap:wrap;gap:8px">
          {LENGTHS.map((ms) => (
            <button key={ms} class="btn-sm" onClick={() => play(ms)}>
              {ms} ms{ms === TICK_MS ? ' ✓' : ''}
            </button>
          ))}
        </div>
      </div>
      <p class="group-footer">
        {last ??
          `Each button plays five ticks like sliding along a chart. ✓ marks the length the chart uses now (${TICK_MS} ms). Tell Claude the shortest one you can clearly feel.`}
      </p>
    </section>
  );
}
