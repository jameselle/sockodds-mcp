---
name: sockodds-odds
description: Answer "what are the odds on X right now" with live bookmaker prices from SockOdds API v1 through the sockodds MCP tools. Use when someone asks for odds, prices, the best price, who is favourite, or the fair (no-vig) price for an AFL, NRL, NFL, MLB or Rugby League World Cup game, or any league their SockOdds key covers; for arbs, +EV, middles, steam, the closing line, price history or results; or for Australian and New Zealand horse, harness and greyhound racing.
---

# Sports odds with SockOdds

The `sockodds` MCP server gives you nineteen tools. Use them whenever someone asks about current odds or
prices for a game: "what are the odds on the grand final", "best price on the Broncos", "who is
favourite tonight", "what is the fair price on the Swans".

## Which tool

1. `find_event` first, unless you already have an event ID (they look like `ev_000ckk0nc1tg`). Pass
   `league_id` whenever you know the league (nfl, nba, nbl, epl, afl, nrl, mlb): it shows no prices and keeps
   the free plan's 1,000 credits a month for the odds calls.
2. Then one of:
   - `get_odds` for every bookmaker's head to head, line and total prices. Each priced outcome costs
     one more object, so only set `all_markets` when the person wants halves or props.
   - `best_price` for the single best price on one side, plus the field.
   - `fair_odds` for the no-vig fair price and each bookmaker's margin. It also takes `prices` to
     work out fair odds by hand from numbers the person gives you, with no API call.
3. `find_arbs` for arbitrage: two prices at two bookmakers that cover one market for a profit either
   way. It needs a Pro key or the free 7-day Pro trial, and costs 10 credits a page of up to 100 arbs.
   By default it shows only arbs where every bet is at an Australian bookmaker; pass `region: "all"`
   only when the person asks for overseas bookmakers, exchanges or prediction markets too.
4. The other derived lists, all Pro (or the free Pro trial), 10 credits a page, Australian bookmakers by
   default like `find_arbs`:
   - `find_ev` for prices longer than the fair price. Give the EV, the fair price and how it was made,
     and call it an estimate, never a sure thing.
   - `find_middles` for two bets on different lines that both win if the result lands in the gap.
   - `find_low_holds` for the tightest markets (not an arbitrage).
   - `line_moves` (needs `league_id`) for lines that moved and steam.
5. After a game, or about a bet already placed:
   - `closing_line` for opening and closing prices and closing line value; pass `outcome_id` and `odds`
     for the person's own bet (Pro).
   - `odds_history` for how prices moved, summarised per bookmaker (paid plans; costs 10 times the live
     price, so ask for one market).
   - `get_results` for the score and which outcomes won.
6. Racing (paid plans or the Pro trial): `list_races` first to get a race ID (they look like
   `thoroughbred_2026-11-19_AUS_kestrel_downs_r3`, not `ev_`), then `race_odds`, `race_form` or
   `race_result`. `racing_arbs` and `racing_movers` need Pro. Australian races are the default.
7. `list_leagues` only when you are unsure of a league key.

Event IDs from older versions of this server (such as `afl_2026-09-12_...`) no longer work. Run
`find_event` again to get the current ID.

Do not call the same tool again within a minute for the same thing: responses are cached for 60 s
and the free plan allows only 10 requests a minute.

## How to answer

- Always name the bookmaker for every price you quote.
- Always give the time SockOdds saw the price (the tool output shows it for each price), and say that
  odds change and may have moved since.
- Quote decimal odds, as Australian bookmakers do.
- Never call a price a tip, a lock, value or a good bet. Do not tell anyone to bet. A fair price is
  an estimate of the chance, not a prediction.
- If the output starts with "DEMO DATA", say clearly that the prices are invented samples, not real odds.
- If a tool says no key is set, pass on the signup link it gives. If it says a rate limit was hit,
  tell the person how long to wait; do not keep calling. If it says the monthly allowance is used or
  the plan does not cover a league, say so plainly; asking again will not help.
- If a tool says the key's plan does not include it, pass on which plans do and the free Pro trial it
  describes; do not retry.
- For an arb, give each bet's bookmaker, price and stake, and say that it only pays if every bet is
  accepted at those prices: prices move within minutes and bookmakers can refuse or limit bets.
- End every answer that quotes odds with this line:
  "18+. Odds change and nothing here is a tip. Gamble responsibly: Gambling Help Online 1800 858 858."

## Example

> What are the odds on Lions v Crows?

Call `find_event` with `{ "query": "Lions v Crows", "league_id": "afl" }`, then `best_price` or
`get_odds` with the event ID. Answer along the lines of (made-up prices):

> Brisbane Lions v Adelaide Crows, Saturday 7:35 pm AEST. Best head to head: Lions 1.95 at Unibet
> (seen 05:59 UTC), Crows 1.90 at TAB (seen 06:01 UTC). Prices move, so check them at the bookmaker.
> 18+. Odds change and nothing here is a tip. Gamble responsibly: Gambling Help Online 1800 858 858.
