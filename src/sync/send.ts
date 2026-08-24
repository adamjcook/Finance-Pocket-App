import QRCode from 'qrcode';

/**
 * Endless animated QR loop. Cycling through all frames repeatedly means the
 * scanning phone never needs them in order — anything it missed comes around
 * again on the next pass.
 */
export class QRLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private index = 0;
  paused = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private frames: string[],
    private onFrame: (index: number, total: number) => void,
    private msPerFrame = 400,
  ) {}

  start(): void {
    this.stop();
    void this.draw();
    this.timer = setInterval(() => {
      if (this.paused) return;
      this.index = (this.index + 1) % this.frames.length;
      void this.draw();
    }, this.msPerFrame);
  }

  setSpeed(msPerFrame: number): void {
    this.msPerFrame = msPerFrame;
    if (this.timer) this.start();
  }

  private async draw(): Promise<void> {
    // Error-correction L: the loop re-shows every frame, so trade EC for capacity.
    await QRCode.toCanvas(this.canvas, this.frames[this.index], {
      errorCorrectionLevel: 'L',
      margin: 2,
      width: 480,
    });
    this.onFrame(this.index, this.frames.length);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
