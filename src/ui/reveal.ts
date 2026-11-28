import { navigate } from '../router';
import { reducedMotion } from './motion';

/** The one shared-element name the payday reveal morphs through. */
const NAME = 'payday-reveal';

type ViewTransitionDoc = Document & {
  startViewTransition?: (update: () => Promise<void>) => { finished: Promise<void> };
};

/** Resolves once the new route has rendered (or after a short cap). */
function routeRendered(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('hashchange', onHash);
      resolve();
    };
    // Preact re-renders on the hashchange, a task or two after it.
    const onHash = () => setTimeout(() => setTimeout(finish, 0), 0);
    window.addEventListener('hashchange', onHash);
    setTimeout(finish, 400);
  });
}

/**
 * Saving an update goes Home through a View Transition: the Save button
 * grows into the payday summary it produced (or the net worth, when there's
 * no summary to show), and the rest of the page crossfades underneath.
 * Without View Transitions, or with reduced motion, it's a plain navigation.
 */
export function goHomeFrom(button: HTMLElement | null, save: () => Promise<void>): void {
  const doc = document as ViewTransitionDoc;
  if (!doc.startViewTransition || !button || reducedMotion()) {
    void save().then(() => navigate('/'));
    return;
  }
  let target: HTMLElement | null = null;
  button.style.setProperty('view-transition-name', NAME);
  document.documentElement.dataset.reveal = 'morph';
  const transition = doc.startViewTransition(async () => {
    button.style.removeProperty('view-transition-name');
    await save();
    navigate('/');
    await routeRendered();
    target = document.querySelector<HTMLElement>('.home-card.checkin') ?? document.querySelector<HTMLElement>('.hero');
    target?.style.setProperty('view-transition-name', NAME);
  });
  void transition.finished.finally(() => {
    target?.style.removeProperty('view-transition-name');
    // Home keeps its entrances switched off until the next screen: turning
    // them back on now would restart them on the page that just arrived.
    window.addEventListener('hashchange', () => delete document.documentElement.dataset.reveal, { once: true });
  });
}
