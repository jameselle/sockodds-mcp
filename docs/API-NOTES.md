# SockOdds API notes (v1)

Everything this server relies on, taken only from the public SockOdds API v1 contract and docs:
the OpenAPI contract at https://sockodds.com/openapi.json and the guides under https://sockodds.com/docs/ .
Written for sockodds-mcp 1.1.0 against SockOdds API 1.0.0, and extended for 1.2.0 and 1.3.0. If the contract changes, these notes and the
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

### GET /v1/opportunities/arbs (tool: find_arbs)

Source: https://sockodds.com/docs/opportunities/ . Pro and Business keys, and keys on the free Pro trial;
other keys get `403 Plan restriction`, which the tool turns into a pointer to the trial. Query: `league`,
`min_edge` (profit in percent), `limit` (up to 100) and `cursor`. Each page costs 10 credits however many
entries it holds; an empty answer costs nothing. The tool reads at most 3 pages and follows the cursor in
`links.next`. Each pair has `event` (`id`, `name`, `league`, `scheduled_start`), `market` (`key`, `name`,
`period`, `subject`), two `legs` (`side`, `line`, `bookmaker`, `bookmaker_name`, `decimal_odds`,
`observed_at`) and `profit_pct`.

The `bookmakers` filter takes at most 20 keys, and there are more Australian bookmakers than that, so the
tool does not use it. It reads `/v1/bookmakers?regions=au&limit=100` (free) and keeps a pair only when
every leg's `bookmaker` is in that list. `region: all` skips the list.

The pair names the event but not which team is home, so the tool reads `/v1/events` (free) once per league
shown, in a window of an hour either side of those events, and names each leg's team from `participants`.
If that read fails, the legs say Home and Away.

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
- 1,000 credits a month (reset each UTC calendar month); an odds call costs one credit per market returned
- 10 requests a minute
- Leagues: NFL, NBA, NBL, English Premier League, plus MLB, AFL and NRL in season
- Bookmakers: every bookmaker SockOdds delivers except bet365

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

## Routes added in 1.3.0

Sources: https://sockodds.com/openapi.json , https://sockodds.com/docs/opportunities/ ,
https://sockodds.com/docs/fair-odds/ , https://sockodds.com/docs/history/ , https://sockodds.com/docs/results/ ,
https://sockodds.com/docs/racing/ and https://sockodds.com/docs/plans-and-limits/ . A 403 on any of them is
turned into a plain plan message (`planNeeded` in `src/tools.ts`) that quotes the problem body's `detail`.

| Route | Tool | Plan and credits | Query this server sends |
| --- | --- | --- | --- |
| `GET /v1/opportunities/ev` | find_ev | Pro; 10 a page | `league`, `markets`, `min_edge`, `fair`, `limit=100`, `cursor` (at most 3 pages) |
| `GET /v1/opportunities/middles` | find_middles | Pro; 10 a page | `league`, `markets`, `min_edge`, `limit=100`, `cursor` |
| `GET /v1/opportunities/low-holds` | find_low_holds | Pro; 10 a page | `league`, `markets`, `max_hold`, `limit=100`, `cursor` |
| `GET /v1/moves` | line_moves | Pro; 10 a call | `league` (required), `window` (5 to 360, steps of 5), `min_books`, `steam`, `limit=100` |
| `GET /v1/events/{event_id}/closing` | closing_line | Pro; 10 a call | `markets`, `bookmakers`, `outcome_id` with `odds` |
| `GET /v1/events/{event_id}` | odds_history | free | none (for the start time, which ends the default window) |
| `GET /v1/odds/history` | odds_history | paid plans; 10 x markets x regions | `event_id`, `from`, `to` (at most 24 h apart), `markets`, `bookmakers`, `limit=1000`, `cursor` (at most 3 pages) |
| `GET /v1/results` | get_results | 1; 2 with a window | `event_id`, or `league` with `starts_after`, `starts_before`, `limit=25` |
| `GET /v1/racing/races` | list_races | paid plans; free | `code`, `country` (AUS unless asked), `starts_after` (30 min ago), `starts_before`, `limit=100` |
| `GET /v1/racing/races/{race_id}/odds` | race_odds | paid plans; 1 per region | `bookmakers` |
| `GET /v1/racing/arbs` | racing_arbs | Pro; 10 a call | `code`, `country`, `starts_before`, `commission`, `min_margin` (a fraction), `limit=50` |
| `GET /v1/racing/movers` | racing_movers | Pro; 10 a call | `code`, `country`, `starts_before`, `direction`, `min_change` (a fraction), `limit=50` |
| `GET /v1/racing/races/{race_id}/result` | race_result | paid plans; 1 | none |
| `GET /v1/racing/races/{race_id}/form` | race_form | paid plans; 1 | `limit` (starts per runner) |

The `bookmakers` filter takes at most 20 keys and some regions have more bookmakers, so the derived tools
read `/v1/bookmakers?regions=<region>` (free) and filter on those keys themselves, as `find_arbs` does.
`line_moves` keeps a move when any bookmaker in the region moved, and lists the others separately, because
steam and the median lines are computed by SockOdds over every bookmaker. `closing_line` and `odds_history`
filter the prices shown but leave SockOdds' fair closing price as it is.

The racing arbs, movers, result and form bodies are typed in the contract only as racing data, so the
fields read are the ones shown in the racing guide. `race_form` accepts `data` as either a list of runners
or an object with `runners`. Race ids are checked against the contract's pattern before any call.

Not wrapped: `/v1/odds` (many events at once), `/v1/stream/odds`, `/v1/fair-odds` and
`/v1/events/{event_id}/fair-odds` (fair_odds works the price out itself, at no credit cost),
`/v1/history/files`, `/v1/events/lookup`, the catalogue lists (`/sports`, `/markets`, `/teams`,
`/players`), and the racing meetings, card, history, results list, tote, runner form and connections
routes. `/v1/sgm` is not in the public contract.
