# FinPair

A shared finance tracker for two people, built as an installable web app (PWA). All data
lives on your two phones — there is no server, no cloud account, and the app works fully
offline. The two phones stay in sync by literally showing each other QR codes.

**What it tracks**

- Progress towards erasing your combined credit-card debt (progress ring + trend chart,
  measured against your peak recorded debt or a starting figure you set).
- Combined savings & investments growth, with a 30-day delta.
- Any other accounts (current accounts etc.) you want to keep an eye on.

**Built for how you actually bank**

- *Fast balance updates*: one screen lists every account with its current figure — type the
  new ones, hit save. Or tap any balance in the accounts list to edit it inline.
- *Aliases for bank-switchers*: create an alias like "Main Savings" and point it at whichever
  real account currently plays that role. When you switch banks, add the new account and
  re-point the alias — its history and chart carry straight on, and the old account is archived.
- *Mistake-proof*: balances are an append-only history; a mistyped entry can be undone from
  Settings without losing anything.

## Getting it on your phones

1. Open **https://adamjcook.github.io/Finance-Pocket-App/** in Chrome on each phone.
2. Chrome menu (⋮) → **Add to Home screen** → **Install**.
3. Run the setup (names + currency) on one phone, add your accounts, then sync the second
   phone from it — the setup carries over.

## Syncing the two phones

Sit together. On the Sync tab:

1. Phone 1 taps **Show my data** — it displays a looping sequence of QR codes.
2. Phone 2 taps **Scan partner's screen** and points its camera at Phone 1. A progress strip
   fills in (codes can arrive in any order; missed ones come around again).
3. When it completes, Phone 2 merges the data and automatically shows the combined result —
   Phone 1 now taps **Scan partner's screen** and scans it back.
4. Both phones display a 6-character **check code**. If they match, you're identical.

Syncing is safe to repeat any time; running it twice changes nothing. Balance histories from
both phones are combined, and for anything edited on both (account names etc.) the most
recent edit wins.

First sync on a phone: Chrome will ask for camera permission — allow it (the camera is only
used to read the QR codes; nothing leaves the phone).

### Fixing swapped account owners

Important: only **one** phone should "Set up on this phone first"; the second should use
**"Join your partner's setup"** on the first-run screen. If both phones were set up
independently (as in early versions), each recorded the partner names in the opposite order,
and the first sync makes account owners look swapped. To repair: on whichever phone shows the
correct picture, re-save the two names in Settings and fix the owner on any wrong account
(Accounts → tap the account → Whose is it?), then run a normal sync — the newest edits win on
both phones.

### Real-device checklist (after any change to sync)

- [ ] Show on phone A, scan on phone B in normal indoor light
- [ ] Cover the screen mid-scan; confirm missing pieces fill in on the next loop
- [ ] Check codes match on both phones afterwards
- [ ] If scanning struggles, lower the code speed on the showing phone

## Backups

Settings → **Export backup file** saves everything as a single JSON file — stash it in your
password manager or drive of choice occasionally. **Import / restore backup** merges it back
(also useful for moving to a new phone).

## One-time repository setup (deployment)

The app deploys to GitHub Pages automatically on every push to `main` via
`.github/workflows/deploy.yml`. One manual step is needed once:
**repo Settings → Pages → Source → "GitHub Actions"**.

## Dev environment

A separate repo, **[Finance-Pocket-App-dev](https://github.com/adamjcook/Finance-Pocket-App-dev)**,
deploys a mock-data copy at **https://adamjcook.github.io/Finance-Pocket-App-dev/**,
installable on your phone just like the real app, alongside it. It's safe to
poke at freely:

- **Separate storage.** It uses its own IndexedDB database (`finance-pocket-dev`
  vs. the real app's `finance-pocket`) — even though it shares the same GitHub
  Pages origin (`adamjcook.github.io`), it can never read or write your real
  accounts/balances.
- **Installs as a genuinely separate app.** It's a *sibling* GitHub Pages site
  (`.../Finance-Pocket-App-dev/`), not a `/dev/` sub-path of the real app's own
  URL — a PWA's `scope` covers its whole sub-tree, so nesting it under the real
  app's path made Chrome treat any visit to it as already covered by the real
  app's install ("already installed, open instead") instead of offering a
  separate one. Sibling top-level paths don't have that problem.
- **A yellow "DEV BUILD" banner** is pinned to the top of every screen so it's
  never mistaken for the real thing, and the installed icon is named "FinPair
  Dev".
- **Mock data on tap.** The first-run screen has a **Load mock data** button
  (only present in this build) that seeds a few realistic accounts and months
  of history via the same import path the two-device sync uses — no manual
  setup needed.

To work on it: branch from `develop` in *this* repo (or merge `main` into it),
push. The other repo's workflow has no source of its own — it checks out this
repo's `develop` branch, builds it, and deploys; it runs on a ~20-minute
schedule plus `workflow_dispatch` for an on-demand refresh, since a plain
`git push` can't trigger a workflow in a different repository. `main` and the
real production deployment are completely untouched either way. Locally,
`npm run build:dev` (or `npm run dev`, which is isolated automatically by
running on `localhost`) builds the same mock-data variant; see
`.env.dev-pages` for what it changes.

## Development

```
npm install
npm run dev        # local dev server
npm test           # unit tests (merge/codec/progress logic)
npm run build      # typecheck + production build (required before e2e)
npm run test:e2e   # Playwright: smoke, two-device sync, alias continuity
npm run preview    # serve the production build locally
```

Stack: Vite + TypeScript + Preact, IndexedDB via `idb`, `qrcode` for generation, native
`BarcodeDetector` (with `jsqr` fallback) for scanning, `vite-plugin-pwa` for the service
worker. Money is stored as integer pence; sync is a full-state exchange merged with
last-write-wins per record plus append-only unions — commutative and idempotent, which is
what makes the two-pass QR flow converge (see `src/logic/merge.ts`).
