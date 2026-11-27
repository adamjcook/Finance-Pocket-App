import { useEffect, useRef, useState } from 'preact/hooks';
import { patchDevice, useApp } from '../model/store';
import { syncNow } from '../sync/relay';
import { workerReady } from '../integrations/t212';
import { currentFrames, type ApplyResult } from '../sync/apply';
import { QRLoop } from '../sync/send';
import { ScanPanel } from './components/ScanPanel';
import { Icon } from './components/Icon';
import { APP_NAME } from '../appName';

type Mode = 'idle' | 'show' | 'scan' | 'merged';

export function Sync() {
  const app = useApp();
  const [mode, setMode] = useState<Mode>('idle');
  const [frameInfo, setFrameInfo] = useState<[number, number]>([0, 0]);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [speed, setSpeed] = useState(400);
  // Coarser codes for a camera that struggles (a laptop webcam, a soft focus).
  const [large, setLarge] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loopRef = useRef<QRLoop | null>(null);
  const loopGen = useRef(0);

  const stopLoop = () => {
    loopRef.current?.stop();
    loopRef.current = null;
  };
  useEffect(() => stopLoop, []);

  const startLoop = async (bigger: boolean) => {
    const gen = ++loopGen.current;
    const frames = await currentFrames(bigger);
    // wait a tick for the canvas to mount
    requestAnimationFrame(() => {
      // a later tap of "Bigger codes" has already replaced this loop
      if (!canvasRef.current || gen !== loopGen.current) return;
      stopLoop();
      loopRef.current = new QRLoop(canvasRef.current, frames, (i, n) => setFrameInfo([i, n]), speed);
      loopRef.current.start();
    });
  };

  const startShow = async (afterMerge: ApplyResult | null) => {
    setResult(afterMerge);
    setMode('show');
    await startLoop(large);
  };

  if (!app) return null;
  const { device } = app;

  if (mode === 'show') {
    return (
      <div>
        <header class="page-header" style="display:block">
          <h1>{result ? 'Now show this back' : 'Show your partner'}</h1>
          <p class="lede">
            {result
              ? 'Your partner scans this to pick up the combined result.'
              : 'Your partner taps “Scan partner’s screen” and points their camera here.'}
          </p>
        </header>
        {result && (
          <div class="card" style="margin-bottom:14px">
            <div class="stat-line">
              Balance updates merged <strong>{result.summary.newSnapshots}</strong>
            </div>
            <div class="stat-line">
              Account changes <strong>{result.summary.accountsChanged}</strong>
            </div>
            <div class="stat-line">
              Alias changes <strong>{result.summary.aliasesChanged}</strong>
            </div>
            <p class="small muted" style="margin:12px 0 10px">
              When they're done, both phones should show this check code:
            </p>
            <div class="hash-code">{result.hash}</div>
          </div>
        )}
        <div class="qr-holder">
          <canvas ref={canvasRef} />
        </div>
        <p class="small faint num" style="text-align:center;margin-top:10px">
          Code {frameInfo[0] + 1} of {frameInfo[1]} · loops until your partner has them all
        </p>
        <div class="row" style="margin-top:16px">
          <button
            class="btn-big"
            style="flex:1"
            onClick={() => {
              const slower = speed >= 700 ? 400 : speed + 150;
              setSpeed(slower);
              loopRef.current?.setSpeed(slower);
            }}
          >
            {/* Says what tapping will do, not the speed it's at. */}
            {speed >= 700 ? 'Back to normal speed' : 'Slow down'}
          </button>
          <button
            class="btn-big"
            style="flex:1"
            onClick={() => {
              const bigger = !large;
              setLarge(bigger);
              void startLoop(bigger);
            }}
          >
            {/* Like the speed button: says what tapping will do. */}
            {large ? 'Smaller codes' : 'Bigger codes'}
          </button>
        </div>
        <button
          class="btn-big btn-primary"
          style="width:100%;margin-top:10px"
          onClick={() => {
            stopLoop();
            setMode(result ? 'merged' : 'idle');
          }}
        >
          {result ? "Partner's got it" : 'Done'}
        </button>
      </div>
    );
  }

  if (mode === 'scan') {
    return (
      <div>
        <header class="page-header" style="display:block">
          <h1>Scan</h1>
          <p class="lede">Point the camera at the code on your partner's phone.</p>
        </header>
        <ScanPanel onComplete={(r) => void startShow(r)} onCancel={() => setMode('idle')} />
      </div>
    );
  }

  if (mode === 'merged') {
    return (
      <div style="text-align:center;padding-top:28px">
        <div class="success-mark">
          <Icon name="check" size={30} />
        </div>
        <h1>Sync complete</h1>
        <p class="lede" style="margin:8px auto 22px;max-width:32ch">
          Both phones should show this check code. If they match, you're fully in sync.
        </p>
        <div class="hash-code">{result?.hash}</div>
        <p class="small faint" style="margin:14px auto 26px;max-width:36ch">
          Codes don't match? Run the sync once more in either direction — it's always safe to
          repeat.
        </p>
        <button class="btn-big btn-primary" onClick={() => setMode('idle')}>
          Done
        </button>
      </div>
    );
  }

  // Automatic sync needs the Worker (Settings › Connections) and a key the
  // phones swapped in a QR sync; then it's on unless switched off here.
  const relay = device.relay ?? null;
  const hasWorker = workerReady(app.state.settings.t212);
  const canAuto = hasWorker && !!relay?.key;
  const autoOn = canAuto && relay?.enabled !== false;
  const ago = (iso: string) => {
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
    return mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  const autoStatus = !hasWorker
    ? 'Needs your Worker: set it up under Settings › Connections.'
    : !relay?.key
      ? 'Sync once by QR code below to link the two phones.'
      : !autoOn
        ? 'Off on this phone.'
        : relay.error
          ? relay.error
          : relay.checkedAt
            ? `On · checked ${ago(relay.checkedAt)}`
            : `On · checks when ${APP_NAME} opens`;

  // Until there's a Worker, automatic sync can't be switched on, so the way
  // that works today (QR) comes first and this sits below it as a pointer.
  const autoSection = (
    <>
      <section class="group">
        <h2 class="group-label">Automatic sync</h2>
        <div class="list">
          <div class="list-row">
            <div class="grow">
              <div class="row-title">Sync through your Worker</div>
              <div class="row-sub" style="white-space:normal" role="status">
                {autoStatus}
              </div>
            </div>
            <button
              class="switch"
              role="switch"
              aria-checked={autoOn}
              aria-label="Sync through your Worker"
              disabled={!canAuto}
              onClick={() =>
                void patchDevice({ relay: { ...relay!, enabled: !autoOn } }).then(() => {
                  if (!autoOn) void syncNow();
                })
              }
            />
          </div>
          {autoOn && (
            <div class="list-row">
              <button
                class="btn-sm grow"
                disabled={syncing}
                onClick={() => {
                  setSyncing(true);
                  void syncNow().finally(() => setSyncing(false));
                }}
              >
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
            </div>
          )}
        </div>
        <p class="group-footer">
          Everything is encrypted on this phone first. Your Worker keeps only a copy it can't read:
          the key stays on your two phones, and travels between them only in the QR codes.
        </p>
      </section>
    </>
  );

  return (
    <div>
      <header class="page-header" style="display:block">
        <h1>Sync</h1>
        <p class="lede">
          {autoOn
            ? 'Your phones keep each other up to date through your Worker. Sync by QR code to link a new phone, or if they ever disagree.'
            : 'Sit together — one phone shows, the other scans. No internet involved.'}
        </p>
      </header>

      {hasWorker && autoSection}

      <h2 class={`group-label ${hasWorker ? 'qr-label' : ''}`}>By QR code</h2>
      <div class="stack">
        <button class="action-tile primary" onClick={() => void startShow(null)}>
          <span class="tile-icon">
            <Icon name="qr" />
          </span>
          <span class="grow">
            <span class="tile-title">Show my data</span>
            <span class="tile-sub">Display a looping code for your partner to scan</span>
          </span>
          <Icon name="chevron" size={18} class="row-chevron" />
        </button>
        <button class="action-tile" onClick={() => setMode('scan')}>
          <span class="tile-icon">
            <Icon name="camera" />
          </span>
          <span class="grow">
            <span class="tile-title">Scan partner's screen</span>
            <span class="tile-sub">Use the camera to read their code</span>
          </span>
          <Icon name="chevron" size={18} class="row-chevron" />
        </button>
      </div>

      {!hasWorker && autoSection}

      <section class="group" style="margin-top:28px">
        <h2 class="group-label">How it works</h2>
        <div class="card">
          <ol class="steps">
            <li>One phone taps <strong>Show my data</strong>; the other scans it.</li>
            <li>The scanning phone merges everything and shows the combined result back.</li>
            <li>The first phone scans that — now you're both up to date.</li>
            <li>Check codes match on both phones? You're identical.</li>
          </ol>
        </div>
      </section>

      <section class="group">
        <h2 class="group-label">This phone</h2>
        <div class="list">
          <div class="list-row setting-row">
            <span>Last synced</span>
            <span class="muted">
              {device.lastSyncAt
                ? new Date(device.lastSyncAt).toLocaleString(undefined, {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : 'Never'}
            </span>
          </div>
          {device.lastSyncStateHash && (
            <div class="list-row setting-row">
              <span>Check code</span>
              <span class="muted check-code">{device.lastSyncStateHash}</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
