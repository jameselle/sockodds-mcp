import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DemoSource, SockOddsClient, type FullSource } from "./client.js";
import { type Settings } from "./config.js";
import { SockOddsError } from "./errors.js";
import { ARB_REGIONS, bestPrice, fairOdds, findArbs, findEvent, getOdds, listLeagues, type ToolDeps } from "./tools.js";
import { closingLine, findEv, findLowHolds, findMiddles, getResults, lineMoves, oddsHistory, type MoreDeps } from "./tools-analysis.js";
import { RACING_CODES, RACING_COUNTRIES, listRaces, raceForm, raceOdds, raceResult, racingArbs, racingMovers } from "./tools-racing.js";

export const VERSION = "1.3.0";

const MARKET_ENUM = ["h2h", "h2h_3way", "line", "total"] as const;

export const INSTRUCTIONS = [
  "Answers 'what are the odds on X right now' from SockOdds API v1 (Australian and international bookmakers, decimal odds), plus analysis and Australian and New Zealand racing.",
  "Usual flow: find_event to get an event ID, then get_odds, best_price or fair_odds. After a game: get_results, closing_line (CLV) and odds_history.",
  "For arbitrage call find_arbs; for value find_ev, find_middles or find_low_holds; for steam line_moves. Those derived tools need Pro or the free Pro trial and keep to Australian bookmakers unless asked otherwise.",
  "Racing: list_races for race IDs, then race_odds, race_form or race_result; racing_arbs and racing_movers (Pro). Racing needs a paid plan or the Pro trial.",
  "Always tell the person which bookmaker each price is from and when it was read. Odds change; nothing here is a tip. 18+, gamble responsibly.",
  "Usage is counted in objects: each event returned is one, plus one for every priced outcome in an odds answer (2,500 a month on the free plan, which also allows 10 requests a minute). Responses are cached for 60 s.",
].join(" ");

