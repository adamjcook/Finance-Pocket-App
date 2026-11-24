# finpair-t212

Cloudflare Worker that records a Trading 212 account's total value at 9pm UK
time every day and serves that history to the FinPair app. Deployed by
Cloudflare Workers Builds with this folder as the root directory.

Setup (Trading 212 key, deploy, secrets, linking the app): see
"Trading 212 link" in the main [README](../README.md).

Endpoints (all but `/` need `Authorization: Bearer <FINPAIR_TOKEN>`):

- `GET /` — health check
- `GET /days?since=YYYY-MM-DD` — stored readings on or after that day, plus the last run's status
- `POST /refresh` — take a reading now (provisional until 9pm)
