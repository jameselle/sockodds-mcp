# sockodds-mcp

Ask Claude "what are the odds on X right now" and get Australian bookmakers' prices, the best price and the no-vig fair price, from the [SockOdds](https://sockodds.com/) sports odds API (v1). The free key covers 3 bookmakers and 6 leagues; paid plans add more ([pricing](https://sockodds.com/pricing/)).

> **Version 1.0 speaks SockOdds API v1.** Versions 0.x called the older v2 API, which SockOdds is retiring: once it is switched off, 0.x stops working. Update to 1.0: restart your MCP client so `npx -y sockodds-mcp` fetches it, and if the server still starts as 0.x, point it at `sockodds-mcp@latest` once. Your key carries over. See [Upgrading from 0.x](#upgrading-from-0x).

A free, open-source MCP server plus a Claude Code skill, built for the "$1M in 365 Days" series. MIT licence.

## 30-second demo

This transcript uses demo mode (`SOCKODDS_DEMO=1`), so the prices are invented samples, not real odds.

> **You:** What are the odds on Lions v Crows?
>
> **Claude** calls `find_event` with `{ "query": "Lions v Crows", "league_id": "afl" }`:
>
> ```text
> 1. Brisbane Lions v Adelaide Crows (AFL)
>    Starts: Sat, 12 Sept 2026, 7:35 pm AEST (09:35 UTC)
>    Event ID: ev_kqe6aepys23z
> ```
>
> **You:** Is 1.95 on the Lions a fair price?
>
> **Claude** calls `fair_odds` with `{ "event_id": "ev_kqe6aepys23z", "market": "h2h" }`:
>
> ```text
> No-vig fair odds: Head to head, from 3 bookmakers
>   Brisbane Lions: fair 2.03 (49.3% chance)
>   Adelaide Crows: fair 1.97 (50.7% chance)
> Per bookmaker (margin, then its own no-vig prices):
>   Sportsbet: margin 5.3%, 2.03 / 1.97, seen 11 Sept 06:00:12 UTC
>   TAB: margin 5.0%, 2.01 / 1.99, seen 11 Sept 06:01:40 UTC
>   Unibet: margin 5.3%, 2.05 / 1.95, seen 11 Sept 05:59:03 UTC
> ```
>
> **Claude:** The best Lions price is 1.95 at Unibet (read 05:59 UTC). With the bookmakers' margins taken out, the Lions come out at about 2.03, so 1.95 is a little shorter than the fair price. Odds change, so check the price at the bookmaker. 18+. Nothing here is a tip. Gamble responsibly: Gambling Help Online 1800 858 858.

## Tools

| Tool | What it does |
| --- | --- |
| `list_leagues` | Leagues SockOdds carries, with the league keys (`afl`, `nrl`, `rlwc` ...) the other tools take |
| `find_event` | Turns "Broncos v Bulldogs" or "AFL grand final" into events with start times and event IDs (`ev_...`) |
| `get_odds` | Each bookmaker's decimal prices for head to head, line and total, each with the time SockOdds saw it |
| `best_price` | Best price for one side of one market, plus the field; prices at other lines are left out |
| `fair_odds` | No-vig fair price for a two- or three-way market (see the method below); also works by hand with no API call |

### How `fair_odds` works

For each bookmaker that prices every outcome at the same line, each price becomes an implied chance (1 / price). Those chances add up to more than 100%; the extra is the bookmaker's margin. Dividing each chance by the total removes the margin (the proportional method). The tool then averages each bookmaker's margin-free chances and turns them back into prices (1 / chance). It also shows each bookmaker's margin and the combined margin of the best prices.

The free plan's books are retail bookmakers, so this is an estimate of the chance, not a prediction. SockOdds API v1 publishes each bookmaker's price exactly as shown, margin included, so the fair price is always worked out here from those prices.

### No line movement tool

SockOdds API v1 has recorded price history (`/v1/odds/history`), but [history is on the Pro plan](https://sockodds.com/docs/history/) and other plans get HTTP 403. The free key cannot read it, so this server does not include a line movement tool.

## Get a free SockOdds key

[Get a free SockOdds key](https://sockodds.com/signup/?utm_source=1m365-gh&utm_medium=github&utm_campaign=sockodds-mcp). No card needed. Sign-up asks for an Australian or international mobile number and sends a one-time SMS code to confirm it. The key is shown once, so copy it somewhere safe. To try the tools before signing up, set `SOCKODDS_DEMO=1`: every tool works on invented sample data, no key needed.

The free Developer plan, as stated on the [pricing page](https://sockodds.com/pricing/) and in [plans and limits](https://sockodds.com/docs/limits/):

- 2,500 objects a month, reset each UTC calendar month. Each event in a response is one object, and every priced outcome inside an odds response is one more: one game with three bookmakers each quoting a two-way market is 1 + 3 x 2 = 7 objects.
- 10 requests a minute
- 6 leagues: MLB, NFL, AFL, NRL and the Rugby League World Cup (men's and women's)
- 3 bookmakers: Sportsbet, TAB and Ladbrokes. Prices from bookmakers outside your plan are left out of responses rather than refused.

To stay inside that, this server caches every response for 60 seconds, never retries a failed request, and after a rate limit error (HTTP 429) refuses further calls until SockOdds' `Retry-After` time has passed. `find_event` reads events without prices (one object each) and asks for one league and a date window where it can. `get_odds`, `best_price` and `fair_odds` ask only for the markets they show, and every live answer says how many objects it used.

## Install

You need Node.js 20 or newer. The server is on npm as [`sockodds-mcp`](https://www.npmjs.com/package/sockodds-mcp), so there is nothing to build.

### Claude Code

```bash
claude mcp add sockodds --env SOCKODDS_API_KEY=your-key -- npx -y sockodds-mcp
```

No key yet? Try it on invented sample data first:

```bash
claude mcp add sockodds --env SOCKODDS_DEMO=1 -- npx -y sockodds-mcp
```

To add the skill, which tells Claude when to use the tools and how to quote prices:

```bash
mkdir -p ~/.claude/skills/sockodds-odds
curl -fsSL https://raw.githubusercontent.com/jameselle/sockodds-mcp/main/skill/SKILL.md -o ~/.claude/skills/sockodds-odds/SKILL.md
```

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings, Developer, Edit Config), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "sockodds": {
      "command": "npx",
      "args": ["-y", "sockodds-mcp"],
      "env": {
        "SOCKODDS_API_KEY": "your-key"
      }
    }
  }
}
```

For demo mode, swap the `env` block for `"SOCKODDS_DEMO": "1"`.

### Other MCP clients

Any client that runs a local (stdio) server: command `npx`, arguments `-y sockodds-mcp`, environment `SOCKODDS_API_KEY`. It is also listed in the [official MCP Registry](https://registry.modelcontextprotocol.io/) as `io.github.jameselle/sockodds-mcp`.

### From source

```bash
git clone https://github.com/jameselle/sockodds-mcp.git
cd sockodds-mcp
npm install
npm run build
claude mcp add sockodds --env SOCKODDS_API_KEY=your-key -- node "$(pwd)/dist/src/index.js"
```

### Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `SOCKODDS_API_KEY` | none | Your SockOdds key. Sent only as an `Authorization: Bearer` header, never in a URL. Without it the odds tools explain how to get one. |
| `SOCKODDS_DEMO` | off | Set to `1` to try the tools with invented sample data and no key. Ignored when a key is set. |
| `SOCKODDS_TIMEZONE` | `Australia/Sydney` | Time zone for start times (UTC is always shown too) |
| `SOCKODDS_BASE_URL` | `https://api.sockodds.com/v1` | API base URL. Leave it unset. An old setting pointing at `/v2` will fail once v2 is retired: remove it. |

## Develop

```bash
npm install
npm test
```

Tests use Node's built-in test runner with a fake `fetch`. They cover the fair odds maths, best price selection, parsing of the example responses from the SockOdds v1 docs, the v1 paths and query names, every error status, and the MCP tools end to end. No test calls the live API.

`docs/API-NOTES.md` lists every endpoint and field this server relies on, with links to the SockOdds docs. `fixtures/docs/` holds example responses copied from those docs; `fixtures/demo/` holds invented data in the same shape for demo mode.

## Upgrading from 0.x

Version 1.0.0 moves from the retired v2 API to SockOdds API v1. What changes for you:

- **Your key carries over.** It is now sent as `Authorization: Bearer <key>` instead of `x-api-key`.
- **Event IDs are new.** v1 IDs look like `ev_000ckk0nc1tg`. IDs from 0.x (such as `afl_2026-09-12_...`) are not translated, so run `find_event` again.
- **League and sport keys are lower case**, such as `afl`, `nrl`, `rlwc`, `australian_football`. `find_event` and `list_leagues` still accept plain names such as "AFL" or "Rugby League World Cup".
- **Bookmaker keys** follow v1, for example `betfair_exchange`.
- **`best_price` takes `outcome_id`** (an `oc_...` ID that `get_odds` shows with `all_markets`) in place of `odd_id`.
- **`find_event` no longer shows prices.** Under v1 every priced outcome counts as an object, so the search reads events only. Use `get_odds` or `best_price` next.
- **No SockOdds consensus or sharp fair price.** v1 publishes each bookmaker's price as shown; `fair_odds` works out the no-vig price from them, as before.
- **Usage counts differently.** One object per event, plus one per priced outcome in an odds answer. Each live answer says what it used.
- **Errors** follow the v1 problem format, with plain messages for 400, 401, 403, 404, 410, 429 (rate limit or monthly allowance) and 503.

The tool names (`list_leagues`, `find_event`, `get_odds`, `best_price`, `fair_odds`) and the settings are unchanged.

## Release

`package.json` (`version`, `mcpName`) and `server.json` (`version`, `packages[0].version`) must carry the same version. To release:

```bash
npm test
npm publish
mcp-publisher login github
mcp-publisher publish
```

`server.json` lists this server in the [official MCP Registry](https://registry.modelcontextprotocol.io/) as `io.github.jameselle/sockodds-mcp`, and the registry checks that the npm package's `mcpName` matches. `glama.json` names the maintainers of the [Glama listing](https://glama.ai/mcp/servers/jameselle/sockodds-mcp).

## Gamble responsibly

18+. Odds change all the time and nothing this tool shows is a tip or advice. If gambling is causing you or someone close to you harm, call Gambling Help Online on 1800 858 858 or visit [gamblinghelponline.org.au](https://www.gamblinghelponline.org.au/). You can exclude yourself from Australian online bookmakers at [BetStop](https://www.betstop.gov.au/).

## Licence

MIT. See [LICENSE](LICENSE).
