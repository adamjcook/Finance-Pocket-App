import { describe, expect, it } from 'vitest';
import { ownerShades } from '../src/logic/ownerColors';
import { DEFAULT_PARTNER_A_COLOR, DEFAULT_PARTNER_B_COLOR } from '../src/model/types';

describe('ownerShades', () => {
  it('gives blue and pink their own light-mode shades', () => {
    expect(ownerShades(DEFAULT_PARTNER_A_COLOR, DEFAULT_PARTNER_A_COLOR)).toEqual({ dark: '#6ea8fe', light: '#2563eb' });
    expect(ownerShades(DEFAULT_PARTNER_B_COLOR, DEFAULT_PARTNER_A_COLOR)).toEqual({ dark: '#f28dc0', light: '#c2307a' });
  });

  it('maps the old teal/amber saves onto blue/pink, keeping who is who', () => {
    expect(ownerShades('#4fd1a5', DEFAULT_PARTNER_B_COLOR).dark).toBe('#6ea8fe'); // teal → blue
    expect(ownerShades('#F2A65A', DEFAULT_PARTNER_A_COLOR).dark).toBe('#f28dc0'); // amber → pink
  });

  it('falls back for missing or invalid values', () => {
    expect(ownerShades(undefined, DEFAULT_PARTNER_B_COLOR).dark).toBe('#f28dc0');
    expect(ownerShades('red; background: url(x)', DEFAULT_PARTNER_A_COLOR).dark).toBe('#6ea8fe');
  });
});
