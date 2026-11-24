import { useState } from 'preact/hooks';
import { minorToInput, parseMoney } from '../../logic/money';

interface Props {
  /** Initial value in minor units, or null for empty. */
  initial: number | null;
  /**
   * Called on every change with the parsed value (null = empty or invalid)
   * and whether the text is an invalid amount (as opposed to just empty).
   */
  onChange: (minor: number | null, invalid: boolean) => void;
  onEnter?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
  symbol?: string;
  inputRef?: (el: HTMLInputElement | null) => void;
  /** Stretch to the full width of its container. */
  wide?: boolean;
  ariaLabel?: string;
  /** id of the element that explains the current value (e.g. an error). */
  describedBy?: string;
}

/**
 * Decimal money field: numeric keyboard, pence-accurate parsing, invalid
 * highlight. Tapping in selects the whole figure, so typing replaces the old
 * balance instead of adding digits to it ("900" → "5900").
 */
export function MoneyInput({
  initial,
  onChange,
  onEnter,
  autoFocus,
  placeholder,
  symbol = '£',
  inputRef,
  wide,
  ariaLabel,
  describedBy,
}: Props) {
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
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={text}
        class={invalid ? 'invalid' : ''}
        onFocus={(e) => {
          const el = e.currentTarget as HTMLInputElement;
          // After the tap has placed the caret, or Android undoes the selection.
          requestAnimationFrame(() => {
            if (document.activeElement === el) el.select();
          });
        }}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          setText(v);
          const parsed = v.trim() === '' ? null : parseMoney(v);
          onChange(parsed, v.trim() !== '' && parsed === null);
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
