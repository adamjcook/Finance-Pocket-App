import { useEffect, useState } from 'preact/hooks';

const TYPE_INTERVAL_MS = 18;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Module-level, not per-component-instance: the Dashboard unmounts and
// remounts every time you switch tabs and come back (App.tsx only renders
// it while on the '/' route), which would reset a useRef flag and retype
// on every tab switch. This flag instead survives for as long as the page
// itself is loaded, so it only fires again on an actual app open or
// refresh — the point where this module gets re-evaluated from scratch.
let hasAnimated = false;

/**
 * Reveals `text` character by character once per app open/refresh — a quick
 * "typing" effect for the dashboard summary. If `text` changes afterwards
 * (e.g. a balance update while already on this screen, or a tab switch back
 * to a since-changed summary), that later value applies instantly with no
 * re-type. The full text is always available to assistive tech via
 * aria-label; the animated span is hidden from it so nothing gets read out
 * mid-type.
 */
export function TypedText({ text, class: className }: { text: string; class?: string }) {
  const [shown, setShown] = useState(hasAnimated ? text : '');

  useEffect(() => {
    if (hasAnimated || prefersReducedMotion()) {
      setShown(text);
      hasAnimated = true;
      return;
    }
    hasAnimated = true;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, TYPE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [text]);

  return (
    <p class={className} aria-label={text}>
      <span aria-hidden="true">
        {shown}
        {shown.length < text.length && <span class="typed-cursor" />}
      </span>
    </p>
  );
}
