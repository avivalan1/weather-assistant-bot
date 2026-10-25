# Telegram Weather & Air-Quality Assistant

A TypeScript Telegram bot that answers `/weather <city>` and `/air <city>` using the free
[Open-Meteo](https://open-meteo.com/) APIs. Detailed design rationale is in
[docs/DESIGN.md](docs/DESIGN.md).

## Setup

Requires **Node.js ≥ 22.9**.

```bash
npm install
cp .env.example .env    # add BOT_TOKEN from @BotFather; other settings are optional
```

## Run & test

```bash
npm run dev                  # watch mode, pretty logs
npm run build && npm start   # compiled, JSON logs
npm test                     # offline test suite
npm run check                # typecheck + lint + tests
```

Commands: `/weather <city>`, `/air <city>`, `/help`. Cities can be multi-word (`New York`) and
narrowed after a comma: `Paris, TX`, `Istanbul, Turkey`, `London, Ontario`.

## Architecture

```
src/
├── index.ts     composition root: config → clients → services → bot → long polling
├── bot/         Telegram layer (grammY): routing, handlers, reply formatting, error messages
├── services/    application logic: location resolution, weather, air quality, suggestion rules
├── clients/     Open-Meteo HTTP clients: timeouts, retries, rate limiting, zod validation
└── lib/         TTL cache
```

Dependencies point one way: `bot → services → clients`. Collaborators are injected through
constructors, so tests run the real stack with Open-Meteo and Telegram faked at the HTTP level.

## Key decisions & tradeoffs

- **Ambiguous locations:** the API's top-ranked match (largely by population) is used, and the
  reply always shows the resolved place plus other same-named matches. A comma narrows the
  search by region, US state code or country name, and a code like `CA` accepts both Canada and
  California. If nothing fits, the reply lists what does exist.
  [Details](docs/DESIGN.md#ambiguous-locations).
- **Failures never stop the service.** 3 s per HTTP attempt, one retry for transient errors, and
  an 8 s limit on how long each user waits (per user, even when requests are shared). Every failure becomes a specific reply. A fatal polling error
  (second instance, revoked token) exits with code 1.
- **Caching:** successful results only, 5 minutes, separate per data type and location.
  Concurrent identical requests share one call.
- **Rate limits:** a client-side limiter for Open-Meteo's free tier (600/min, 5k/h, 10k/day).
- **AQI:** European AQI for European countries, US AQI elsewhere. CAMS values are labelled as
  model estimates, and the rest-of-day peak as a forecast.
- **Suggestion:** ordered rules (safety first) over the rest of the local day, worded for night
  once today's sunset has passed.
- **Long polling** with `@grammyjs/runner` (concurrent across chats), because the bot runs
  locally. Webhooks would only change `index.ts`.
- **Secrets:** token from the environment only, and masked in every log line. Telegram puts it
  in request URLs, which caused a real leak during testing (now fixed and regression-tested).

## Tests

161 offline tests (`npm test`, ~2 s). They cover both commands end to end through real grammY,
missing arguments, invalid input, unknown cities, the suggestion rules, API failures
(5xx/429/timeouts/malformed data), cache expiry with a fake clock, the time budget, config
defaults, and the polling lifecycle (exit codes, no token in output) against the real runner.
Location tests run about 30 everyday spellings against **real geocoding responses** captured in
`test/fixtures/`.

## Limitations

How each could be addressed is in [docs/FUTURE.md](docs/FUTURE.md).

- In-memory cache and rate limiter: reset on restart, not shared across instances.
- No per-user throttling, so one user can use up the shared quota.
- Ambiguity is resolved automatically; there's no "Which Paris?" button.
- Qualifiers filter only the top 10 geocoding results. State codes are US-only.
- Narrowing stops at state level: two same-named places in one state (e.g. the two villages
  called Amsterdam in Ohio) can't be told apart; the top-ranked one is used.
- English only. City names with digits are rejected; non-Latin names the geocoder doesn't know
  (e.g. Hebrew) return "not found".
- Old or alternative city names can resolve to small places with no warning: the geocoder
  returns a one-person village for "Kiev" and a place in New York state for "Bombay" ("Kyiv" and
  "Mumbai" work). The reply always names the resolved place.

## How I used the coding assistant

I built this with **Claude Code**, keeping every design decision with me:

- **Options first, then code.** For each choice (framework, transport, validation, caching,
  ambiguity, AQI standard, retries, concurrency, reply format, tests) the assistant laid out the
  tradeoffs and I decided.
- **Verified against reality.** Schemas were written from live Open-Meteo responses, and I
  tested with a real Telegram bot. That exposed a token leak in library logging and a flaky
  network, which led to the current retry policy.
- **Independent reviews.** Three separate review sessions examined the code cold. I reproduced
  each finding (live data, a local HTTP server, a second bot instance) before fixing it, and gave
  each fix a regression test that I checked fails when the bug is put back. One review showed
  that an earlier version of this README overstated that: three fixes had no test. They do now.
  The checks also caught three of my own tests that passed with or without the fix. The full list
  is in [docs/DESIGN.md](docs/DESIGN.md#review-log).
- **Gates:** strict TypeScript and `typescript-eslint` `strictTypeChecked`, with no `any`, type
  casts, non-null assertions or suppressions anywhere.
