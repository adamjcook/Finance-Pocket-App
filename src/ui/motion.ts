/**
 * Shared motion for the payday reveal: a real damped spring (mass, stiffness,
 * damping), sampled once, so CSS/WAAPI animations (as a `linear()` easing)
 * and rAF-driven SVG (via `at`) move with exactly the same physics.
 */

export interface Spring {
  /** Milliseconds until the spring has settled. */
  duration: number;
  /** CSS easing: the sampled curve as `linear()`, or a close cubic-bezier fallback. */
  easing: string;
  /** Progress (may overshoot 1 slightly) at t in 0..1 of `duration`. */
  at: (t: number) => number;
}

const cache = new Map<string, Spring>();

export function spring(stiffness = 170, damping = 20, mass = 1): Spring {
  const key = `${stiffness}/${damping}/${mass}`;
  const hit = cache.get(key);
  if (hit) return hit;

  // Semi-implicit Euler at 1ms steps from 0 to rest at 1.
  const values: number[] = [];
  let x = 0;
  let v = 0;
  let still = 0;
  for (let ms = 0; ms < 3000; ms++) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a / 1000;
    x += v / 1000;
    values.push(x);
    still = Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.01 ? still + 1 : 0;
    if (still > 30) break;
  }
  values[values.length - 1] = 1;
  const duration = values.length;
  const at = (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const f = t * (duration - 1);
    const i = Math.floor(f);
    return values[i] + (values[i + 1] - values[i]) * (f - i);
  };
  const points = 48;
  const curve = Array.from({ length: points + 1 }, (_, i) => at(i / points).toFixed(4)).join(', ');
  const supportsLinear =
    typeof CSS !== 'undefined' && CSS.supports?.('animation-timing-function', 'linear(0, 1)');
  const made: Spring = {
    duration,
    easing: supportsLinear ? `linear(${curve})` : 'cubic-bezier(0.16, 1, 0.3, 1)',
    at,
  };
  cache.set(key, made);
  return made;
}

export const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Drives `onFrame(progress)` along a spring after `delay` ms, then `onDone`.
 * Returns a cancel function. Progress can overshoot 1 a little: that's the
 * spring's give, so callers interpolate without clamping.
 */
export function runSpring(
  s: Spring,
  delay: number,
  onFrame: (p: number) => void,
  onDone?: () => void,
): () => void {
  let raf = 0;
  const start = performance.now() + delay;
  const tick = (now: number) => {
    const t = Math.max(0, (now - start) / s.duration);
    onFrame(s.at(Math.min(1, t)));
    if (t < 1) raf = requestAnimationFrame(tick);
    else onDone?.();
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
