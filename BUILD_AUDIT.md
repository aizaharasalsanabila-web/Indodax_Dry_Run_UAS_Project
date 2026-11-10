# Build audit — 10 November 2026

## What was created

- Vercel serverless endpoints: `api/tick.js`, `api/status.js`, `api/control.js`, `api/export.js`.
- Public Indodax client for server time, pairs, price increments, 4h history, and order book.
- One shared signal engine used by historical replay and live dry-run.
- Order-book sweep fill model (ask for buy, bid for sell), fee/minimum/tick/quantity handling, and raw snapshot logging.
- Redis-backed persistent state, per-candle idempotency, daily loss limit, and manual kill switch.
- 4h historical data downloader, initial-period liquidity check, measured-cost backtest, forward log export, same-window replay/comparison, and offline HTML dashboard.
- GitHub Actions scheduler workflow for 4h ticks.
- Extracted UTS README and original `engine_uts.cjs` retained under `reference/`; the 9.5 MB single-file audit bundle is not required by the runtime project and remains a separate prior artifact.

## Offline tests

- Node syntax checks passed for runtime, API, scripts, and original UTS reference JS.
- `npm test`: 8 tests passed, 0 failed.
- `npm run dashboard:build`: offline dashboard generated.
- Static security scan: no private Indodax trading/withdrawal endpoint and no Indodax API key use in runtime code.

## Not completed (do not claim as completed)

- No real Indodax historical 4h download was run in this environment.
- No real order-book snapshots were captured in this environment.
- No measured-cost 3-year backtest has been run.
- No Vercel deployment or Redis connection has been completed.
- No successful forward tick or forward-test log exists yet.
- No UAS freeze commit exists yet. The local Git history currently contains project-scaffold commits only; `npm run freeze:record` creates a truthful late-freeze commit after data, universe, snapshots, and backtest prerequisites exist.

The user's uploaded market archive includes daily and 12h Indodax aggregates; its accompanying data README describes the hourly archive as a separate ZIP, which was not supplied. This project therefore includes a public-API 4h downloader rather than pretending the missing hourly archive was present.
