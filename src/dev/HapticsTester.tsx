import { useState } from 'preact/hooks';
import { MIN_TICK_GAP_MS, setDevTickMs, tickMs } from '../logic/chartTicks';

const LENGTHS = [15, 20, 25, 30, 40, 50];

/**
 * Dev build only (Settings): plays five chart-style ticks at a chosen length
 * and makes the charts on this phone use that length, to find what can be
 * felt while sliding on a real device.
 */
export function HapticsTester() {
  const [last, setLast] = useState<string | null>(null);
  const [current, setCurrent] = useState(tickMs());
  const play = (ms: number) => {
    setDevTickMs(ms);
    setCurrent(ms);
    // Five ticks with the same gap the chart uses between them.
    const pattern = Array.from({ length: 9 }, (_, i) => (i % 2 === 0 ? ms : MIN_TICK_GAP_MS * 2));
    const ok = navigator.vibrate?.(pattern) ?? false;
    setLast(
      ok
        ? `Played 5 × ${ms} ms — charts now tick at ${ms} ms on this phone. Go to Home and slide along a chart to try it.`
        : "This browser didn't accept the vibration.",
    );
  };
  return (
    <section class="group">
      <h2 class="group-label">Haptics tester (dev build only)</h2>
      <div class="list">
        <div class="list-row" style="flex-wrap:wrap;gap:8px">
          {LENGTHS.map((ms) => (
            <button key={ms} class="btn-sm" onClick={() => play(ms)}>
              {ms} ms{ms === current ? ' ✓' : ''}
            </button>
          ))}
        </div>
      </div>
      <p class="group-footer">
        {last ??
          `Each button plays five ticks and makes charts on this phone tick at that length, so you can slide along one to feel it. ✓ marks the length in use now (${current} ms).`}
      </p>
    </section>
  );
}