const TOOL_TEXT = {
  list_leagues:
    "List the leagues SockOdds carries, with each league's key (for example afl, nrl, nfl, mlb, rlwc). The free Developer plan covers MLB, NFL, AFL, NRL and the Rugby League World Cup (men's and women's). Use it when you are unsure of a league key.",
  find_event:
    "Find upcoming and live events (games) from a plain question such as 'Broncos v Bulldogs', 'AFL grand final' or 'Australia v New Zealand'. Returns matching events with start times (local and UTC) and event IDs (ev_...), but no prices. Pass league_id whenever you know the league (for example afl, nrl, nfl, mlb, rlwc): it keeps the search small, because every event returned counts as one object against the key's monthly allowance. With no team named, it lists the soonest events in the league.",
  get_odds:
    "Get every bookmaker's current decimal prices for one event's main markets: head to head (with the draw where the sport has one), line (handicap) and the main total. Each price shows the bookmaker and when SockOdds saw it. Set all_markets to true to include every priced market, such as halves and props (this costs more objects: one for the event plus one per priced outcome).",
  best_price:
    "Find the best (highest) decimal price for one side of one market across bookmakers, and show the rest of the field. Only available prices count. For line and total markets prices are compared at one line only: the line you give, else the line most bookmakers quote. Give market and side, or an exact outcome_id (oc_...) from get_odds with all_markets.",
  find_arbs:
    "List current arbitrage: two prices at two different bookmakers that cover one market, so a stake split between them returns a profit whichever side wins. By default only arbs where every bet is at an Australian bookmaker are shown; set region to all for every bookmaker. Each arb shows the event, market, each bookmaker's price and the time SockOdds saw it, and how to split the stake. Needs a Pro key or the free 7-day Pro trial. Costs 10 credits for each page of up to 100 arbs it reads (at most 3 pages); the bookmaker list it reads first is free.",
  fair_odds:
    "Work out the no-vig (margin-free) fair price for a two- or three-way market. Method: for each bookmaker that prices every outcome at the same line, convert prices to implied chances (1 / decimal price), divide by their total so they add to 100% (the proportional method), then average those chances across bookmakers and convert back (1 / chance). Also reports each bookmaker's margin and the combined margin of the best prices. Use event_id and market for live prices, or pass prices to calculate by hand with no API call. The result estimates the chance; it is not a prediction or a tip.",
  find_ev:
    "List positive expected value (+EV) prices: a bookmaker price longer than the outcome's fair price, with the EV in percent of the stake, the fair price, how it was made (a sharp bookmaker's own market such as Pinnacle's with its margin removed, an exchange, or a consensus of other bookmakers) and the full-Kelly stake. Australian bookmakers only by default; set region to all for every bookmaker. Upcoming events only. Needs a Pro key or the free 7-day Pro trial. Costs 10 credits for each page of up to 100 entries it reads (at most 3 pages); the bookmaker list it reads first is free.",
  find_middles:
    "List middles: two bets on different lines of one market at two bookmakers (over 44.5 at one, under 47.5 at the other), so both win when the result lands in the gap. Shows the gap, the profit when both win and the result when only one wins. Australian bookmakers only by default. Needs Pro or the free Pro trial; 10 credits a page of up to 100 (at most 3 pages).",
  find_low_holds:
    "List low-hold markets: the best price on each side of one market at two bookmakers, where the two together carry almost no margin (the hold, in percent; 0 is break-even). Useful to find the tightest markets; a low hold is not an arbitrage. Australian bookmakers only by default. Needs Pro or the free Pro trial; 10 credits a page of up to 100 (at most 3 pages).",
  line_moves:
    "List line moves in one league over the last few minutes to hours: markets whose main line (handicap, totals, player and team over/unders) moved at one or more bookmakers, with steam (several bookmakers moving the same way) and whether Pinnacle moved with them. Head to head markets have no line and are not covered. Keeps moves where an Australian bookmaker moved unless region is all. Needs Pro or the free Pro trial; 10 credits a call.",
  closing_line:
    "Show one event's closing line: each bookmaker's opening and closing price per outcome, the fair closing price (margin removed, usually from Pinnacle's closing market) and each opening price's closing line value (CLV). Give outcome_id and odds to get the CLV of your own bet. Closing prices exist once the event has started. Needs Pro or the free Pro trial; 10 credits a call.",
  odds_history:
    "Summarise how one event's prices moved: for each outcome and bookmaker, the first price in the window, the latest, the high and low and how many changes, from SockOdds' recorded price history (not every tick). By default reads the 24 hours before the start (or up to now before the start) for the head to head market at Australian bookmakers. Needs a paid plan or the Pro trial; recorded history costs 10 times the live price in credits.",
  get_results:
    "Get graded results for finished events from official sources: the score, which outcomes won in the main markets (head to head, line and total), voids and dead heats, and whether every market has settled. Give an event_id for one game (with every graded market), or a league_id for recent games. Costs 1 credit for one event, 2 for a league window.",
  list_races:
    "List upcoming Australian (default) or New Zealand races, thoroughbred, harness and greyhound, grouped by meeting, with start times (local and UTC), distance, class and each race's race ID for race_odds, race_form and race_result. Needs a paid plan or the free Pro trial; the list itself costs no credits.",
  race_odds:
    "Get every bookmaker's fixed-odds win and place prices for every runner in one race, the best win and place price, and Betfair Exchange back and lay prices with the money available and matched. Scratched runners are marked. Needs a paid plan or the Pro trial; about 1 credit per 10 bookmakers.",
  racing_arbs:
    "List racing arbs in races still to run: a bookmaker's win price that beats the Betfair Exchange win lay, so backing at the bookmaker and laying on the exchange returns a profit either way. Shows the back and lay stakes, the liability, the money available at the lay price and the profit after commission. Australian races by default. Needs Pro or the free Pro trial; 10 credits a call.",
  racing_movers:
    "List racing market movers in races still to run: runners whose win price moved most since it opened (firming or drifting), with the opening price and bookmaker against the median and best current price. Australian races by default. Needs Pro or the free Pro trial; 10 credits a call.",
  race_result:
    "Get one race's result: placings with the prices paid (TAB fixed, tote and Betfair Starting Price), scratchings with deductions, and tote dividends (win, place, quinella, exacta, trifecta, first four). Needs a paid plan or the Pro trial; 1 credit.",
  race_form:
    "Get the form for every runner in one race: form figures and its last recorded starts (date, track, distance, class, track condition, finishing position, jockey, trainer, barrier, weight and starting prices). SockOdds records starts from 1 August 2026. Needs a paid plan or the Pro trial; 1 credit.",
};

