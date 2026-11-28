import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { formatMoneyWhole } from '../../logic/money';
import { reducedMotion, spring } from '../motion';

interface Props {
  from: number;
  to: number;
  currency: string;
  /** Shows `from` until this turns true, then rolls to `to` once. */
  play: boolean;
  /** Extra wait (ms) after `play` before the first digit moves. */
  delay?: number;
}

const CELLS = 30; // 0–9 three times over, so a digit can roll past a full turn
const isDigit = (c: string) => c >= '0' && c <= '9';

type Cell =
  | { kind: 'digit'; place: number; start: number; end: number; enter: boolean; leave: boolean }
  | { kind: 'sep'; char: string; enter: boolean; leave: boolean }
  | { kind: 'fixed'; char: string };

/**
 * Lays both figures over one template (the one with more digits), so a
 * figure that gains or loses a place (£9,800 → £10,050) can grow or shrink
 * in place rather than jump. Returns null when the shapes can't share one
 * (a sign change, a different currency layout): those just swap.
 */
function plan(fromText: string, toText: string, up: boolean): { cells: Cell[]; top: number } | null {
  const fromDigits = [...fromText].filter(isDigit);
  const toDigits = [...toText].filter(isDigit);
  const prefix = (s: string) => s.slice(0, [...s].findIndex(isDigit));
  if (prefix(fromText) !== prefix(toText)) return null;
  const template = toDigits.length >= fromDigits.length ? toText : fromText;
  const at = (digits: string[], place: number) => {
    const d = digits[digits.length - 1 - place];
    return d === undefined ? null : Number(d);
  };
  const width = Math.max(fromDigits.length, toDigits.length);
  let top = -1;
  for (let p = 0; p < width; p++) if (at(fromDigits, p) !== at(toDigits, p)) top = p;

  const cells: Cell[] = [];
  let place = width;
  for (const c of template) {
    if (isDigit(c)) {
      place--;
      const old = at(fromDigits, place);
      const next = at(toDigits, place);
      const involved = place <= top;
      // A little extra spin in the low places reads as the count running.
      const turns = !involved ? 0 : place === 0 ? 2 : place === 1 ? 1 : 0;
      const a = old ?? 0;
      const b = next ?? 0;
      let start: number;
      let end: number;
      if (!involved) {
        start = end = up ? b : b + 20;
      } else if (up) {
        start = a;
        end = b + 10 * turns;
        if (end <= start && !(a === b && turns === 0)) end += 10;
      } else {
        start = a + 20;
        end = b + 20 - 10 * turns;
        if (end >= start && !(a === b && turns === 0)) end -= 10;
      }
      cells.push({ kind: 'digit', place, start, end, enter: old === null, leave: next === null });
    } else if (place < width && place > 0) {
      // A thousands separator exists while there's a digit to its left.
      cells.push({ kind: 'sep', char: c, enter: fromDigits.length <= place, leave: toDigits.length <= place });
    } else {
      cells.push({ kind: 'fixed', char: c });
    }
  }
  return { cells, top };
}

/**
 * A money figure that rolls to its new value digit by digit, like a
 * mechanical counter: higher places set off and settle first, the low places
 * spin longest and land last. Each digit rolls the way the money moved (up
 * for more, down for less) on the same spring as the ring and chart.
 * Screen readers get the final figure only; reduced motion shows it at once.
 */
export function Odometer({ from, to, currency, play, delay = 0 }: Props) {
  const root = useRef<HTMLSpanElement>(null);
  const finalText = formatMoneyWhole(to, currency);
  const layout = from === to ? null : plan(formatMoneyWhole(from, currency), finalText, to > from);
  const [landed, setLanded] = useState(() => reducedMotion() || !layout);

  useLayoutEffect(() => {
    if (!play || landed || !layout) return;
    const el = root.current;
    if (!el) return;
    const s = spring(140, 19);
    const cols = [...el.querySelectorAll<HTMLElement>('[data-cell]')];
    const anims: Animation[] = [];
    cols.forEach((col) => {
      const cell = layout.cells[Number(col.dataset.cell)];
      if (cell.kind === 'fixed') return;
      const lead = cell.kind === 'digit' ? Math.max(0, (layout.top - cell.place) * 55) : 0;
      const timing: KeyframeAnimationOptions = { duration: s.duration, delay: delay + lead, easing: s.easing, fill: 'both' };
      if (cell.enter || cell.leave) {
        // Places that appear or go: the column opens or closes around them.
        // scrollWidth: an entering column is still shut (width 0) at this point.
        const w = Math.max(col.getBoundingClientRect().width, col.scrollWidth);
        const shut = { width: '0px', opacity: 0 };
        const open = { width: `${w}px`, opacity: 1 };
        anims.push(col.animate(cell.enter ? [shut, open] : [open, shut], { ...timing, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }));
      }
      if (cell.kind === 'digit') {
        const strip = col.querySelector<HTMLElement>('.odo-strip')!;
        anims.push(
          strip.animate(
            [
              { transform: `translateY(${(-cell.start / CELLS) * 100}%)` },
              { transform: `translateY(${(-cell.end / CELLS) * 100}%)` },
            ],
            timing,
          ),
        );
      }
    });
    el.classList.add('rolling');
    let live = true;
    void Promise.all(anims.map((a) => a.finished)).then(
      () => {
        if (!live) return;
        setLanded(true);
      },
      () => {},
    );
    return () => {
      live = false;
      anims.forEach((a) => a.cancel());
    };
  }, [play]);

  if (landed || !layout) return <span class="odometer">{finalText}</span>;

  return (
    <span class="odometer" ref={root}>
      <span aria-hidden="true" class="odo-face">
        {layout.cells.map((cell, i) => {
          if (cell.kind === 'fixed') return <span class="odo-cell" key={i}>{cell.char}</span>;
          // Before it plays, a place that's still to come takes no room.
          const hidden = cell.enter ? 'width:0;opacity:0' : undefined;
          if (cell.kind === 'sep') {
            return (
              <span class="odo-cell odo-col" data-cell={i} key={i} style={hidden}>
                {cell.char}
              </span>
            );
          }
          return (
            <span class="odo-cell odo-col" data-cell={i} key={i} style={hidden}>
              {/* Sizes the column to one digit (tabular figures); the strip rolls over it. */}
              <span class="odo-sizer">0</span>
              <span class="odo-strip" style={`transform:translateY(${(-cell.start / CELLS) * 100}%)`}>
                {Array.from({ length: CELLS }, (_, k) => (
                  <span key={k}>{k % 10}</span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
      <span class="visually-hidden">{finalText}</span>
    </span>
  );
}
