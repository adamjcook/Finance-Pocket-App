import { useState } from 'preact/hooks';
import { mutate, getStore } from '../model/store';
import { updateSettings } from '../model/repo';
import { navigate } from '../app';
import { ScanPanel } from './components/ScanPanel';

const CURRENCIES = ['GBP', 'EUR', 'USD'];

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
    navigate('/accounts/new');
  };

  return (
    <div class="shell">
      <main class="screen">
        <div class="title-row">
          <img src={`${import.meta.env.BASE_URL}icons/favicon.svg`} class="app-logo" alt="" />
          <h1>FinPair</h1>
        </div>

        {mode === 'choose' && (
          <>
            <p class="muted" style="margin-bottom:18px">
              A shared finance tracker for the two of you. Everything stays on your phones — no
              accounts, no cloud.
            </p>
            <div class="stack">
              <button class="btn-primary btn-big" onClick={() => setMode('form')}>
                Set up on this phone first
              </button>
              <button class="btn-big" onClick={() => setMode('join')}>
                Join your partner's setup
              </button>
            </div>
            <p class="muted small" style="margin-top:14px">
              Set up on <strong>one</strong> phone only; the other should join by scanning. That
              keeps names and account owners consistent on both phones.
            </p>
          </>
        )}

        {mode === 'form' && (
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
            <div class="stack">
              <button class="btn-primary btn-big" onClick={() => void save()}>
                Get started
              </button>
              <button class="btn-big" onClick={() => setMode('choose')}>
                Back
              </button>
            </div>
          </div>
        )}

        {mode === 'join' && (
          <>
            <p class="muted" style="margin-bottom:14px">
              On your partner's phone, open <strong>Sync</strong> and tap{' '}
              <strong>"Show my data"</strong> — then scan their screen here. Their setup, accounts
              and history will carry over.
            </p>
            <ScanPanel
              onComplete={() => navigate('/')}
              onCancel={() => setMode('choose')}
            />
          </>
        )}
      </main>
    </div>
  );
}
