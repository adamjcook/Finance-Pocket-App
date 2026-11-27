# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Installable PWA, used almost entirely as a phone app from the Android home screen in Chrome. Mobile web, not native.)

## Users

Two people: the owner and their partner. FinPair is a private tool for this one couple and there are no plans to open it to anyone else. Both use it on their own phones, often sitting together. The copy can assume them: UK banking, pounds, a monthly payday, a shared debt to clear and shared savings to grow.

## Product Purpose

It gives the two of them one honest, shared picture of their money: how close they are to clearing their combined credit-card debt, how their savings and investments are growing, and where any other accounts stand. Success means both phones show the same numbers, updating them takes a minute, and the picture keeps them motivated month after month.

## Positioning

There's no server and no cloud account. All data lives on the two phones. They link by showing each other QR codes once; after that, if the couple's own Worker is set up, they keep each other up to date through it automatically, end-to-end encrypted (the Worker holds only a copy it can't read). QR sync remains for linking and as the fallback. The tool is built around how this couple actually banks: they switch banks for deals (aliases carry an account's history across the switch), they have 0% card deals with end dates, and they update everything around payday.

## Operating Context

- **Main ritual: the payday check-in.** Once a month, on payday — the working day before the last working day, when Monzo pays early from 4pm (a push reminder arrives at 4:30pm UK time), they open Accounts, tap **Update**, type in the balances that changed, and save. Then they look at Home: did debt go down, did savings go up?
- **Sync session:** they sit together. One phone shows a loop of QR codes and the other scans it, then they swap. Both phones then display a 6-character check code, and matching codes mean the phones are identical.
- **Between paydays:** occasional glances. A Trading 212 account updates itself daily through the Worker.
- **Reminders:** payday, 0% deals ending (30, 7 and 1 days before, and on the day), and a Trading 212 drop of 5% or more over a week.
- Offline-first. A typical session is short and one-handed on a phone.

## Capabilities and Constraints

- Accounts: credit cards, savings and investments, current accounts, and others. Each has an owner (who it belongs to is hidden in the list) and an optional goal: a target amount and date for savings, or a pay-off date for debt. Cards can have a 0% deal end date.
- Pensions and children's Junior ISAs are their own account types: each gets its own Accounts group and check-in line, and can have a goal. Neither counts in net worth: the pension can't be used yet, and the ISA is the child's money. On Home they share one compact "Held apart" card, a row per account (so another child adds a line, not a card), and each row opens the Held apart page with its chart and goal. Their milestones show in the check-in but don't make a month "nicely done"; pensions get 100 days before looking out of date.
- Balances are an append-only history stored as integer pence. Accounts shows balances as plain text, and they can only be edited through **Update**. A mistaken entry can be undone from Settings.
- Debt progress is measured against peak recorded debt or a starting figure they set (shown as a progress ring and a trend chart). Savings show a 30-day change. Charts can be scrubbed by sliding.
- Aliases: a stable name such as "Main Savings" points at whichever real account currently plays that role. Re-pointing an alias archives the old account.
- Sync is a full-state merge: last write wins per record, and histories are combined as append-only unions. Repeating a sync is safe.
- JSON backup export and import.
- Optional `finpair-t212` Cloudflare Worker: daily 9pm reading of one Trading 212 account, web-push reminders (including "your partner just updated"), and automatic sync between the phones, end-to-end encrypted with a key that only ever travels phone to phone in the QR codes. It's the only thing that leaves the phones.
- Dev build (`develop` branch, workers.dev) has a yellow "DEV BUILD" banner and mock data. Production is GitHub Pages from `main`.
- Stack: Vite, TypeScript, Preact, IndexedDB (`idb`), `qrcode` and `jsqr` (or BarcodeDetector), `vite-plugin-pwa`. Font: Figtree Variable (chosen Nov 2026, replacing Inter).
- Terminology in use: Home, Accounts, Update, Sync, Settings, Goals, alias, check code, "Show my data", "Scan partner's screen", "0% deal ends", "Whose is it?".

## Brand Commitments

- Name: the app is called **MC Bank** on the phones (the dev build is "MC Bank Dev"); the project and repository are still FinPair.
- Icon and logo: an interlocking **MC** monogram (Figtree, weight 350) inside a thin white ring on deep green `#2f5e48`, built from one source by `scripts/gen-monogram.py` (home-screen icons and the in-app logo). Inside the app the icon's green owns actions and "where you are" (main buttons, the selected tab, switches, focus, selection) and faintly tints the greys; teal and amber stay the data colours: growth and what's owed.
- Voice: plain British English, and **warmer** than the current copy. It's personal to the two of them, celebrates milestones (a card paid off, a goal reached, a new low in debt), and stays encouraging. It never preaches or shames about money, and it never says anything that would make one partner feel blamed.

## Evidence on Hand

- Real usage only: this couple's own accounts and history live on their phones. There's no testimonial, customer, or marketing material, and none should be invented.
- Mock data for the dev build: `src/dev/mockData.ts`.
- Starter quotes: `src/logic/wisdom.ts`.
- Screenshot script: `scripts/screenshots.mjs`.

## Product Principles

1. **One honest picture, shared.** Both phones must agree. Never show a number that could differ between them, and make agreement visible.
2. **The payday check-in is the hero flow.** Getting from opening the app to "updated, and here's how we did" should take as little friction as possible.
3. **Nothing leaves the phones** unless they opted in, and say plainly what does.
4. **Mistake-proof and calm.** History is append-only, undo is available, and errors are never frightening.
5. **Make progress feel good.** Debt going down and savings going up are worth celebrating together, warmly and without nagging.

## Accessibility & Inclusion

No specific requirements have been set. Existing practice to keep: ARIA labels on charts, rings, and inputs, and a per-phone theme: dark by default, with Light, or System to follow the phone's own setting.
