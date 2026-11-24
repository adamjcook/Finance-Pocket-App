import { useState } from 'preact/hooks';
import { mutate, getStore, patchDevice } from '../model/store';
import { updateSettings } from '../model/repo';
import { CURRENCIES } from '../model/types';
import { navigate } from '../router';
import { ScanPanel } from './components/ScanPanel';
import { loadMockData } from '../dev/mockData';
import { toDay, todayISO } from '../logic/progress';
import { starterQuote } from '../logic/wisdom';
import { Icon } from './components/Icon';

type Mode = 'choose' | 'form' | 'join';

/**
 * First-run screen. Exactly one phone should "start fresh" (creating the
 * shared partner names); the second phone joins by syncing, so both phones
 * agree on which name is which — accounts' owner labels stay consistent.
 */
export function Setup() {
  const [mode, setMode] = useState<Mode>('choose');
  const [nameA, setNameA] = useState('');
  const [nameB, setNameB] = useState('');
  const [currency, setCurrency] = useState('GBP');

  const save = async () => {
    const { device } = getStore();
    await mutate((s) =>
      updateSettings(s, { deviceId: device.deviceId }, {
        partnerAName: nameA.trim() || 'Partner A',
        partnerBName: nameB.trim() || 'Partner B',
        currency,
      }),
    );
    // Whoever sets up typed "Your name" first, so this phone is theirs.
    await patchDevice({ me: 'A' });
    navigate('/accounts/new');
  };

  const logo = `${import.meta.env.BASE_URL}${import.meta.env.VITE_ICON_DIR}/favicon.svg`;
  const back = (
    <button class="back-link" onClick={() => setMode('choose')}>
      <Icon name="back" size={20} />
      Back
    </button>
  );

  if (mode === 'form') {
    return (
      <div>
        {back}
        <header class="page-header" style="display:block;padding-top:6px">
          <h1>Set up FinPair</h1>
          <p class="lede">Just the basics — you can change any of this later in Settings.</p>
        </header>
        <div class="card">
          <label class="field">
            <span>Your name</span>
            <input value={nameA} onInput={(e) => setNameA((e.target as HTMLInputElement).value)} placeholder="e.g. Adam" />
          </label>
          <label class="field">
            <span>Your partner's name</span>
            <input value={nameB} onInput={(e) => setNameB((e.target as HTMLInputElement).value)} placeholder="e.g. Sam" />
          </label>
          <label class="field">
            <span>Currency</span>
            <select value={currency} onChange={(e) => setCurrency((e.target as HTMLSelectElement).value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button class="btn-primary btn-big" style="margin-top:20px" onClick={() => void save()}>
          Get started
        </button>
      </div>
    );
  }

  if (mode === 'join') {
    return (
      <div>
        {back}
        <header class="page-header" style="display:block;padding-top:6px">
          <h1>Join your partner</h1>
          <p class="lede">
            On their phone, open <strong>Sync</strong> and tap <strong>Show my data</strong>, then
            scan their screen here. Their setup, accounts and history carry over.
          </p>
        </header>
        <ScanPanel
          onComplete={() => {
            // The joining phone is the partner's; Settings can change it.
            void patchDevice({ me: 'B' });
            navigate('/');
          }}
          onCancel={() => setMode('choose')}
        />
      </div>
    );
  }

  return (
    <div class="welcome">
      <div class="welcome-hero">
        <img src={logo} class="welcome-logo" alt="" />
        <h1>FinPair</h1>
        <p class="lede">
          Your shared money, side by side. Everything stays on your two phones — no accounts, no
          cloud.
        </p>
        <p class="quote">{starterQuote(toDay(todayISO()))}</p>
      </div>
      <div class="welcome-actions">
        <button class="btn-primary btn-big" onClick={() => setMode('form')}>
          Set up on this phone first
        </button>
        <button class="btn-big" onClick={() => setMode('join')}>
          Join your partner's setup
        </button>
        {import.meta.env.VITE_DEV_BUILD === '1' && (
          <button class="btn-big btn-quiet" onClick={() => void loadMockData().then(() => navigate('/'))}>
            Load mock data
          </button>
        )}
      </div>
      <p class="welcome-note">
        Set up on <strong>one</strong> phone only — the other joins by scanning, so names and
        owners match on both.
      </p>
    </div>
  );
}
