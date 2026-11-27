/**
 * The app's icon set — simple 24×24 stroke glyphs drawn to one grid so they
 * sit together consistently (tab bar, buttons, list rows). Decorative by
 * default: whatever they sit next to carries the accessible name.
 */
const PATHS = {
  home: 'M3.5 10.2 12 3.5l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4v-6h-6v6H5A1.5 1.5 0 0 1 3.5 19z',
  accounts: 'M3.5 7.5A2 2 0 0 1 5.5 5.5h13a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2zM3.5 10h17M7 15h3',
  update: 'M4 20h4.5L19.3 9.2a2.1 2.1 0 0 0-3-3L5.5 17v3M14.5 8l3 3',
  sync: 'M4.5 9h13l-3.5-3.5M19.5 15h-13l3.5 3.5',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9',
  plus: 'M12 5v14M5 12h14',
  chevron: 'm9.5 6 6 6-6 6',
  back: 'm14.5 6-6 6 6 6',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  x: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2',
  camera:
    'M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.5-2h5.4l1.5 2h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM12 16.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14',
  upload: 'M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14',
  shield: 'M12 3.5 5 6v5.5c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6z',
  calendar: 'M5.5 5.5h13A1.5 1.5 0 0 1 20 7v11.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5V7a1.5 1.5 0 0 1 1.5-1.5zM4 10h16M8.5 3.5v4M15.5 3.5v4M12 14.5h.01',
  flag: 'M6 20.5v-16M6 5h11l-2.5 4 2.5 4H6',
  sparkle: 'M12 4c.5 4.5 3.5 7.5 8 8-4.5.5-7.5 3.5-8 8-.5-4.5-3.5-7.5-8-8 4.5-.5 7.5-3.5 8-8z',
  target: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM12 12h.01',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, class: className }: { name: IconName; size?: number; class?: string }) {
  return (
    <svg
      class={`icon ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={name === 'grip' ? 2.6 : 1.8}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
      {name === 'settings' && (
        <>
          <circle cx="15" cy="7" r="2" />
          <circle cx="9" cy="17" r="2" />
        </>
      )}
    </svg>
  );
}
