import { useEffect, useRef, useState } from 'preact/hooks';
import { FrameCollector } from '../../sync/codec';
import { applyPayload, type ApplyResult } from '../../sync/apply';
import { startScanner, type Scanner } from '../../sync/scan';

interface Props {
  /** Called after the scanned payload has been merged and persisted. */
  onComplete: (result: ApplyResult) => void;
  onCancel: () => void;
}

/**
 * Camera scanner for a partner's animated QR loop: video preview, chunk
 * progress strip, merge-on-completion. Shared by the Sync screen and the
 * "Join your partner" path in Setup.
 */
export function ScanPanel({ onComplete, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<Scanner | null>(null);
  const [received, setReceived] = useState<boolean[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const collector = new FrameCollector();
    let done = false;
    if (!videoRef.current) return;
    startScanner(videoRef.current, (text) => {
      if (done || !collector.add(text)) return;
      setReceived(Array.from({ length: collector.expected() }, (_, i) => collector.has(i)));
      if (collector.isComplete()) {
        done = true;
        scannerRef.current?.stop();
        scannerRef.current = null;
        collector
          .result()
          .then(applyPayload)
          .then(onComplete)
          .catch((err: unknown) => {
            setError(err instanceof Error ? err.message : String(err));
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
      });
    return () => {
      done = true;
      scannerRef.current?.stop();
      scannerRef.current = null;
    };
  }, []);

  return (
    <div>
      {error ? (
        <div class="error-box">{error}</div>
      ) : (
        <video ref={videoRef} class="scan-video" playsInline muted />
      )}
      {!error &&
        (received.length > 0 ? (
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
        ))}
      <button class="btn-big" style="margin-top:12px" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
