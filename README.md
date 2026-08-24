# Pocket Finances

A shared finance tracker for two people, built as an installable web app (PWA). All data
lives on your two phones — there is no server, no cloud account, and the app works fully
offline. The two phones stay in sync by handing a small file directly between them — either
through Android's **Nearby Share**, or by showing each other QR codes as a fallback that works
everywhere.

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

### The fast way: Share with partner

On phones where it's available (most recent Android + Chrome), the Sync tab leads with a
**Share with partner** button. Tap it, pick **Nearby Share** in the sheet that opens, and pick
your partner's phone — the data goes straight across over Bluetooth/Wi-Fi, no camera needed.
If Pocket Finances is open on their phone (or installed), it merges automatically; otherwise
the file lands in their Downloads and they can pull it in from Settings → **Import / restore
backup**. Send it back the same way (tap **Share with partner** again) to complete the round
trip.

### The fallback: QR codes

Works on any two phones, no OS features required. Sit together, then on the Sync tab:

1. Phone 1 taps **Show my data** — it displays a looping sequence of QR codes.
2. Phone 2 taps **Scan partner's screen** and points its camera at Phone 1. A progress strip
   fills in (codes can arrive in any order; missed ones come around again).
3. When it completes, Phone 2 merges the data and automatically shows the combined result —
   Phone 1 now taps **Scan partner's screen** and scans it back.
4. Both phones display a 6-character **check code**. If they match, you're identical.

Either way, syncing is safe to repeat any time; running it twice changes nothing. Balance
histories from both phones are combined, and for anything edited on both (account names etc.)
the most recent edit wins.

First sync on a phone: Chrome will ask for camera permission if you use QR (only used to read
the codes) or for Nearby Share access if you use Share — nothing leaves your two phones either
way.

### Fixing swapped account owners

Important: only **one** phone should "Set up on this phone first"; the second should use
**"Join your partner's setup"** on the first-run screen. If both phones were set up
independently (as in early versions), each recorded the partner names in the opposite order,
and the first sync makes account owners look swapped. To repair: on whichever phone shows the
correct picture, re-save the two names in Settings and fix the owner on any wrong account
(Accounts → tap the account → Whose is it?), then run a normal sync — the newest edits win on
both phones.

### Real-device checklist (after any change to sync)

QR:
- [ ] Show on phone A, scan on phone B in normal indoor light
- [ ] Cover the screen mid-scan; confirm missing pieces fill in on the next loop
- [ ] Check codes match on both phones afterwards
- [ ] If scanning struggles, lower the code speed on the showing phone

Share with partner (Nearby Share):
- [ ] "Share with partner" button appears on both phones (needs a fairly recent Chrome/Android)
- [ ] Tapping it opens the OS share sheet with Nearby Share as an option
- [ ] With Pocket Finances already open on the receiving phone, the merge happens automatically
      and lands on the "Now show this back" screen
- [ ] With Pocket Finances closed on the receiving phone, opening it from the Nearby Share
      notification launches the app straight to the merged Sync screen
- [ ] If Nearby Share saves to Downloads instead of opening the app, confirm Settings →
      Import / restore backup picks the file up correctly

## Backups

Settings → **Export backup file** saves everything as a single JSON file — stash it in your
password manager or drive of choice occasionally. **Import / restore backup** merges it back
(also useful for moving to a new phone).

## One-time repository setup (deployment)

The app deploys to GitHub Pages automatically on every push to `main` via
`.github/workflows/deploy.yml`. One manual step is needed once:
**repo Settings → Pages → Source → "GitHub Actions"**.

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
`BarcodeDetector` (with `jsqr` fallback) for scanning, `vite-plugin-pwa` (`injectManifest`
strategy) for the service worker. Money is stored as integer pence; sync is a full-state
exchange merged with last-write-wins per record plus append-only unions — commutative and
idempotent, which is what makes the two-pass flow converge whichever transport carries it
(see `src/logic/merge.ts`).

The service worker (`src/sw.ts`) is hand-written rather than generated, because it also
implements the Web Share Target receiver: a static site has no server to receive the POST a
Nearby Share hand-off makes, so the service worker's `fetch` handler catches it, stashes the
file in IndexedDB, and redirects into the app — see `manifest.share_target` in
`vite.config.ts` and the pending-share check in `src/ui/Sync.tsx`. It's typechecked separately
(`tsconfig.sw.json`, both configs run by `npm run build`) since a service worker's global
scope needs different lib types than the app.
