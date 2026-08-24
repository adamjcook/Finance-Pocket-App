/** All amounts are integers in minor units (pence for GBP). */

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string): Intl.NumberFormat {
  let f = formatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat('en-GB', { style: 'currency', currency });
    formatters.set(currency, f);
  }
  return f;
}

export function formatMoney(minor: number, currency: string): string {
  return formatter(currency).format(minor / 100);
}

/** Compact form for chart labels: £1.2k, £340, £1.5m */
export function formatMoneyCompact(minor: number, currency: string): string {
  const major = minor / 100;
  const abs = Math.abs(major);
  const symbol = formatter(currency)
    .formatToParts(0)
    .find((p) => p.type === 'currency')?.value ?? '';
  const sign = major < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}${symbol}${trimZeros((abs / 1_000_000).toFixed(1))}m`;
  if (abs >= 10_000) return `${sign}${symbol}${trimZeros((abs / 1000).toFixed(0))}k`;
  if (abs >= 1_000) return `${sign}${symbol}${trimZeros((abs / 1000).toFixed(1))}k`;
  return `${sign}${symbol}${trimZeros(abs.toFixed(0))}`;
}

function trimZeros(s: string): string {
  return s.replace(/\.0$/, '');
}

/** Value for an editable input, e.g. 123456 -> "1234.56", 120000 -> "1200". */
export function minorToInput(minor: number): string {
  const s = (minor / 100).toFixed(2);
  return s.endsWith('.00') ? s.slice(0, -3) : s;
}

/**
 * Parse a user-typed amount ("1,234.56", "£1200", "-45.10") to minor units.
 * Returns null when the input is not a valid amount.
 */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[£$€\s,]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  if (!/^-?\d*(\.\d{0,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}
