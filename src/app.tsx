import { useEffect, useState } from 'preact/hooks';
import { useApp } from './model/store';
import { DEFAULT_PARTNER_A_COLOR, DEFAULT_PARTNER_B_COLOR } from './model/types';
import { Dashboard } from './ui/Dashboard';
import { Accounts } from './ui/Accounts';
import { AccountForm } from './ui/AccountForm';
import { Aliases } from './ui/Aliases';
import { UpdateBalances } from './ui/UpdateBalances';
import { Sync } from './ui/Sync';
import { Settings } from './ui/Settings';
import { Setup } from './ui/Setup';
import { UpdateToast } from './ui/components/UpdateToast';

function currentRoute(): string {
  return location.hash.replace(/^#/, '') || '/';
}

export function useRoute(): string {
  const [route, setRoute] = useState(currentRoute());
  useEffect(() => {
    const onChange = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(route: string): void {
  location.hash = route;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Defensive: a color synced from an older/other app version might not be valid CSS. */
function safeColor(value: string | undefined, fallback: string): string {
  return value && HEX_COLOR.test(value) ? value : fallback;
}

const TABS = [
  { route: '/', label: 'Home', icon: '⌂' },
  { route: '/accounts', label: 'Accounts', icon: '☰' },
  { route: '/update', label: 'Update', icon: '✎' },
  { route: '/sync', label: 'Sync', icon: '⇄' },
  { route: '/settings', label: 'Settings', icon: '⚙' },
];

export function App() {
  const app = useApp();
  const route = useRoute();

  useEffect(() => {
    if (!app) return;
    const root = document.documentElement.style;
    root.setProperty('--partner-a', safeColor(app.state.settings.partnerAColor, DEFAULT_PARTNER_A_COLOR));
    root.setProperty('--partner-b', safeColor(app.state.settings.partnerBColor, DEFAULT_PARTNER_B_COLOR));
  }, [app?.state.settings.partnerAColor, app?.state.settings.partnerBColor]);

  if (!app) return <div class="loading">Loading…</div>;

  const setupDone = app.state.settings.updatedBy !== '';
  if (!setupDone) return <Setup />;

  let screen;
  if (route === '/') screen = <Dashboard />;
  else if (route === '/accounts') screen = <Accounts />;
  else if (route === '/accounts/new') screen = <AccountForm id={null} />;
  else if (route.startsWith('/accounts/')) screen = <AccountForm id={route.slice('/accounts/'.length)} />;
  else if (route === '/aliases') screen = <Aliases />;
  else if (route === '/update') screen = <UpdateBalances />;
  else if (route === '/sync') screen = <Sync />;
  else if (route === '/settings') screen = <Settings />;
  else screen = <Dashboard />;

  const activeTab = TABS.find(
    (t) => route === t.route || (t.route !== '/' && route.startsWith(t.route)),
  );

  return (
    <div class="shell">
      <main class="screen">{screen}</main>
      <nav class="tabbar">
        {TABS.map((t) => (
          <a
            key={t.route}
            href={`#${t.route}`}
            class={`tab ${activeTab?.route === t.route ? 'active' : ''}`}
          >
            <span class="tab-icon" aria-hidden="true">
              {t.icon}
            </span>
            {t.label}
          </a>
        ))}
      </nav>
      <UpdateToast />
    </div>
  );
}
