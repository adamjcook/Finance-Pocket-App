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
  /** Stretch to the full width of its container. */
  wide?: boolean;
  ariaLabel?: string;
}

/** Decimal money field: numeric keyboard, pence-accurate parsing, invalid highlight. */
export function MoneyInput({ initial, onChange, onEnter, autoFocus, placeholder, symbol = '£', inputRef, wide, ariaLabel }: Props) {
  const [text, setText] = useState(initial === null ? '' : minorToInput(initial));
  const invalid = text.trim() !== '' && parseMoney(text) === null;
  return (
    <span class={`money-input ${wide ? 'wide' : ''}`}>
      <span class="prefix">{symbol}</span>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        enterkeyhint={onEnter ? 'next' : 'done'}
        autofocus={autoFocus}
        placeholder={placeholder ?? '0.00'}
        aria-label={ariaLabel}
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
