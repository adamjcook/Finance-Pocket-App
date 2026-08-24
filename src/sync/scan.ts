/**
 * Camera QR scanner. Primary decoder is Chrome-on-Android's built-in
 * BarcodeDetector; jsQR is lazy-loaded as a fallback for browsers without it.
 */

export interface Scanner {
  stop(): void;
}

interface Detector {
  detect(video: HTMLVideoElement): Promise<string[]>;
}

async function makeDetector(): Promise<Detector> {
  const BD = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (BD) {
    try {
      const formats = await BD.getSupportedFormats();
      if (formats.includes('qr_code')) {
        const detector = new BD({ formats: ['qr_code'] });
        return {
          async detect(video) {
            const codes = await detector.detect(video);
            return codes.map((c) => c.rawValue);
          },
        };
      }
    } catch {
      // fall through to jsQR
    }
  }
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return {
    detect(video) {
      if (!video.videoWidth) return Promise.resolve([]);
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
      return Promise.resolve(code ? [code.data] : []);
    },
  };
}

export async function startScanner(
  video: HTMLVideoElement,
  onText: (text: string) => void,
): Promise<Scanner> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  const detector = await makeDetector();
  let stopped = false;
  let busy = false;

  const timer = setInterval(() => {
    if (stopped || busy || video.readyState < 2) return;
    busy = true;
    detector
      .detect(video)
      .then((texts) => {
        for (const t of texts) onText(t);
      })
      .catch(() => {})
      .finally(() => {
        busy = false;
      });
  }, 150);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
    },
  };
}

// Minimal typings for the (still unshipped-in-TS-lib) BarcodeDetector API.
interface BarcodeDetectorCtor {
  new (options?: { formats: string[] }): {
    detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
  };
  getSupportedFormats(): Promise<string[]>;
}
