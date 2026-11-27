import { useApp } from '../model/store';
import { formatDay, toDay, todayISO } from '../logic/progress';
import { ourStory, type Moment, type MomentKind } from '../logic/story';
import { navigate } from '../router';
import { Icon, type IconName } from './components/Icon';

/**
 * #/story: "Our story so far", every moment worth remembering, newest first.
 * Worked out from the shared history (see logic/story.ts), so it reads the
 * same on both phones and needs nothing new to sync.
 */

const MARKS: Record<MomentKind, { icon: IconName; tone: 'big' | 'quiet' | 'plain' }> = {
  cleared: { icon: 'check', tone: 'big' },
  paid: { icon: 'check', tone: 'big' },
  goal: { icon: 'target', tone: 'big' },
  year: { icon: 'sparkle', tone: 'big' },
  net: { icon: 'up', tone: 'quiet' },
  low: { icon: 'down', tone: 'quiet' },
  switch: { icon: 'link', tone: 'plain' },
  start: { icon: 'flag', tone: 'plain' },
};

const monthYear = (day: string) =>
  new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** For Home's link: how many moments, and the latest one. Null until there's more than the start. */
export function storyTeaser(moments: Moment[]): { count: number; latest: Moment } | null {
  const real = moments.filter((m) => m.kind !== 'start');
  return real.length ? { count: real.length, latest: real[real.length - 1] } : null;
}

export function StoryPage() {
  const app = useApp();
  if (!app) return null;
  const moments = ourStory(app.state, toDay(todayISO())).reverse();
  const begun = moments.length ? moments[moments.length - 1].day : null;

  // Newest first, under a heading for each year.
  const years: { year: string; moments: Moment[] }[] = [];
  for (const m of moments) {
    const year = m.day.slice(0, 4);
    if (years[years.length - 1]?.year !== year) years.push({ year, moments: [] });
    years[years.length - 1].moments.push(m);
  }

  return (
    <div>
      <button class="back-link" onClick={() => navigate('/')}>
        <Icon name="back" size={20} />
        Home
      </button>
      <header class="page-header" style="display:block;padding-top:6px">
        <h1>Our story so far</h1>
        <p class="lede">
          {begun
            ? `Everything worth remembering since ${monthYear(begun)}. It comes from the balances you both keep, so it’s the same on both phones.`
            : 'Your first balances start the story. Every card paid off and goal reached gets added here.'}
        </p>
      </header>

      {years.map(({ year, moments }) => (
        <section class="story-year" key={year}>
          <h2 class="group-label">{year}</h2>
          <ol class="story">
            {moments.map((m) => {
              const mark = MARKS[m.kind];
              return (
                <li class={`moment moment-${mark.tone}`} key={m.key}>
                  <span class="moment-mark" aria-hidden="true">
                    <Icon name={mark.icon} size={mark.tone === 'big' ? 15 : 14} />
                  </span>
                  <div class="moment-text">
                    <p class="moment-title">{m.title}</p>
                    <p class="moment-meta">
                      <time dateTime={m.day}>{formatDay(m.day)}</time>
                      {m.detail && <> · {m.detail}</>}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
