import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../model/store';
import { currentFrames, type ApplyResult } from '../sync/apply';
import { QRLoop } from '../sync/send';
import { ScanPanel } from './components/ScanPanel';
import { Icon } from './components/Icon';

type Mode = 'idle' | 'show' | 'scan' | 'merged';

export function Sync() {
  const app = useApp();
  const [mode, setMode] = useState<Mode>('idle');
  const [frameInfo, setFrameInfo] = useState<[number, number]>([0, 0]);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [speed, setSpeed] = useState(400);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loopRef = useRef<QRLoop | null>(null);

  const stopLoop = () => {
    loopRef.current?.stop();
    loopRef.current = null;
  };
  useEffect(() => stopLoop, []);

  const startShow = async (afterMerge: ApplyResult | null) => {
    setResult(afterMerge);
    setMode('show');
    const frames = await currentFrames();
    // wait a tick for the canvas to mount
    requestAnimationFrame(() => {
      if (!canvasRef.current) return;
      loopRef.current = new QRLoop(canvasRef.current, frames, (i, n) => setFrameInfo([i, n]), speed);
      loopRef.current.start();
    });
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
            {speed >= 700 ? 'Slowest' : speed >= 550 ? 'Slower' : 'Normal speed'}
          </button>
          <button
            class="btn-big btn-primary"
            style="flex:1"
            onClick={() => {
              stopLoop();
              setMode(result ? 'merged' : 'idle');
            }}
          >
            {result ? "Partner's got it" : 'Done'}
          </button>
        </div>
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

  return (
    <div>
      <header class="page-header" style="display:block">
        <h1>Sync</h1>
        <p class="lede">Sit together — one phone shows, the other scans. No internet involved.</p>
      </header>
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
              <span class="muted num" style="font-family:ui-monospace,monospace;letter-spacing:0.1em">
                {device.lastSyncStateHash}
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
