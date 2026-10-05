# sockodds-mcp

Ask Claude "what are the odds on X right now" and get every Australian bookmaker's price, the best price and the no-vig fair price, from the [SockOdds](https://sockodds.com/) sports odds API.

A free, open-source MCP server plus a Claude Code skill, built for the "$1M in 365 Days" series. MIT licence.

## 30-second demo

This transcript uses demo mode (`SOCKODDS_DEMO=1`), so the prices are invented samples, not real odds.

> **You:** What are the odds on Lions v Crows?
>
> **Claude** calls `find_event` with `{ "query": "Lions v Crows", "league_id": "AFL" }`:
>
> ```text
> 1. Brisbane Lions v Adelaide Crows (AFL)
>    Starts: Sat, 12 Sept 2026, 7:35 pm AEST (09:35 UTC)
>    Event ID: afl_2026-09-12_brisbane_lions_vs_adelaide_crows
>    Best head to head: Brisbane Lions 1.95 (Unibet), Adelaide Crows 1.90 (TAB)
> ```
>
> **You:** Is 1.95 on the Lions a fair price?
>
> **Claude** calls `fair_odds` with `{ "event_id": "afl_2026-09-12_brisbane_lions_vs_adelaide_crows", "market": "h2h" }`:
>
> ```text
> No-vig fair odds: Head to head, from 3 bookmakers
>   Brisbane Lions: fair 2.03 (49.3% chance)
>   Adelaide Crows: fair 1.97 (50.7% chance)
> Per bookmaker (margin, then its own no-vig prices):
>   Sportsbet: margin 5.3%, 2.03 / 1.97, read 11 Sept 06:00:12 UTC
>   TAB: margin 5.0%, 2.01 / 1.99, read 11 Sept 06:01:40 UTC
>   Unibet: margin 5.3%, 2.05 / 1.95, read 11 Sept 05:59:03 UTC
> ```
>
> **Claude:** The best Lions price is 1.95 at Unibet (read 05:59 UTC). With the bookmakers' margins taken out, the Lions come out at about 2.03, so 1.95 is a little shorter than the fair price. Odds change, so check the price at the bookmaker. 18+. Nothing here is a tip. Gamble responsibly: Gambling Help Online 1800 858 858.

## Tools

| Tool | What it does |
| --- | --- |
| `list_leagues` | Leagues SockOdds carries and whether your key's plan can read each one |
| `find_event` | Turns "Broncos v Bulldogs" or "AFL grand final" into events with start times and event IDs |
| `get_odds` | Every bookmaker's decimal prices for head to head, line and total, each with the time it was read |
| `best_price` | Best price for one side of one market, plus the field; suspended prices and other lines are left out |
| `fair_odds` | No-vig fair price for a two- or three-way market (see the method below); also works by hand with no API call |

### How `fair_odds` works

For each bookmaker that prices every outcome at the same line, each price becomes an implied chance (1 / price). Those chances add up to more than 100%; the extra is the bookmaker's margin. Dividing each chance by the total removes the margin (the proportional method). The tool then averages each bookmaker's margin-free chances and turns them back into prices (1 / chance). It also shows each bookmaker's margin and the combined margin of the best prices.

The free plan's books are retail bookmakers, so this is an estimate of the chance, not a prediction. When your plan includes SockOdds' own `fairOdds` (built from exchanges and sharp books), the tool shows it too.

### No line movement tool

SockOdds has a price history endpoint (`/v2/odds/history/`), but its homepage and [FAQ](https://sockodds.com/docs/faq/) list recorded price movements as a Pro and Platform feature. The free key cannot read it, so this server does not include an `explain_line_movement` tool.

## Get a free SockOdds key

[Get a free SockOdds key](https://sockodds.com/signup/?utm_source=1m365-gh&utm_medium=github&utm_campaign=sockodds-mcp). No card needed; the key is shown once, so copy it somewhere safe.

The free Developer plan, as stated on the [pricing page](https://sockodds.com/pricing/), the [signup page](https://sockodds.com/signup/) and the [rate limit docs](https://sockodds.com/docs/info/rate-limiting/):

- 2,500 objects a month (one event with all its markets and bookmakers is one object), reset each UTC calendar month
- 10 requests a minute
- About 2 minute update frequency
- 4 leagues: MLB, NFL, AFL and NRL
- 3 bookmakers: Sportsbet, TAB and Ladbrokes

To stay inside that, this server caches every response for 60 seconds, never retries a failed request, and after a rate limit error (HTTP 429) refuses further calls until SockOdds' `Retry-After` time has passed. `find_event` asks for one league and a date window where it can, and tells you how many objects a search used.

## Install

You need Node.js 20 or newer.

### From source

```bash
git clone https://github.com/jameselle/sockodds-mcp.git
cd sockodds-mcp
npm install
npm run build
```

### Claude Code

```bash
claude mcp add sockodds --env SOCKODDS_API_KEY=your-key -- node /full/path/to/sockodds-mcp/dist/src/index.js
```

Once the package is on npm you can use `npx` instead:

```bash
claude mcp add sockodds --env SOCKODDS_API_KEY=your-key -- npx -y sockodds-mcp
```

To add the skill, which tells Claude when to use the tools and how to quote prices, copy the `skill` folder into your skills directory:

```bash
mkdir -p ~/.claude/skills/sockodds-odds
cp skill/SKILL.md ~/.claude/skills/sockodds-odds/SKILL.md
```

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings, Developer, Edit Config), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "sockodds": {
      "command": "node",
      "args": ["/full/path/to/sockodds-mcp/dist/src/index.js"],
      "env": {
        "SOCKODDS_API_KEY": "your-key"
      }
    }
  }
}
```

### Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `SOCKODDS_API_KEY` | none | Your SockOdds key. Sent only in the `x-api-key` header. Without it the odds tools explain how to get one. |
| `SOCKODDS_DEMO` | off | Set to `1` to try the tools with invented sample data and no key. Ignored when a key is set. |
| `SOCKODDS_TIMEZONE` | `Australia/Sydney` | Time zone for start times (UTC is always shown too) |
| `SOCKODDS_BASE_URL` | `https://api.sockodds.com/v2` | API base URL |

## Develop

```bash
npm install
npm test
```

Tests use Node's built-in test runner. They cover the fair odds maths, best price selection, parsing of the example responses from the SockOdds docs, the missing key and rate limit errors, and the MCP tools end to end. No test calls the live API.

`docs/API-NOTES.md` lists every endpoint and field this server relies on, with links to the SockOdds docs. `fixtures/docs/` holds example responses copied from those docs; `fixtures/demo/` holds invented data in the same shape for demo mode.

## Gamble responsibly

18+. Odds change all the time and nothing this tool shows is a tip or advice. If gambling is causing you or someone close to you harm, call Gambling Help Online on 1800 858 858 or visit [gamblinghelponline.org.au](https://www.gamblinghelponline.org.au/). You can exclude yourself from Australian online bookmakers at [BetStop](https://www.betstop.gov.au/).

## Licence

MIT. See [LICENSE](LICENSE).
