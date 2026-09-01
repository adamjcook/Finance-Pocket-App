import { useEffect, useRef, useState } from 'preact/hooks';

const TYPE_INTERVAL_MS = 18;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Reveals `text` character by character once, on mount — a quick "typing"
 * effect for the dashboard summary. If `text` changes afterwards (e.g. a
 * balance update while already on this screen), that later value applies
 * instantly with no re-type — the effect is for opening the app, not every
 * keystroke of live data. The full text is always available to assistive
 * tech via aria-label; the animated span is hidden from it so nothing gets
 * read out mid-type.
 */
export function TypedText({ text, class: className }: { text: string; class?: string }) {
  const [shown, setShown] = useState('');
  const typed = useRef(false);

  useEffect(() => {
    if (typed.current || prefersReducedMotion()) {
      setShown(text);
      typed.current = true;
      return;
    }
    typed.current = true;
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
