# SockOdds API notes (v1)

Everything this server relies on, taken only from the public SockOdds API v1 contract and docs:
the OpenAPI contract at https://sockodds.com/openapi.json and the guides under https://sockodds.com/docs/ .
Written for sockodds-mcp 1.1.0 against SockOdds API 1.0.0. If the contract changes, these notes and the
fixtures may need updating.

Every docs page is also served as Markdown: add `.md` to the page path, for example
`https://sockodds.com/docs/quickstart.md`.

## Basics

| What | Value | Source |
| --- | --- | --- |
| Base URL | `https://api.sockodds.com/v1` | https://sockodds.com/docs/ |
| Auth | `Authorization: Bearer <key>` only. A key in the query string or any other header is ignored and the request fails with 401. | https://sockodds.com/docs/authentication/ |
| Envelope | `{ data, meta: { count, cursor }, links: { next } }` | https://sockodds.com/docs/quickstart/ |
| Errors | `application/problem+json`: `{ type, title, status, detail, instance }` | https://sockodds.com/docs/errors/ |
| Paging | Follow `links.next` unchanged until it is null. `limit` 1 to 100, default 25. | https://sockodds.com/docs/pagination/ |
| Times | UTC, ISO 8601 ending in `Z`. Offsets such as `+10:00` are refused. | https://sockodds.com/docs/errors/ |
| Prices | Decimal only (`decimal_odds`), exactly as the bookmaker showed them. A price not seen for ten minutes is withheld from current responses. | https://sockodds.com/docs/odds/ |

## Endpoints used

### GET /v1/leagues (tool: list_leagues)

- Query: `sport` (optional sport key, such as `rugby_league`), `limit` (this server sends 100).
- League fields read: `key`, `name`, `sport`, `region`.
- The response does not say whether the key's plan covers a league. A league outside the plan answers
  403 `Plan restriction` when it is asked for.

### GET /v1/events (tool: find_event)

| Parameter | Why |
| --- | --- |
| `league` | One league key, to keep the search small |
| `starts_after` | Six hours ago, so games in progress are still found |
| `starts_before` | `days_ahead` days from now |
| `limit` | 25 with a league, 50 without (at most 100) |

Event fields read: `id`, `name` (home side first in team sports), `league.key`, `league.name`,
`scheduled_start`, `status` (`scheduled`, `live`, `final`, `postponed`, `cancelled`), and
`participants[].role` and `participants[].identity.name` / `.key` for matching team names. Finished and
cancelled events are left out of the answer. `links.next` set means more events matched than were fetched.

### GET /v1/events/{event_id}/odds (tools: get_odds, best_price, fair_odds)

| Parameter | Used by | Why |
| --- | --- | --- |
| `markets` | get_odds (unless `all_markets`), best_price (with `market`), fair_odds | Only the market keys shown, so fewer objects are used |
| `bookmakers` | get_odds (optional) | Comma separated bookmaker keys, at most 20 |

The API groups prices by market by default: `markets[]`, each with `id`, `key`, `name`, `period`, `subject`,
`alternate` and `outcomes[]`; each outcome has `id`, `name`, `side`, `line` and `prices[]`, each price
`bookmaker`, `decimal_odds`, `implied_probability`, `available` and `observed_at`. With `group_by=bookmaker`
it sends `bookmakers[]` instead, each with its own `markets[]`. The client accepts either and turns the
market grouping into the bookmaker grouping the tools read (`src/odds-shape.ts`), price for price.

Fields read: the event fields above, then `bookmakers[].key` and `.name`; each market's `id`, `key`,
`name`, `subject`, `period`; each outcome's `id`, `name`, `side`, `line`, `decimal_odds`, `available`,
`bookmaker` and `observed_at`.

### GET /v1/bookmakers (only with the market grouping)

Prices name bookmakers by key, so the first market-grouped answer reads `/v1/bookmakers?limit=100` once
for display names. It counts one object per bookmaker listed, and that answer's usage line includes them.
If the read fails, keys stand in for names.

Markets are lined up across bookmakers by market key, subject and period, and each side by the outcome's
`side`. The market `id` includes the line, so it is not used to group lines together; an outcome `id` is
the same at every bookmaker for one market, line and side, which is what `best_price` takes as `outcome_id`.

### Market keys for the main markets

From the market catalogue (https://sockodds.com/docs/markets/). Main markets are whole-event markets
(`subject` null) in period `full`, else `regulation`.

| Tool name | v1 market keys | Sides |
| --- | --- | --- |
| `h2h` | `winner` | home, away (competitor_1, competitor_2 in tennis and UFC) |
| `h2h_3way` | `result` | home, draw, away |
| `line` | `handicap` | home, away; each outcome carries its own line (home -6.5 pairs with away 6.5) |
| `total` | `total_points`, `total_goals`, `total_runs`, `total_games`, `total_rounds`, `total_maps` (first priced wins) | over, under at the same line |

## Errors and limits

Source: https://sockodds.com/docs/errors/ and https://sockodds.com/docs/limits/

| Status | Title | What this server does |
| --- | --- | --- |
| 400 | `Invalid request` | Shows the detail; retrying unchanged will not help |
| 401 | `Unauthorised` | Says the key was rejected and links to signup |
| 401 | `Access changed` | Asks for the active key |
| 403 | `Plan restriction` | Names what the free plan covers and links to pricing |
| 404 | `Not found` | Points to find_event for a current ev_ ID; a 404 with no problem body points at SOCKODDS_BASE_URL |
| 410 | (retired API) | Says the address is retired and to use `https://api.sockodds.com/v1` |
| 429 | `Rate limit reached` (with `Retry-After`) | Explains the limit, does not retry, and refuses further calls locally until Retry-After passes |
| 429 | `Monthly allowance reached` (no `Retry-After`) | Says retrying will not help until the next UTC month |
| 503 | `Service unavailable` | Asks to try again shortly; does not retry |

This server never retries on its own, so a person never spends allowance without asking.

Usage is counted in objects: each record in `data` is one, and each priced outcome inside an odds
response is one more. Catalogue lists count one object per record.

## Free plan (Developer), as stated publicly

From https://sockodds.com/pricing/ and https://sockodds.com/docs/limits/ :

- Free, no card required
- 2,500 objects a month (reset each UTC calendar month)
- 10 requests a minute
- Leagues: MLB, NFL, AFL, NRL, Rugby League World Cup, Rugby League World Cup Women's
- Bookmakers: Sportsbet, TAB, Ladbrokes. Others are left out of responses rather than refused.

## Not used

- `/v1/odds/history`, `/v1/history/files`, `snapshots=` and `/v1/stream/odds` are Pro only, so there is
  no line movement tool.
- `/v1/odds` (many events with prices) costs an object per priced outcome, so `find_event` reads
  `/v1/events` and the odds tools read one event at a time.
- `/v1/results`, `/v1/events/lookup`, `/v1/teams`, `/v1/players` and `/v1/markets`.

## Not verified without a key

- Live response bodies. Every fixture is either copied from the recorded samples on the docs pages
  (`fixtures/docs/`) or invented in the documented shape (`fixtures/demo/`).
- Whether `/v1/leagues` lists only the leagues in the key's plan.
- The exact `detail` text of a 429; `fixtures/docs/error-429*.json` are built from the documented titles.
