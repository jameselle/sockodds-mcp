# SockOdds API notes

Everything this server relies on, taken only from the public SockOdds website and docs.
Read on 6 October 2026. If the docs change, these notes and the fixtures may need updating.

The docs also serve Markdown copies of each page: add `.md` to the page path, for example
`https://sockodds.com/docs/basics/quickstart.md`.

## Basics

| What | Value | Source |
| --- | --- | --- |
| Base URL | `https://api.sockodds.com/v2` | https://sockodds.com/docs/reference/ and https://sockodds.com/docs/basics/cheat-sheet/ |
| Auth | `x-api-key: <key>` header (case-insensitive), or `?apiKey=`. This server only uses the header so the key stays out of URLs and logs. | https://sockodds.com/docs/reference/ , https://sockodds.com/docs/faq/ |
| Schema | SportsGameOdds v2 style: same paths, envelope and oddID grammar | https://sockodds.com/docs/ , https://sockodds.com/openapi.json |
| Envelope | `{ success, data, nextCursor, notice }`; errors are `{ success: false, error }` | https://sockodds.com/docs/basics/cheat-sheet/ |
| OpenAPI | https://sockodds.com/openapi.json | https://sockodds.com/docs/reference/ |

`notice` appears only when the key's plan filtered the response (league scope, bookmaker cap, fair odds).
Source: https://sockodds.com/docs/info/rate-limiting/

## Endpoints used

### GET /leagues/ (tool: list_leagues)

Doc: https://sockodds.com/docs/endpoints/getLeagues/

- Query: `sportID` (optional), `leagueID` (optional).
- Response: `{ success, data: League[], nextCursor }`.
- League fields read: `leagueID`, `sportID`, `name`, `shortName`, `enabled` (whether the key's plan can read it), `activeEvents`.
- The docs show no example body for this endpoint, so `fixtures/demo/leagues-demo.json` is built from the documented fields.

### GET /events/ (tools: find_event, get_odds, best_price, fair_odds)

Doc: https://sockodds.com/docs/endpoints/getEvents/ ; example response: https://sockodds.com/docs/basics/quickstart/

Query parameters this server sends:

| Parameter | Used by | Why |
| --- | --- | --- |
| `leagueID` | find_event | Keep the search to one league (each event returned counts as one object) |
| `oddsAvailable=true` | find_event | Only events with markets open now |
| `startsBefore` (ISO date) | find_event | Only events in the next `days_ahead` days |
| `oddID=points-home-game-ml-home` + `includeOpposingOdds=true` | find_event | Shrink the payload to the head to head only (pattern from the cheat sheet) |
| `limit` | find_event | Default 10, max 100 per the docs; this server uses 25 (50 with no league) |
| `eventID` | get_odds, best_price, fair_odds | One event. eventID overrides every other filter |
| `bookmakerID` | get_odds (optional) | Comma separated list, for example `sportsbet,tab` |

Without a date window or eventID, events that kicked off more than 24 hours ago are left out (SockOdds extension `includeFinished`).

Response: `{ success, data: Event[], nextCursor, notice? }`. Fields read:

- `Event.eventID`, `leagueID`, `sportID`
- `Event.teams.home|away.names.long|medium|short`, `teamID`
- `Event.status.startsAt`, `live`, and `Event.info.commenceTime`, `displayName`, `stale` (true when no source write for 45 minutes)
- `Event.odds[oddID]`: `oddID`, `statID`, `statEntityID`, `periodID`, `betTypeID`, `sideID`, `marketName`,
  `bookOdds` (consensus with margin, American string), `fairOdds` (sharp de-vigged consensus, American string or null),
  `bookSpread`, `bookOverUnder`, `fairSpread`, `fairOverUnder`
- `Event.odds[oddID].byBookmaker[bookmakerID]`: `odds` (American string), `decimal` (number), `available`,
  `lastUpdatedAt`, `spread`, `overUnder`, `expiresAt`, `carriedFrom`

Field reference: https://sockodds.com/docs/reference/ (Event, Odds, ByBookmakerOdds) and https://sockodds.com/docs/data-types/odds/

### oddID grammar

`{statID}-{statEntityID}-{periodID}-{betTypeID}-{sideID}`, for example `points-home-game-ml-home`.
Source: https://sockodds.com/docs/data-types/odds/

What this server treats as a "main market" (statID `points`, periodID `game`, else `reg`):

| Tool name | betTypeID | Sides | Source |
| --- | --- | --- | --- |
| `h2h` | `ml` | home, away | https://sockodds.com/docs/data-types/bet-types/ |
| `h2h_3way` | `ml3way` | home, away, draw (the combined sides such as `home+draw` are skipped) | same |
| `line` | `sp` | home, away; lines mirror (home -2.5 pairs with away +2.5) | https://sockodds.com/docs/info/consensus-odds/ |
| `total` | `ou` | over, under at the same total (statEntityID `all`) | same |

Periods: https://sockodds.com/docs/data-types/periods/

## Errors and limits

Source: https://sockodds.com/docs/info/errors/ and https://sockodds.com/docs/info/rate-limiting/

| Status | Body | What this server does |
| --- | --- | --- |
| 401 | `{"success":false,"error":"Invalid API key"}` | Says the key was rejected and links to signup |
| 403 | `{"success":false,"error":"Inactive API key"}` | Says the key is inactive, contact api@sockodds.com |
| 429 | `{"success":false,"error":"Rate limit exceeded"}` with `Retry-After` (seconds) | Explains the free limits, does not retry, and refuses further calls locally until Retry-After passes (rejected calls still count for the minute) |
| 400, 404, 5xx | `{ success: false, error }` | Shows the message; does not retry |

The docs suggest one retry on 500 and 503. This server does not retry at all, so a person never burns quota without asking.

Every response carries `x-ratelimit-limit` and `x-ratelimit-remaining` (fixed epoch minutes). Not read yet.

## Free tier (Developer plan), as stated publicly

From https://sockodds.com/pricing/ , https://sockodds.com/signup/ and https://sockodds.com/docs/faq/ :

- Free, no card required
- 2,500 objects per month (reset at the start of each UTC calendar month)
- 10 requests per minute
- About 2 minute update frequency
- 4 leagues: MLB, NFL, AFL and NRL
- 3 bookmakers: Sportsbet, TAB and Ladbrokes
- An object is a top-level item in a response: one event with all its markets and books is one object; ten events is ten objects

## Price history: why there is no explain_line_movement tool

`GET /v2/odds/history/` exists (https://sockodds.com/docs/endpoints/getOddsHistory/), but the homepage
(https://sockodds.com/) and FAQ (https://sockodds.com/docs/faq/) say recorded price movements are a Pro and
Platform feature. The free key cannot use it, so the tool is left out.

## Not verified without a key

- Live response bodies. Every fixture is either copied from the docs (`fixtures/docs/`) or invented in the
  documented shape (`fixtures/demo/`).
- Exactly how `ml3way` is keyed for soccer (the period may be `game` or `reg`); the server looks for both.
- What happens when the monthly object allowance runs out. The docs describe 429 for the per-minute limit only;
  this server treats any 429 the same way and shows SockOdds' own error text.
- Whether `fairOdds` is filled on the free plan. The pricing page lists "Fair odds (fairOdds, de-vigged)" for
  Developer, while https://sockodds.com/docs/info/consensus-odds/ says fair fields are always null on the Lite
  plan. The `fair_odds` tool works out its own no-vig price from bookmaker prices either way, and shows
  SockOdds' sharp fair price when it is present.
- Whether passing `oddID` to `/events/` drops events that do not price that market.
