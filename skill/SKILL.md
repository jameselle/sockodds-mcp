---
name: sockodds-odds
description: Answer "what are the odds on X right now" with live bookmaker prices from the SockOdds API through the sockodds MCP tools. Use when someone asks for odds, prices, the best price, who is favourite, or the fair (no-vig) price for an AFL, NRL, NFL or MLB game, or any league their SockOdds key covers.
---

# Sports odds with SockOdds

The `sockodds` MCP server gives you five tools. Use them whenever someone asks about current odds or
prices for a game: "what are the odds on the grand final", "best price on the Broncos", "who is
favourite tonight", "what is the fair price on the Swans".

## Which tool

1. `find_event` first, unless you already have an event ID. Pass `league_id` whenever you know the
   league (AFL, NRL, NFL, MLB): each event returned costs one object of the free plan's 2,500 a month.
2. Then one of:
   - `get_odds` for every bookmaker's head to head, line and total prices.
   - `best_price` for the single best price on one side, plus the field.
   - `fair_odds` for the no-vig fair price and each bookmaker's margin. It also takes `prices` to
     work out fair odds by hand from numbers the person gives you, with no API call.
3. `list_leagues` only when you are unsure which leagues the key can read.

Do not call the same tool again within a minute for the same thing: responses are cached for 60 s
and the free plan allows only 10 requests a minute.

## How to answer

- Always name the bookmaker for every price you quote.
- Always give the time the price was read (the tool output shows it for each price), and say that
  odds change and may have moved since.
- Quote decimal odds, as Australian bookmakers do.
- Never call a price a tip, a lock, value or a good bet. Do not tell anyone to bet. A fair price is
  an estimate of the chance, not a prediction.
- If the output starts with "DEMO DATA", say clearly that the prices are invented samples, not real odds.
- If a tool says no key is set, pass on the signup link it gives. If it says a rate limit was hit,
  tell the person how long to wait; do not keep calling.
- End every answer that quotes odds with this line:
  "18+. Odds change and nothing here is a tip. Gamble responsibly: Gambling Help Online 1800 858 858."

## Example

> What are the odds on Lions v Crows?

Call `find_event` with `{ "query": "Lions v Crows", "league_id": "AFL" }`, then `best_price` or
`get_odds` with the event ID. Answer along the lines of (made-up prices):

> Brisbane Lions v Adelaide Crows, Saturday 7:35 pm AEST. Best head to head: Lions 1.95 at Unibet
> (read 05:59 UTC), Crows 1.90 at TAB (read 06:01 UTC). Prices move, so check them at the bookmaker.
> 18+. Odds change and nothing here is a tip. Gamble responsibly: Gambling Help Online 1800 858 858.
