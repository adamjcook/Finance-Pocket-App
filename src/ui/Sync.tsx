import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../model/store';
import { FrameCollector } from '../sync/codec';
import { applyPayload, currentFrames, type ApplyResult } from '../sync/apply';
import { QRLoop } from '../sync/send';
import { startScanner, type Scanner } from '../sync/scan';

type Mode = 'idle' | 'show' | 'scan' | 'merged';

export function Sync() {
  const app = useApp();
  const [mode, setMode] = useState<Mode>('idle');
  const [frameInfo, setFrameInfo] = useState<[number, number]>([0, 0]);
  const [received, setReceived] = useState<boolean[]>([]);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speed, setSpeed] = useState(400);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const loopRef = useRef<QRLoop | null>(null);
  const scannerRef = useRef<Scanner | null>(null);

  const cleanup = () => {
    loopRef.current?.stop();
    loopRef.current = null;
    scannerRef.current?.stop();
    scannerRef.current = null;
  };
  useEffect(() => cleanup, []);

  const startShow = async (afterMerge: ApplyResult | null) => {
    setError(null);
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

  const startScan = () => {
    setError(null);
    setMode('scan');
    setReceived([]);
    const collector = new FrameCollector();
    requestAnimationFrame(() => {
      if (!videoRef.current) return;
      startScanner(videoRef.current, (text) => {
        if (!collector.add(text)) return;
        setReceived(Array.from({ length: collector.expected() }, (_, i) => collector.has(i)));
        if (collector.isComplete()) {
          scannerRef.current?.stop();
          scannerRef.current = null;
          collector
            .result()
            .then(applyPayload)
            .then((r) => void startShow(r))
            .catch((err: unknown) => {
              setError(err instanceof Error ? err.message : String(err));
              setMode('idle');
            });
        }
      })
        .then((s) => {
          scannerRef.current = s;
        })
        .catch(() => {
          setError(
            "Couldn't open the camera. Check that camera permission is allowed for this app in Chrome's site settings.",
          );
          setMode('idle');
        });
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
              cleanup();
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
        <video ref={videoRef} class="scan-video" playsInline muted />
        {received.length > 0 ? (
          <>
            <div class="progress-strip">
              {received.map((got, i) => (
                <span key={i} class={`progress-cell ${got ? 'got' : ''}`} />
              ))}
            </div>
            <p class="muted small" style="margin-top:6px">
              {received.filter(Boolean).length} of {received.length} pieces — hold steady, missing
              pieces come around again
            </p>
          </>
        ) : (
          <p class="muted small" style="margin-top:10px">
            Point the camera at the code on your partner's phone.
          </p>
        )}
        <button
          class="btn-big"
          style="margin-top:12px"
          onClick={() => {
            cleanup();
            setMode('idle');
          }}
        >
          Cancel
        </button>
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
      {error && <div class="error-box">{error}</div>}
      <p class="muted" style="margin-bottom:14px">
        Sit together, then: one phone <strong>shows</strong>, the other <strong>scans</strong>.
        After scanning, the second phone shows the combined result back — scan that and you're
        both up to date. No internet involved; the data goes screen-to-camera.
      </p>
      <div class="stack">
        <button class="btn-primary btn-big" onClick={() => void startShow(null)}>
          Show my data
        </button>
        <button class="btn-big" onClick={startScan}>
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
