import type { OddsEvent, Outcome, QuotedBookmaker, QuotedMarket } from "./types.js";

/**
 * The tools read prices bookmaker by bookmaker. SockOdds groups them by market by default (each market
 * and outcome once, every bookmaker's price under the outcome), and by bookmaker with group_by=bookmaker.
 * This turns a market-grouped event into the bookmaker grouping, price for price; an event already
 * grouped by bookmaker is returned as it is. Bookmakers come in key order, markets and outcomes in the
 * API's order. `names` maps bookmaker keys to display names; a key with no name shows as the key.
 */
export function byBookmaker(ev: OddsEvent, names: ReadonlyMap<string, string> = new Map()): OddsEvent {
  if (!Array.isArray(ev.markets)) return ev;
  const { markets, ...event } = ev;
  const books = new Map<string, Map<string, QuotedMarket>>();
  for (const m of markets) {
    for (const o of m.outcomes) {
      for (const p of o.prices) {
        const byMarket = books.get(p.bookmaker) ?? new Map<string, QuotedMarket>();
        books.set(p.bookmaker, byMarket);
        const market = byMarket.get(m.id) ?? { id: m.id, key: m.key, name: m.name, subject: m.subject, period: m.period, outcomes: [] };
        byMarket.set(m.id, market);
        const outcome: Outcome = {
          id: o.id, name: o.name, side: o.side, line: o.line,
          decimal_odds: p.decimal_odds, implied_probability: p.implied_probability,
          ...(p.available !== undefined ? { available: p.available } : {}),
          alternate: m.alternate, bookmaker: p.bookmaker, observed_at: p.observed_at,
        };
        market.outcomes.push(outcome);
      }
    }
  }
  const bookmakers: QuotedBookmaker[] = [...books.keys()].sort().map((key) => ({
    key, name: names.get(key) ?? key, markets: [...books.get(key)!.values()],
  }));
  return { ...event, bookmakers };
}
