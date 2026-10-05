/** Text formatting for tool output. Australian English, no long dashes. */

const BOOK_NAMES: Record<string, string> = {
  sportsbet: "Sportsbet",
  tab: "TAB",
  tabtouch: "TABtouch",
  ladbrokes: "Ladbrokes",
  neds: "Neds",
  unibet: "Unibet",
  pointsbet: "PointsBet",
  bet365: "bet365",
  betfairexchange: "Betfair Exchange",
  pinnacle: "Pinnacle",
  playup: "PlayUp",
  betr: "betr",
  betrsportsbook: "betr (sportsbook)",
  betright: "BetRight",
  dabble: "Dabble",
  picklebet: "Picklebet",
  swiftbet: "SwiftBet",
  kalshi: "Kalshi",
  polymarket: "Polymarket",
  prophetexchange: "ProphetX",
  matchbook: "Matchbook",
};

/** Display name for a bookmakerID. Lane suffixes such as `dabble__pickem` keep their tag. */
export function bookName(id: string): string {
  const [base, lane] = id.split("__");
  const name = BOOK_NAMES[base] ?? base;
  return lane ? `${name} (${lane.replace(/_/g, " ")})` : name;
}

/** "Sat 12 Sep 2026, 7:35 pm AEST (09:35 UTC)" */
export function formatKickoff(iso: string | undefined, timeZone: string): string {
  if (!iso) return "start time not given";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  let local: string;
  try {
    local = new Intl.DateTimeFormat("en-AU", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(d);
  } catch {
    local = d.toUTCString();
  }
  return `${local} (${d.toISOString().slice(11, 16)} UTC)`;
}

/** "11 Sep 06:00:12 UTC" */
export function formatStamp(iso: string | undefined): string {
  if (!iso) return "time not given";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "short" }).format(d);
  return `${day} ${d.toISOString().slice(11, 19)} UTC`;
}

export function formatDecimal(d: number | undefined): string {
  return d === undefined ? "n/a" : d.toFixed(2);
}

/** A handicap shows its sign (+2.5, -2.5); a total does not (165.5). */
export function formatLine(line: number | undefined, signed = true): string {
  if (line === undefined) return "";
  return signed && line > 0 ? `+${line}` : `${line}`;
}

export function pct(fraction: number, dp = 1): string {
  return `${(fraction * 100).toFixed(dp)}%`;
}

/** Replace any en or em dash that came from upstream text. */
export function noLongDashes(s: string): string {
  return s.replace(/[\u2013\u2014]/g, "-");
}
