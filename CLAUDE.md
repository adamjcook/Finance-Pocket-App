# CLAUDE.md

## Branches and deploying

- **Always push to `develop` first.** `develop` builds the separate dev app ("FinPair Dev",
  https://finpair.mail-ajcook.workers.dev, mock data, yellow DEV BUILD banner), so changes can
  be tried on a phone before they reach the real app.
- **Never push to `main` unless asked.** `main` deploys the real app to GitHub Pages that the
  two of us use day to day. Changes reach it by merging `develop` into `main`
  ("Merge develop into main: …"), and only once the user says the dev build looks right.
- If working on another branch (e.g. a session branch), merge or fast-forward it into
  `develop` when done; don't leave work only on the side branch.

## Project context

- Product context: `PRODUCT.md`. Design work uses the Impeccable skill (`.claude/skills/impeccable`).
- Commands, stack and deployment details: `README.md`.
