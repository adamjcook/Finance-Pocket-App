import { useEffect } from 'preact/hooks';
import { getStore, mutate, storeError, useApp } from './model/store';
import { useRoute } from './router';
import { Dashboard } from './ui/Dashboard';
import { Accounts } from './ui/Accounts';
import { AccountForm } from './ui/AccountForm';
import { Aliases } from './ui/Aliases';
import { Sync } from './ui/Sync';
import { Settings } from './ui/Settings';
import { Setup } from './ui/Setup';
import { UpdateToast } from './ui/components/UpdateToast';
import { Splash } from './ui/components/Splash';
import { Icon, type IconName } from './ui/components/Icon';
import { pullReadings } from './integrations/t212';
import { migrateSettingsGoals } from './model/repo';
import { refreshReminders, registrationFacts } from './integrations/push';

const TABS: { route: string; label: string; icon: IconName }[] = [
  { route: '/', label: 'Home', icon: 'home' },
  { route: '/accounts', label: 'Accounts', icon: 'accounts' },
  { route: '/sync', label: 'Sync', icon: 'sync' },
  { route: '/settings', label: 'Settings', icon: 'settings' },
];

/** Status-bar colour for the installed app — matches --bg for each theme. */
const THEME_COLOR = { dark: '#0b0d10', light: '#f2f3f5' } as const;

export function App() {
  const app = useApp();
  const setupDone = !!app && app.state.settings.updatedBy !== '';
  // The greeting is for whoever opened this phone: just their name once the
  // phone knows whose it is (Settings › You two), both names until then.
  let greetName: string | null = null;
  if (app && setupDone) {
    const { partnerAName, partnerBName } = app.state.settings;
    const me = app.device.me;
    greetName = me === 'A' ? partnerAName : me === 'B' ? partnerBName : `${partnerAName} & ${partnerBName}`;
  }
  // The splash sits beside the screens (not inside either branch below), so
  // it keeps running smoothly when storage finishes opening underneath it.
  return (
    <>
      <Screens />
      {!(app === null && storeError()) && <Splash ready={app !== null} names={greetName} />}
    </>
  );
}

function Screens() {
  const app = useApp();
  const route = useRoute();

  useEffect(() => {
    if (!app) return;
    document.documentElement.setAttribute('data-theme', app.device.theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[app.device.theme]);
    // Remembered for index.html, which applies it before the first frame so the
    // welcome splash opens in the right theme. Storage stays the real source.
    try {
      localStorage.setItem('finpair-theme', app.device.theme);
    } catch {
      /* private mode etc. — the splash just starts dark */
    }
  }, [app?.device.theme]);

  // Trading 212 link: pick up any new daily readings when the app opens or
  // comes back to the foreground (throttled inside pullReadings).
  const t212 = app?.state.settings.t212;
  useEffect(() => {
    if (!t212) return;
    void pullReadings();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void pullReadings();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [t212?.accountId, t212?.endpoint, t212?.token]);

  // Reminders: keep the Worker's copy of this phone's registration current
  // (0% end dates, the linked account's name) — resent only when it changes.
  const reminderKey = app
    ? JSON.stringify([app.device.push?.enabled, registrationFacts(app.state), t212?.endpoint, t212?.token])
    : '';
  useEffect(() => {
    if (app?.device.push?.enabled) void refreshReminders();
  }, [reminderKey]);

  // Goals moved from Settings to each account: carry over any old ones once.
  const oldGoals = app
    ? [app.state.settings.debtTargetDate, app.state.settings.loanTargetDate, app.state.settings.savingsTargetMinor, app.state.settings.savingsTargetDate].join('|')
    : '';
  useEffect(() => {
    if (app && oldGoals.replace(/\|/g, '') !== '') {
      void mutate((s) => migrateSettingsGoals(s, { deviceId: getStore().device.deviceId }));
    }
  }, [oldGoals]);

  if (!app) {
    const error = storeError();
    // While storage opens, the welcome splash (in App) covers the screen.
    if (!error) return null;
    return (
      <div class="loading">
        {`Couldn't open this phone's storage (${error.message}). Close the app fully and reopen it; if this keeps happening, check Chrome isn't blocking site data.`}
      </div>
    );
  }

  const setupDone = app.state.settings.updatedBy !== '';

  let screen;
  if (!setupDone) screen = <Setup />;
  else if (route === '/') screen = <Dashboard />;
  else if (route === '/accounts') screen = <Accounts key="list" />;
  // Keyed by route so moving between accounts never carries one form's state into another.
  else if (route === '/accounts/new') screen = <AccountForm key="new" id={null} />;
  else if (route.startsWith('/accounts/')) screen = <AccountForm key={route} id={route.slice('/accounts/'.length)} />;
  else if (route === '/aliases') screen = <Aliases />;
  // Update mode of the Accounts page (also where the payday reminder lands).
  else if (route === '/update') screen = <Accounts key="update" updating />;
  else if (route === '/sync') screen = <Sync />;
  else if (route === '/settings') screen = <Settings />;
  else screen = <Dashboard />;

  const tabRoute = route === '/update' ? '/accounts' : route;
  const activeTab = TABS.find(
    (t) => tabRoute === t.route || (t.route !== '/' && tabRoute.startsWith(t.route)),
  );

  return (
    <div class="shell">
      {import.meta.env.VITE_DEV_BUILD === '1' && (
        <div class="dev-banner">Dev build · mock data</div>
      )}
      <main class={`screen ${setupDone ? '' : 'screen-setup'}`}>{screen}</main>
      {setupDone && (
        <nav class="tabbar">
          {TABS.map((t) => (
            <a
              key={t.route}
              href={`#${t.route}`}
              class={`tab ${activeTab?.route === t.route ? 'active' : ''}`}
              aria-current={activeTab?.route === t.route ? 'page' : undefined}
            >
              <Icon name={t.icon} size={24} />
              {t.label}
            </a>
          ))}
        </nav>
      )}
      <UpdateToast />
    </div>
  );
}
