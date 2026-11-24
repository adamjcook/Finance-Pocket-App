import { LEGACY_PARTNER_COLORS, OWNER_COLOR_SHADES } from '../model/types';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Dark- and light-mode shades for a saved partner colour. Older saves hold
 * the previous palette (teal/amber) and map onto its replacement; anything
 * unexpected — or not valid CSS, e.g. synced from another app version —
 * falls back to `fallback`.
 */
export function ownerShades(value: string | undefined, fallback: string): { dark: string; light: string } {
  const hex = value && HEX_COLOR.test(value) ? value.toLowerCase() : fallback;
  const current = LEGACY_PARTNER_COLORS[hex] ?? hex;
  return OWNER_COLOR_SHADES[current] ?? { dark: current, light: `color-mix(in srgb, ${current} 70%, black)` };
}
