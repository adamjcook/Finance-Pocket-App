import type { Settings } from '../model/types';

/**
 * The two names as this phone sees them, so copy can say "Sam" rather than
 * "your partner". Null on a phone that hasn't said whose it is (Settings ›
 * You two); callers fall back to "your partner" there.
 */
export function partnerName(settings: Settings, me: 'A' | 'B' | null | undefined): string | null {
  return me === 'A' ? settings.partnerBName : me === 'B' ? settings.partnerAName : null;
}

export function myName(settings: Settings, me: 'A' | 'B' | null | undefined): string | null {
  return me === 'A' ? settings.partnerAName : me === 'B' ? settings.partnerBName : null;
}
