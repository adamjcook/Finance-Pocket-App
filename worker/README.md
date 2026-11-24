# finpair-t212

Cloudflare Worker that records a Trading 212 account's total value at 9pm UK
time every day, serves that history to the FinPair app, and sends the app's
reminder notifications. Deployed by
Cloudflare Workers Builds with this folder as the root directory.

Setup (Trading 212 key, deploy, secrets, linking the app): see
"Trading 212 link" in the main [README](../README.md).

Endpoints (all but `/` need `Authorization: Bearer <FINPAIR_TOKEN>`):

- `GET /` — health check; also shows which of the three secrets the running Worker can see (true/false, never values)
- `GET /days?since=YYYY-MM-DD` — stored readings on or after that day, plus the last run's status
- `POST /refresh` — take a reading now (provisional until 9pm)
- `GET /push/key` — the Worker's push public key (created on first use)
- `POST /push/subscribe` — register a phone for reminders: `{ subscription, prefs, promos, t212Name }`
- `POST /push/unsubscribe` — `{ endpoint }`
- `POST /push/test` — `{ endpoint }`: send that phone a test notification

Schedule (UTC crons, acting only on the matching UK hour): 9pm UK reading +
weekly drop check; 9am UK reminders (1st of the month, 0% deals ending).
