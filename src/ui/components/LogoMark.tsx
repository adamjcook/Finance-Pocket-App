import { useId } from 'preact/hooks';
import { MONOGRAM } from './monogram';

/**
 * The MC Bank mark drawn inline (rather than as an <img>) so its parts can
 * move: the ring and the interlocking letters are separate. The welcome
 * splash draws the ring round the letters; with `celebrate`, the ring rings
 * out and the letters lift when an update leaves the two of you better off.
 * Same shapes as the home-screen icon (scripts/gen-monogram.py).
 */
export function LogoMark({ class: className, celebrate = false }: { class?: string; celebrate?: boolean }) {
  const dev = import.meta.env.VITE_DEV_BUILD === '1';
  const clip = `logo-tile-${useId()}`;
  return (
    <svg
      class={`${className ?? ''} ${celebrate ? 'celebrate' : ''}`}
      viewBox="0 0 512 512"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={clip}>
          <rect width="512" height="512" rx="116" />
        </clipPath>
      </defs>
      <g clip-path={`url(#${clip})`}>
        <rect width="512" height="512" fill={MONOGRAM.background} />
        {/* Starts at the top and runs clockwise when it's drawn in. */}
        <circle
          class="mark-ring"
          cx="256"
          cy="256"
          r={MONOGRAM.ring.r}
          fill="none"
          stroke="#ffffff"
          stroke-width={MONOGRAM.ring.width}
          pathLength={100}
          transform="rotate(-90 256 256)"
        />
        <g class="mark-letters" fill="#ffffff">
          <path transform={MONOGRAM.m.transform} d={MONOGRAM.m.d} />
          <path transform={MONOGRAM.c.transform} d={MONOGRAM.c.d} />
        </g>
        {dev && (
          <>
            {/* Matches public/icons-dev: the dev build's DEV band. */}
            <rect y="334" width="512" height="108" fill="#e0b400" />
            <text
              x="256"
              y="414"
              text-anchor="middle"
              fill="#1b1400"
              font-family="Arial, Helvetica, sans-serif"
              font-size="82"
              font-weight="800"
              letter-spacing="10"
            >
              DEV
            </text>
          </>
        )}
      </g>
    </svg>
  );
}
