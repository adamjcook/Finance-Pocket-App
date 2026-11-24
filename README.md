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

- *Fast balance updates*: on the Accounts page, tap **Update** (or any balance) and every
  account becomes an input — type the new figures for what's changed, hit save.
- *Aliases for bank-switchers*: create an alias like "Main Savings" and point it at whichever
  real account currently plays that role. When you switch banks, add the new account and
  re-point the alias — its history and chart carry straight on, and the old account is archived.
- *Goals on each account*: give a savings pot (say, the wedding fund) a target and date,
  or a card or loan a date to pay it off by; Home's Goals card shows the progress and the
  monthly amount each one takes.
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

A Cloudflare Worker builds `develop` on every push and serves a mock-data copy
at **https://finpair.mail-ajcook.workers.dev**, installable on your phone
alongside the real app. It's safe to poke at freely:

- **Completely separate from the real app.** It lives on a different domain
  (origin), so it can't read or write the real app's accounts/balances, and
  Chrome installs it as its own app rather than treating it as part of the
  real one.
- **A yellow "DEV BUILD" banner** is pinned to the top of every screen so it's
  never mistaken for the real thing, and the installed icon is named "FinPair
  Dev".
- **Mock data on tap.** The first-run screen has a **Load mock data** button
  (only present in this build) that seeds a few realistic accounts and months
  of history via the same import path the two-device sync uses — no manual
  setup needed.

To work on it: push to `develop` and the dev site updates within a minute or
two. `main` and the real production deployment (GitHub Pages) are untouched.

Cloudflare Worker `finpair` (Workers Builds): branch `develop`, build
command `npm run build:dev`, deploy command `npx wrangler deploy`. The output
directory and Worker name live in `wrangler.jsonc`; the Node version comes from
`.node-version`.

Locally,
`npm run build:dev` (or `npm run dev`, which is isolated automatically by
running on `localhost`) builds the same mock-data variant; see
`.env.dev-pages` for what it changes.

## Trading 212 link (optional)

Trading 212's API only gives the account's value *right now* — there's no
history endpoint — so a small Cloudflare Worker (`worker/`) records the total
of one Trading 212 account (Invest or Stocks ISA) at **9pm UK time every day**.
FinPair picks up any new days whenever it opens and adds them as normal balance
entries on the linked account, so the savings chart shows each day's move.
Home also shows that account's change on the day and its overall gain.

Privacy trade-off: one number a day (plus the cost basis and gain) is stored in
your own Cloudflare account. Nothing else about your finances leaves the phones.

**One-time setup**

1. **Trading 212 key.** In the Trading 212 app: Settings → API (Beta) →
   generate a key. Give it the **account data** permission only — no orders or
   trading — and leave IP restriction off (Cloudflare doesn't use fixed IPs).
   Keep the API key and secret to hand.
2. **Deploy the Worker.** Cloudflare dashboard → Workers & Pages → Create →
   Import a repository → this repo. Name it `finpair-t212`, set the **root
   directory** to `worker`, the branch to `develop` (switch to `main` later if
   you like), leave the build command empty and keep the deploy command
   `npx wrangler deploy`. The first deploy creates the KV store and the 9pm
   schedule from `worker/wrangler.jsonc`.
3. **Add three secrets.** Worker → Settings → Variables and Secrets → add, each
   as type *Secret*:
   - `T212_API_KEY` and `T212_API_SECRET` — from step 1
   - `FINPAIR_TOKEN` — any long random string (e.g. a generated password);
     the app sends it to prove it's yours
4. **Link it in FinPair.** Settings → Trading 212: choose the account, paste the
   Worker address (`https://finpair-t212.<your-subdomain>.workers.dev`) and the
   `FINPAIR_TOKEN`, then tap **Read now** to check it end to end. The
   link syncs to your partner's phone with the next sync.

The Worker only answers browser requests from the two FinPair sites listed in
`ALLOWED_ORIGINS` (and localhost). To use Trading 212's paper-trading account
instead, add a variable `T212_BASE_URL` = `https://demo.trading212.com`.

## Reminders (optional)

Phone notifications, sent by the same `finpair-t212` Worker (the app can't
run in the background, so it can't remind you itself):

- **9am on payday** (the last working day of the month, skipping weekends and
  UK bank holidays): time to update your balances.
- **0% deals:** 30, 7 and 1 days before (and on the day) a card's 0% deal ends —
  set the date on the card (Accounts → the card → "0% deal ends").
- **Trading 212 drops:** after the 9pm reading, if the linked account is down
  5% or more on the week (at most one alert a week).

No extra setup beyond the Trading 212 Worker: it creates its own push signing
keys on first use. On each phone, open the *installed* app → Settings →
Reminders → turn on "Notifications on this phone", allow notifications, and
tap "Send a test notification". Each phone picks its own reminders. Messages
are end-to-end encrypted to the phone; the Worker learns only the cards' names
and 0% end dates and the linked account's name.

## Development

```
npm install
npm run dev        # local dev server
npm test           # unit tests (merge/codec/progress logic, Trading 212 Worker + import)
npm run build      # typecheck + production build (required before e2e)
npm run test:e2e   # Playwright: smoke, two-device sync, alias continuity
npm run preview    # serve the production build locally
```

Stack: Vite + TypeScript + Preact, IndexedDB via `idb`, `qrcode` for generation, native
`BarcodeDetector` (with `jsqr` fallback) for scanning, `vite-plugin-pwa` for the service
worker. Money is stored as integer pence; sync is a full-state exchange merged with
last-write-wins per record plus append-only unions — commutative and idempotent, which is
what makes the two-pass QR flow converge (see `src/logic/merge.ts`).
