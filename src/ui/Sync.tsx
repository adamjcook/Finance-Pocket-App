import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../model/store';
import { currentFrames, type ApplyResult } from '../sync/apply';
import { QRLoop } from '../sync/send';
import { ScanPanel } from './components/ScanPanel';

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
        <h1>{result ? 'Now show this back' : 'Show this to your partner'}</h1>
        {result && (
          <div class="card">
            <p>
              Merged in: <strong>{result.summary.newSnapshots}</strong> balance update(s),{' '}
              <strong>{result.summary.accountsChanged}</strong> account change(s),{' '}
              <strong>{result.summary.aliasesChanged}</strong> alias change(s).
            </p>
            <p class="muted small" style="margin-top:6px">
              Your partner should now scan this code with their Sync screen. When they're done,
              compare check codes — both phones should show:
            </p>
            <div class="hash-code" style="margin-top:8px">
              {result.hash}
            </div>
          </div>
        )}
        <div class="qr-holder">
          <canvas ref={canvasRef} />
        </div>
        <p class="muted small" style="text-align:center;margin-top:8px">
          frame {frameInfo[0] + 1} / {frameInfo[1]} — keeps looping until your partner has them all
        </p>
        <div class="row" style="margin-top:12px">
          <button
            style="flex:1"
            onClick={() => {
              const slower = speed >= 700 ? 400 : speed + 150;
              setSpeed(slower);
              loopRef.current?.setSpeed(slower);
            }}
          >
            Speed: {(1000 / speed).toFixed(1)} codes/s
          </button>
          <button
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
        <h1>Scan your partner's screen</h1>
        <ScanPanel onComplete={(r) => void startShow(r)} onCancel={() => setMode('idle')} />
      </div>
    );
  }

  if (mode === 'merged') {
    return (
      <div>
        <h1>Sync complete</h1>
        <div class="card">
          <p class="muted small">Both phones should show this check code:</p>
          <div class="hash-code" style="margin:12px 0">
            {result?.hash}
          </div>
          <p class="muted small">
            If they match, you're fully in sync. If not, run the sync once more in either
            direction — it's always safe to repeat.
          </p>
        </div>
        <button class="btn-big btn-primary" onClick={() => setMode('idle')}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1>Sync phones</h1>
      <p class="muted" style="margin-bottom:14px">
        Sit together, then: one phone <strong>shows</strong>, the other <strong>scans</strong>.
        After scanning, the second phone shows the combined result back — scan that and you're
        both up to date. No internet involved; the data goes screen-to-camera.
      </p>
      <div class="stack">
        <button class="btn-primary btn-big" onClick={() => void startShow(null)}>
          Show my data
        </button>
        <button class="btn-big" onClick={() => setMode('scan')}>
          Scan partner's screen
        </button>
      </div>
      <div class="card" style="margin-top:18px">
        <p class="muted small">
          Last synced:{' '}
          {device.lastSyncAt ? new Date(device.lastSyncAt).toLocaleString() : 'never'}
          {device.lastSyncStateHash && (
            <>
              {' · '}check code <strong>{device.lastSyncStateHash}</strong>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
