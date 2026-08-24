import { useState } from 'preact/hooks';
import { mutate, getStore } from '../model/store';
import { updateSettings } from '../model/repo';
import { navigate } from '../app';

const CURRENCIES = ['GBP', 'EUR', 'USD'];

/** First-run screen: partner names + currency. Saving stamps settings, which marks setup done. */
export function Setup() {
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
        <h1>Pocket Finances</h1>
        <p class="muted" style="margin-bottom:18px">
          A shared finance tracker for the two of you. Everything stays on your phones — no
          accounts, no cloud. You'll pair with your partner's phone later from the Sync tab.
        </p>
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
          <button class="btn-primary btn-big" onClick={() => void save()}>
            Get started
          </button>
        </div>
        <p class="muted small">
          Tip: if your partner has already set the app up on their phone, you can skip typing —
          finish this step with anything, then run a Sync and their setup will carry over.
        </p>
      </main>
    </div>
  );
}
