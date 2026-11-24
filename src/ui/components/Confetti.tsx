import { useEffect, useRef } from 'preact/hooks';
import { createPortal } from 'preact/compat';

/**
 * A one-off burst of the FinPair mark's own pieces — teal and amber circles
 * and the yellow lens where they overlap — thrown up from `origin` and
 * falling away. Drawn on a canvas that ignores taps and removes itself when
 * done; skipped entirely with reduced motion.
 */

const COLORS = ['#4fd1a5', '#f2a65a', '#f7ef8a'];

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  spin: number;
  angle: number;
  color: string;
  lens: boolean;
}

export function Confetti({
  originSelector,
  delay = 0,
  count = 40,
  onDone,
}: {
  originSelector: string;
  delay?: number;
  count?: number;
  onDone?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onDone?.();
      return;
    }
    let raf = 0;
    const timer = setTimeout(() => {
      const canvas = canvasRef.current;
      const origin = document.querySelector(originSelector)?.getBoundingClientRect();
      const ctx = canvas?.getContext('2d');
      if (!canvas || !origin || !ctx) return onDone?.();

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);

      // Thrown up and outwards from across the figure, like a popper.
      const pieces: Piece[] = Array.from({ length: count }, () => {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.95;
        const speed = 7 + Math.random() * 7;
        return {
          x: origin.left + Math.random() * Math.min(origin.width, 220),
          y: origin.top + origin.height * 0.5,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          r: 3 + Math.random() * 3.5,
          spin: (Math.random() - 0.5) * 0.3,
          angle: Math.random() * Math.PI,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          lens: Math.random() < 0.35,
        };
      });

      const start = performance.now();
      const life = 1500;
      let last = start;
      const frame = (now: number) => {
        const dt = Math.min(2, (now - last) / 16.67); // in 60fps frames
        last = now;
        const t = (now - start) / life;
        ctx.clearRect(0, 0, w, h);
        for (const p of pieces) {
          p.vy += 0.32 * dt; // gravity
          p.vx *= Math.pow(0.985, dt); // air
          p.vy *= Math.pow(0.985, dt);
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.angle += p.spin * dt;
          ctx.save();
          ctx.globalAlpha = t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.4);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          if (p.lens) {
            // The overlap of two circles: a pointed oval.
            ctx.ellipse(0, 0, p.r * 0.55, p.r * 1.4, 0, 0, Math.PI * 2);
          } else {
            ctx.arc(0, 0, p.r, 0, Math.PI * 2);
          }
          ctx.fill();
          ctx.restore();
        }
        if (t < 1) raf = requestAnimationFrame(frame);
        else {
          ctx.clearRect(0, 0, w, h);
          onDone?.();
        }
      };
      raf = requestAnimationFrame(frame);
    }, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, []);

  // On <body>, not in place: an ancestor with an animated transform (the
  // screen's entrance) would otherwise trap this fixed canvas inside it.
  return createPortal(<canvas ref={canvasRef} class="confetti" aria-hidden="true" />, document.body);
}
