import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DemoSource, SockOddsClient, type OddsSource } from "./client.js";
import { type Settings } from "./config.js";
import { SockOddsError } from "./errors.js";
import { bestPrice, fairOdds, findEvent, getOdds, listLeagues, type ToolDeps } from "./tools.js";

export const VERSION = "0.1.0";

const MARKET_ENUM = ["h2h", "h2h_3way", "line", "total"] as const;

export const INSTRUCTIONS = [
  "Answers 'what are the odds on X right now' from the SockOdds sports odds API (Australian bookmakers, decimal odds).",
  "Usual flow: find_event to get an event ID, then get_odds, best_price or fair_odds.",
  "Always tell the person which bookmaker each price is from and when it was read. Odds change; nothing here is a tip. 18+, gamble responsibly.",
  "Each event fetched counts as one object against the key's monthly allowance (2,500 on the free plan), and the free plan allows 10 requests a minute. Responses are cached for 60 s.",
].join(" ");

const TOOL_TEXT = {
  list_leagues:
    "List the leagues SockOdds carries and whether this API key's plan can read each one. The free Developer plan covers MLB, NFL, AFL and NRL. Use it when you are unsure of a leagueID.",
  find_event:
    "Find upcoming events (games) from a plain question such as 'Broncos v Bulldogs', 'AFL grand final' or 'Lions Crows'. Returns matching events with start times (local and UTC), event IDs and the best head to head price per side. Pass league_id whenever you know the league (for example AFL, NRL, NFL, MLB): it keeps the search small, because every event returned counts as one object against the key's monthly allowance. With no team named, it lists the soonest events in the league.",
  get_odds:
    "Get every bookmaker's current decimal prices for one event's main markets: head to head (with the draw where the sport has one), line (handicap) and total points. Each price shows the bookmaker and when it was last seen. Set all_markets to true to include every priced market, such as halves and props. Costs one object.",
  best_price:
    "Find the best (highest) decimal price for one side of one market across bookmakers, and show the rest of the field. Only prices open right now count; suspended or expired prices are listed separately. For line and total markets prices are compared at one line only: the line you give, else SockOdds' consensus line. Give market and side, or an exact odd_id from get_odds. Costs one object.",
  fair_odds:
    "Work out the no-vig (margin-free) fair price for a two- or three-way market. Method: for each bookmaker that prices every outcome at the same line, convert prices to implied chances (1 / decimal price), divide by their total so they add to 100% (the proportional method), then average those chances across bookmakers and convert back (1 / chance). Also reports each bookmaker's margin and the combined margin of the best prices. Use event_id and market for live prices, or pass prices to calculate by hand with no API call. The result estimates the chance; it is not a prediction or a tip.",
};

function sourceFor(settings: Settings): OddsSource {
  return settings.demo ? new DemoSource() : new SockOddsClient(settings);
}

type Handler<A> = (deps: ToolDeps, args: A) => Promise<string>;

function wrap<A>(deps: ToolDeps, handler: Handler<A>) {
  return async (args: A) => {
    try {
      return { content: [{ type: "text" as const, text: await handler(deps, args) }] };
    } catch (err) {
      const msg = err instanceof SockOddsError || err instanceof RangeError ? err.message : `Unexpected error: ${(err as Error).message}`;
      return { content: [{ type: "text" as const, text: msg }], isError: true };
    }
  };
}

export function createServer(settings: Settings, source: OddsSource = sourceFor(settings)): McpServer {
  const server = new McpServer({ name: "sockodds-mcp", version: VERSION }, { instructions: INSTRUCTIONS });
  const deps: ToolDeps = { source, timeZone: settings.timeZone };
  const readOnly = { readOnlyHint: true, openWorldHint: true };

  server.registerTool(
    "list_leagues",
    {
      title: "List leagues",
      description: TOOL_TEXT.list_leagues,
      inputSchema: { sport_id: z.string().optional().describe("Optional sportID filter, for example AUSSIE_RULES or RUGBY_LEAGUE") },
      annotations: readOnly,
    },
    wrap(deps, listLeagues),
  );

  server.registerTool(
    "find_event",
    {
      title: "Find an event",
      description: TOOL_TEXT.find_event,
      inputSchema: {
        query: z.string().min(1).describe("Plain question or team names, for example 'Broncos v Bulldogs' or 'AFL grand final'"),
        league_id: z.string().optional().describe("League, for example AFL, NRL, NFL, MLB. Strongly recommended."),
        days_ahead: z.number().int().min(1).max(60).optional().describe("Only events starting within this many days. Default 14."),
        limit: z.number().int().min(1).max(100).optional().describe("Most events to fetch. Default 25 with a league, 50 without."),
      },
      annotations: readOnly,
    },
    wrap(deps, findEvent),
  );

  server.registerTool(
    "get_odds",
    {
      title: "Get odds for an event",
      description: TOOL_TEXT.get_odds,
      inputSchema: {
        event_id: z.string().min(1).describe("Event ID from find_event, for example afl_2026-09-12_brisbane_lions_vs_adelaide_crows"),
        bookmakers: z.string().optional().describe("Optional comma separated bookmakerIDs, for example sportsbet,tab"),
        all_markets: z.boolean().optional().describe("Include every priced market, not just head to head, line and total"),
      },
      annotations: readOnly,
    },
    wrap(deps, getOdds),
  );

  server.registerTool(
    "best_price",
    {
      title: "Best price",
      description: TOOL_TEXT.best_price,
      inputSchema: {
        event_id: z.string().min(1).describe("Event ID from find_event"),
        market: z.enum(MARKET_ENUM).optional().describe("h2h, h2h_3way, line or total"),
        side: z.enum(["home", "away", "draw", "over", "under"]).optional().describe("home or away (h2h, line), draw (h2h_3way), over or under (total)"),
        odd_id: z.string().optional().describe("Exact oddID from get_odds instead of market and side, for any market"),
        line: z.number().optional().describe("Compare at this line. For a line market this is the chosen side's own handicap, for example -2.5"),
      },
      annotations: readOnly,
    },
    wrap(deps, bestPrice),
  );

  server.registerTool(
    "fair_odds",
    {
      title: "No-vig fair odds",
      description: TOOL_TEXT.fair_odds,
      inputSchema: {
        event_id: z.string().optional().describe("Event ID from find_event (with market)"),
        market: z.enum(MARKET_ENUM).optional().describe("h2h, h2h_3way, line or total"),
        line: z.number().optional().describe("Line to use: the home team's handicap for a line market, the total for a total market"),
        prices: z
          .object({
            outcomes: z.array(z.string()).min(2).max(3).describe("Outcome names, for example ['Home', 'Away']"),
            books: z
              .array(z.object({ bookmaker: z.string(), odds: z.array(z.number().gt(1)).min(2).max(3) }))
              .min(1)
              .describe("Each bookmaker's decimal prices in the same order as outcomes"),
          })
          .optional()
          .describe("Calculate by hand from these decimal prices instead of calling the API"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    wrap(deps, fairOdds),
  );

  return server;
}