function sourceFor(settings: Settings): FullSource {
  return settings.demo ? new DemoSource() : new SockOddsClient(settings);
}

type Handler<D, A> = (deps: D, args: A) => Promise<string>;

function wrap<D extends ToolDeps, A>(deps: D, handler: Handler<D, A>) {
  return async (args: A) => {
    try {
      return { content: [{ type: "text" as const, text: await handler(deps, args) }] };
    } catch (err) {
      const msg = err instanceof SockOddsError || err instanceof RangeError ? err.message : `Unexpected error: ${(err as Error).message}`;
      return { content: [{ type: "text" as const, text: msg }], isError: true };
    }
  };
}

export function createServer(settings: Settings, source: FullSource = sourceFor(settings)): McpServer {
  const server = new McpServer({ name: "sockodds-mcp", version: VERSION }, { instructions: INSTRUCTIONS });
  const deps: ToolDeps = { source, timeZone: settings.timeZone };
  const more: MoreDeps = { source, timeZone: settings.timeZone };
  const readOnly = { readOnlyHint: true, openWorldHint: true };

  server.registerTool(
    "list_leagues",
    {
      title: "List leagues",
      description: TOOL_TEXT.list_leagues,
      inputSchema: { sport_id: z.string().optional().describe("Optional sport key filter, for example australian_football, rugby_league or soccer") },
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
        league_id: z.string().optional().describe("League key, for example afl, nrl, nfl, mlb or rlwc. Strongly recommended."),
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
        event_id: z.string().min(1).describe("Event ID from find_event, for example ev_000ckk0nc1tg"),
        bookmakers: z.string().optional().describe("Optional comma separated bookmaker keys, at most 20, for example sportsbet,tab"),
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
        side: z
          .enum(["home", "away", "draw", "over", "under", "competitor_1", "competitor_2"])
          .optional()
          .describe("home or away (h2h, line; competitor_1 or competitor_2 in tennis and UFC), draw (h2h_3way), over or under (total)"),
        outcome_id: z.string().optional().describe("Exact outcome_id (oc_...) from get_odds with all_markets, instead of market and side, for any market"),
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

  server.registerTool(
    "find_arbs",
    {
      title: "Find arbitrage",
      description: TOOL_TEXT.find_arbs,
      inputSchema: {
        league_id: z.string().optional().describe("Only this league, for example nba, nfl, afl or nrl. Leave it out for every league."),
        region: z
          .enum(ARB_REGIONS)
          .optional()
          .describe("Keep arbs whose every bet is at a bookmaker in this region. Default au (Australian bookmakers). Use all for every bookmaker."),
        min_profit_pct: z.number().min(0).max(1000).optional().describe("Only arbs paying at least this percent of the total stake, for example 1"),
        stake: z.number().gt(0).max(1_000_000).optional().describe("Total stake to split across the bets, in dollars. Default 100."),
        max_results: z.number().int().min(1).max(50).optional().describe("Most arbs to show. Default 10."),
      },
      annotations: readOnly,
    },
    wrap(deps, findArbs),
  );

  // ------------------------------------------------------------ 1.3.0: derived endpoints, history, results

  const region = z
    .enum(ARB_REGIONS)
    .optional()
    .describe("Keep entries whose every price is at a bookmaker in this region. Default au (Australian bookmakers). Use all for every bookmaker.");
  const leagueOpt = z.string().optional().describe("Only this league, for example nba, nfl, afl or nrl. Leave it out for every league.");
  const marketsOpt = z.string().optional().describe("Optional comma separated market keys, at most 20, for example winner,handicap or player_points_over_under");
  const maxResults = z.number().int().min(1).max(50).optional().describe("Most entries to show. Default 10.");
  const marketKind = z.enum(MARKET_ENUM).optional();

  server.registerTool(
    "find_ev",
    {
      title: "Find positive EV prices",
      description: TOOL_TEXT.find_ev,
      inputSchema: {
        league_id: leagueOpt,
        region,
        min_ev_pct: z.number().min(0).max(1000).optional().describe("Only prices with at least this expected value, in percent of the stake, for example 2"),
        fair_method: z.enum(["sharp_book", "exchange", "consensus"]).optional().describe("Only fair prices made this way: sharp_book (a sharp bookmaker's own market), exchange, or consensus"),
        markets: marketsOpt,
        max_results: maxResults,
      },
      annotations: readOnly,
    },
    wrap(more, findEv),
  );

  server.registerTool(
    "find_middles",
    {
      title: "Find middles",
      description: TOOL_TEXT.find_middles,
      inputSchema: {
        league_id: leagueOpt,
        region,
        min_middle_pct: z.number().min(0).max(10_000).optional().describe("Only middles paying at least this percent of the total stake when both bets win"),
        markets: marketsOpt,
        max_results: maxResults,
      },
      annotations: readOnly,
    },
    wrap(more, findMiddles),
  );

  server.registerTool(
    "find_low_holds",
    {
      title: "Find low-hold markets",
      description: TOOL_TEXT.find_low_holds,
      inputSchema: {
        league_id: leagueOpt,
        region,
        max_hold_pct: z.number().min(0).max(100).optional().describe("Only markets whose combined margin is at most this percent, for example 1"),
        markets: marketsOpt,
        max_results: maxResults,
      },
      annotations: readOnly,
    },
    wrap(more, findLowHolds),
  );

  server.registerTool(
    "line_moves",
    {
      title: "Line moves and steam",
      description: TOOL_TEXT.line_moves,
      inputSchema: {
        league_id: z.string().min(1).describe("League key, for example nba, nfl, afl or nrl. Required."),
        window_minutes: z.number().int().min(5).max(360).multipleOf(5).optional().describe("Minutes to look back, in steps of 5. Default 60."),
        min_books: z.number().int().min(1).max(50).optional().describe("Fewest bookmakers moving the same way to count as steam. Default 3."),
        steam_only: z.boolean().optional().describe("Only steam moves"),
        region: z
          .enum(ARB_REGIONS)
          .optional()
          .describe("Keep moves where a bookmaker in this region moved. Default au. Use all for every bookmaker."),
        max_results: maxResults,
      },
      annotations: readOnly,
    },
    wrap(more, lineMoves),
  );

  server.registerTool(
    "closing_line",
    {
      title: "Closing line and CLV",
      description: TOOL_TEXT.closing_line,
      inputSchema: {
        event_id: z.string().min(1).describe("Event ID from find_event, for example ev_000ckk0nc1tg"),
        market: marketKind.describe("h2h, h2h_3way, line or total. Leave it out for the main markets."),
        region: z.enum(ARB_REGIONS).optional().describe("Show prices from bookmakers in this region. Default au. Use all for every bookmaker."),
        bookmakers: z.string().optional().describe("Optional comma separated bookmaker keys, at most 20, instead of region"),
        outcome_id: z.string().optional().describe("The outcome (oc_...) you bet on, with odds, to get your bet's closing line value"),
        odds: z.number().gt(1).optional().describe("The decimal odds you took, with outcome_id"),
      },
      annotations: readOnly,
    },
    wrap(more, closingLine),
  );

  server.registerTool(
    "odds_history",
    {
      title: "Price history",
      description: TOOL_TEXT.odds_history,
      inputSchema: {
        event_id: z.string().min(1).describe("Event ID from find_event"),
        market: marketKind.describe("h2h, h2h_3way, line or total. Default h2h."),
        region: z.enum(ARB_REGIONS).optional().describe("Show bookmakers in this region. Default au. Use all for every bookmaker."),
        bookmakers: z.string().optional().describe("Optional comma separated bookmaker keys, at most 20, instead of region"),
        hours: z.number().gt(0).max(24).optional().describe("Hours of history to read, ending at `to`. Default 24 (the most SockOdds allows in one window)."),
        to: z.string().optional().describe("End of the window in UTC, for example 2026-11-19T00:30:00Z. Default: the start time, or now if the event has not started."),
      },
      annotations: readOnly,
    },
    wrap(more, oddsHistory),
  );

  server.registerTool(
    "get_results",
    {
      title: "Results",
      description: TOOL_TEXT.get_results,
      inputSchema: {
        event_id: z.string().optional().describe("One event's result, by its event ID from find_event"),
        league_id: z.string().optional().describe("Results for one league, for example nba, nfl, afl or nrl"),
        days_back: z.number().int().min(1).max(30).optional().describe("With league_id: events that started in this many past days. Default 3."),
        max_results: maxResults,
      },
      annotations: readOnly,
    },
    wrap(more, getResults),
  );

  // ------------------------------------------------------------ 1.3.0: racing

  const raceId = z.string().min(1).describe("Race ID from list_races, for example thoroughbred_2026-11-19_AUS_kestrel_downs_r3");
  const code = z.enum(RACING_CODES).optional().describe("thoroughbred, harness or greyhound. Leave it out for all three.");
  const country = z.enum(RACING_COUNTRIES).optional().describe("AUS (the default), NZL, or all");

  server.registerTool(
    "list_races",
    {
      title: "List races",
      description: TOOL_TEXT.list_races,
      inputSchema: {
        code,
        country,
        meeting: z.string().optional().describe("Only meetings whose track name contains this, for example Randwick"),
        hours_ahead: z.number().gt(0).max(192).optional().describe("Races starting within this many hours. Default 12."),
      },
      annotations: readOnly,
    },
    wrap(more, listRaces),
  );

  server.registerTool(
    "race_odds",
    {
      title: "Race odds",
      description: TOOL_TEXT.race_odds,
      inputSchema: {
        race_id: raceId,
        bookmakers: z.string().optional().describe("Optional comma separated bookmaker keys, at most 20, for example tab,sportsbet,betfair_exchange"),
      },
      annotations: readOnly,
    },
    wrap(more, raceOdds),
  );

  server.registerTool(
    "racing_arbs",
    {
      title: "Racing arbs",
      description: TOOL_TEXT.racing_arbs,
      inputSchema: {
        code,
        country,
        hours_ahead: z.number().gt(0).max(24).optional().describe("Races starting within this many hours. Default 3, at most 24."),
        commission: z.number().min(0).max(0.2).optional().describe("Your Betfair commission as a fraction. Default 0.05 (5%)."),
        min_margin_pct: z.number().min(0).max(100).optional().describe("Only arbs paying at least this percent of the back stake"),
        back_stake: z.number().gt(0).max(1_000_000).optional().describe("Back stake in dollars, to work out the lay stake. Default 100."),
        max_results: maxResults,
      },
      annotations: readOnly,
    },
    wrap(more, racingArbs),
  );

  server.registerTool(
    "racing_movers",
    {
      title: "Racing market movers",
      description: TOOL_TEXT.racing_movers,
      inputSchema: {
        code,
        country,
        hours_ahead: z.number().gt(0).max(24).optional().describe("Races starting within this many hours. Default 3, at most 24."),
        direction: z.enum(["any", "firming", "drifting"]).optional().describe("firming (price shortening), drifting (lengthening) or any. Default any."),
        min_change_pct: z.number().min(0).max(1000).optional().describe("Smallest move to list, in percent of the opening price. Default 10."),
        max_results: maxResults,
      },
      annotations: readOnly,
    },
    wrap(more, racingMovers),
  );

  server.registerTool(
    "race_result",
    {
      title: "Race result",
      description: TOOL_TEXT.race_result,
      inputSchema: { race_id: raceId },
      annotations: readOnly,
    },
    wrap(more, raceResult),
  );

  server.registerTool(
    "race_form",
    {
      title: "Race form",
      description: TOOL_TEXT.race_form,
      inputSchema: {
        race_id: raceId,
        starts: z.number().int().min(1).max(10).optional().describe("Recorded starts per runner, newest first. Default 3."),
      },
      annotations: readOnly,
    },
    wrap(more, raceForm),
  );

  return server;
}
