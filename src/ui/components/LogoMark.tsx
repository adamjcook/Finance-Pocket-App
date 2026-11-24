/**
 * The FinPair mark drawn inline (rather than as an <img>) so its parts can
 * move: two circles, one shared overlap. With `celebrate`, the circles draw
 * together and the overlap brightens — the launch splash's gesture, replayed
 * small when an update leaves the two of you better off.
 */
export function LogoMark({ class: className, celebrate = false }: { class?: string; celebrate?: boolean }) {
  const dev = import.meta.env.VITE_DEV_BUILD === '1';
  return (
    <svg
      class={`${className ?? ''} ${celebrate ? 'celebrate' : ''}`}
      viewBox="0 0 512 512"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id="logo-tile">
          <rect width="512" height="512" rx="116" />
        </clipPath>
      </defs>
      <g clip-path="url(#logo-tile)">
        <rect width="512" height="512" fill="#101418" />
        <circle class="mark-a" cx="190" cy="256" r="118" fill="#4fd1a5" />
        <circle class="mark-b" cx="322" cy="256" r="118" fill="#f2a65a" />
        <path class="mark-lens" d="M256,158.2 A118,118 0 0 0 256,353.8 A118,118 0 0 0 256,158.2 Z" fill="#f7ef8a" />
        {dev && (
          <>
            {/* Matches public/icons-dev/favicon.svg: the dev build's DEV band. */}
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
