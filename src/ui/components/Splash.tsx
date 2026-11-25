import { useEffect, useRef, useState } from 'preact/hooks';
import { LogoMark } from './LogoMark';

/**
 * The welcome moment each time the app opens: the ring of the MC Bank mark
 * draws itself round the letters as they rise into place, a greeting appears,
 * then the mark flies into its place in Home's header while the overlay fades.
 *
 * It also stands in for the old "Loading…" text: it holds (looping nothing,
 * just resting on the finished mark) until the store is ready. A tap skips it.
 * Shown once per launch, not on every in-app navigation.
 */

let shownThisLaunch = false;

/**
 * Call `fn` once the splash has gone (straight away if it already has), so
 * anything worth seeing on Home — like a celebration — doesn't play hidden
 * behind it.
 */
let splashGone = false;
const waiting: (() => void)[] = [];
export function whenSplashGone(fn: () => void): void {
  if (splashGone) fn();
  else waiting.push(fn);
}
function markGone() {
  splashGone = true;
  for (const fn of waiting.splice(0)) fn();
}

const ENTER_MS = 1500; // circles meet by ~640ms; greeting settled by ~720ms, then held ~0.8s to read
const EXIT_MS = 380;
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Hello';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

interface Props {
  /** True once the store has loaded; the splash never leaves before this. */
  ready: boolean;
  /** "Adam" (or "Adam & Sam" before the phone knows whose it is); null on first run, so no greeting. */
  names: string | null;
}

export function Splash({ ready, names }: Props) {
  const [gone, setGone] = useState(shownThisLaunch);
  const [entered, setEntered] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLDivElement>(null);
  const leaving = useRef(false);

  useEffect(() => {
    if (gone) return;
    const t = setTimeout(() => setEntered(true), ENTER_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (gone || leaving.current || !ready || !(entered || skipped)) return;
    leaving.current = true;
    shownThisLaunch = true;
    // Let the screen underneath render its first frame before measuring it.
    requestAnimationFrame(() => requestAnimationFrame(leave));
  }, [ready, entered, skipped]);

  function leave() {
    const el = root.current;
    const logo = mark.current;
    if (!el || !logo) {
      markGone();
      return setGone(true);
    }
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const target = document.querySelector<HTMLElement>('.app-logo, .welcome-logo');
    const anims: Animation[] = [];
    el.classList.add('splash-handoff');

    if (target && !reduce) {
      // FLIP the mark onto the logo of the screen underneath (Home's header, or
      // the first-run screen's), so the welcome hands over to
      // the app instead of just disappearing.
      const from = logo.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      const s = to.width / from.width;
      target.style.visibility = 'hidden';
      const fly = logo.animate(
        [{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${s})` }],
        { duration: EXIT_MS + 80, easing: EASE_OUT, fill: 'forwards' },
      );
      const land = () => {
        target.style.visibility = '';
        // The first-run logo carries a drop shadow the flown mark doesn't:
        // let it settle in rather than pop.
        const shadow = getComputedStyle(target).boxShadow;
        if (shadow && shadow !== 'none') {
          target.animate([{ boxShadow: 'none' }, { boxShadow: shadow }], { duration: 200, easing: 'ease-out' });
        }
      };
      fly.finished.then(land, land);
      anims.push(fly);
    }
    // Fade the backdrop, not the whole overlay: the flying mark must stay
    // solid until it sits exactly on the real logo, which then takes over.
    const bg = getComputedStyle(el).backgroundColor;
    anims.push(
      el.animate([{ backgroundColor: bg }, { backgroundColor: 'transparent' }], {
        duration: reduce ? 240 : EXIT_MS,
        delay: target && !reduce ? 60 : 0,
        easing: 'ease-out',
        fill: 'forwards',
      }),
    );
    if (!target || reduce) {
      anims.push(logo.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduce ? 200 : 260, easing: 'ease-out', fill: 'forwards' }));
    }
    Promise.all(anims.map((a) => a.finished)).then(
      () => {
        markGone();
        setGone(true);
      },
      () => {
        markGone();
        setGone(true);
      },
    );
  }

  if (gone) return null;

  return (
    <div
      ref={root}
      class={`splash ${skipped ? 'splash-skip' : ''}`}
      aria-hidden="true"
      onPointerDown={() => setSkipped(true)}
    >
      <div ref={mark} class="splash-mark">
        <LogoMark class="splash-logo" />
      </div>
      <div class="splash-greeting-slot">
        {names && <p class="splash-greeting">{`${greeting()}, ${names}`}</p>}
      </div>
    </div>
  );
}
