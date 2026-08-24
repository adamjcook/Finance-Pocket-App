import { useState } from 'preact/hooks';
import { minorToInput, parseMoney } from '../../logic/money';

interface Props {
  /** Initial value in minor units, or null for empty. */
  initial: number | null;
  /** Called on every change with the parsed value (null = invalid/empty). */
  onChange: (minor: number | null) => void;
  onEnter?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
  symbol?: string;
  inputRef?: (el: HTMLInputElement | null) => void;
}

/** Decimal money field: numeric keyboard, pence-accurate parsing, invalid highlight. */
export function MoneyInput({ initial, onChange, onEnter, autoFocus, placeholder, symbol = '£', inputRef }: Props) {
  const [text, setText] = useState(initial === null ? '' : minorToInput(initial));
  const invalid = text.trim() !== '' && parseMoney(text) === null;
  return (
    <span class="money-input">
      <span class="prefix">{symbol}</span>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        enterkeyhint={onEnter ? 'next' : 'done'}
        autofocus={autoFocus}
        placeholder={placeholder ?? '0.00'}
        value={text}
        class={invalid ? 'invalid' : ''}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          setText(v);
          onChange(v.trim() === '' ? null : parseMoney(v));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
      />
    </span>
  );
}

/** The currency symbol for MoneyInput, derived from the settings currency. */
export function currencySymbol(currency: string): string {
  return (
    new Intl.NumberFormat('en-GB', { style: 'currency', currency })
      .formatToParts(0)
      .find((p) => p.type === 'currency')?.value ?? currency
  );
}
