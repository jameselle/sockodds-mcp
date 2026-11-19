/** Text formatting for tool output. Australian English, no long dashes. */

/** Display names for common bookmaker keys, used when a response does not carry the name. */
const BOOK_NAMES: Record<string, string> = {
  sportsbet: "Sportsbet",
  tab: "TAB",
  tabtouch: "TABtouch",
  ladbrokes: "Ladbrokes",
  neds: "Neds",
  unibet: "Unibet",
  pointsbet: "PointsBet",
  bet365: "bet365",
  betfair_exchange: "Betfair Exchange",
  pinnacle: "Pinnacle",
  playup: "PlayUp",
  betr: "Betr",
  betright: "BetRight",
  dabble: "Dabble",
  picklebet: "Picklebet",
  swiftbet: "SwiftBet",
  kalshi: "Kalshi",
  polymarket: "Polymarket",
  matchbook: "Matchbook",
};

/** Display name for a bookmaker key, preferring the name SockOdds sent. */
export function bookName(key: string, sentName?: string): string {
  return sentName || BOOK_NAMES[key] || key;
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

/** "1:40 pm AEDT (02:40 UTC)": a start time on a day already named. */
export function formatClock(iso: string | undefined, timeZone: string): string {
  if (!iso) return "start time not given";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  let local: string;
  try {
    local = new Intl.DateTimeFormat("en-AU", { timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d);
  } catch {
    local = d.toUTCString();
  }
  return `${local} (${d.toISOString().slice(11, 16)} UTC)`;
}

/** "Thu 19 Nov" in the given time zone. */
export function formatDay(iso: string | undefined, timeZone: string): string {
  if (!iso) return "date not given";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-AU", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(d).replace(",", "");
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** A percentage that is already in percent, with its sign: "+4.61%", "-1.27%". */
export function signedPct(percent: number, dp = 2): string {
  return `${percent > 0 ? "+" : ""}${percent.toFixed(dp)}%`;
}

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st ... */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** "$1,234.50" */
export function dollars(n: number): string {
  return `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
