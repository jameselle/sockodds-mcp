/** Match a free-text question like "AFL grand final" or "Broncos v Bulldogs" to events. Pure functions. */
import { eventStart } from "./markets.js";
import type { SockEvent } from "./types.js";

/** Words in a question that name a league. Keys are lower case; values are SockOdds leagueIDs. */
const LEAGUE_WORDS: Array<[string, string]> = [
  ["state of origin", "RUGBYLEAGUE_STATE_ORIGIN"],
  ["premier league", "EPL"],
  ["champions league", "UCL"],
  ["la liga", "LA_LIGA"],
  ["serie a", "IT_SERIE_A"],
  ["origin", "RUGBYLEAGUE_STATE_ORIGIN"],
  ["aflw", "AFLW"],
  ["nrlw", "RUGBYLEAGUE_NRLW"],
  ["afl", "AFL"],
  ["nrl", "NRL"],
  ["nfl", "NFL"],
  ["mlb", "MLB"],
  ["nba", "NBA"],
  ["nhl", "NHL"],
  ["epl", "EPL"],
  ["ucl", "UCL"],
  ["mls", "MLS"],
  ["ufc", "UFC"],
  ["ipl", "IPL"],
  ["ncaaf", "NCAAF"],
  ["atp", "ATP"],
  ["wta", "WTA"],
  ["f1", "F1"],
  ["bundesliga", "BUNDESLIGA"],
];

/** Words that carry no team information. */
const STOP_WORDS = new Set(
  (
    "a an and are at be best between can check for from game games get grand final finals football footy " +
    "how in is it league match matches me next now odd odds of on or preliminary prelim price prices qualifying " +
    "elimination semi right round show the this today tonight tomorrow v vs versus weekend week what whats who will win wins " +
    "with h2h head to"
  ).split(/\s+/),
);

/** Club nicknames people use, mapped to a word in the club's listed name. */
const NICKNAMES: Record<string, string[]> = {
  // AFL
  bombers: ["essendon"],
  blues: ["carlton"],
  pies: ["collingwood"],
  magpies: ["collingwood"],
  dees: ["melbourne"],
  demons: ["melbourne"],
  cats: ["geelong"],
  hawks: ["hawthorn"],
  dockers: ["fremantle"],
  freo: ["fremantle"],
  eagles: ["west", "coast", "manly"],
  saints: ["st", "kilda"],
  tigers: ["richmond", "wests"],
  swans: ["sydney"],
  dogs: ["bulldogs"],
  roos: ["north"],
  kangaroos: ["north"],
  power: ["port"],
  suns: ["gold"],
  giants: ["gws", "greater"],
  crows: ["adelaide"],
  lions: ["brisbane"],
  // NRL
  souths: ["south"],
  bunnies: ["rabbitohs", "south"],
  manly: ["manly", "sea"],
  cows: ["cowboys"],
  dragons: ["dragons", "george"],
};

export interface ParsedQuery {
  leagueIDs: string[];
  tokens: string[];
}

export function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseQuery(query: string): ParsedQuery {
  let q = ` ${normalise(query)} `;
  const leagueIDs: string[] = [];
  for (const [word, id] of LEAGUE_WORDS) {
    const re = new RegExp(` ${word} `, "g");
    if (re.test(q)) {
      if (!leagueIDs.includes(id)) leagueIDs.push(id);
      q = q.replace(re, " ");
    }
  }
  const tokens = q
    .split(" ")
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t) && !/^\d+$/.test(t));
  return { leagueIDs, tokens };
}

function haystack(ev: SockEvent): string[] {
  const parts: string[] = [ev.eventID, ev.info?.displayName ?? ""];
  for (const side of ["home", "away"] as const) {
    const t = ev.teams?.[side];
    if (!t) continue;
    parts.push(t.names?.long ?? "", t.names?.medium ?? "", t.names?.short ?? "", (t.teamID ?? "").replace(/_/g, " "));
  }
  return normalise(parts.join(" ").replace(/_/g, " ")).split(" ").filter(Boolean);
}

function tokenMatches(token: string, words: string[]): boolean {
  const options = [token, ...(NICKNAMES[token] ?? [])];
  return options.some((o) => words.some((w) => w === o || (o.length >= 3 && w.startsWith(o))));
}

export interface EventMatch {
  event: SockEvent;
  /** Share of the question's team words found in this event, 0 to 1. 1 when the question named no team. */
  score: number;
}

/**
 * Rank events against the question. With no team words (for example "AFL grand final"),
 * every event matches and the soonest comes first.
 */
export function matchEvents(events: SockEvent[], parsed: ParsedQuery): EventMatch[] {
  const start = (e: SockEvent) => Date.parse(eventStart(e) ?? "") || Number.MAX_SAFE_INTEGER;
  const scored = events.map((event) => {
    if (parsed.tokens.length === 0) return { event, score: 1 };
    const words = haystack(event);
    const hits = parsed.tokens.filter((t) => tokenMatches(t, words)).length;
    return { event, score: hits / parsed.tokens.length };
  });
  return scored
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || start(a.event) - start(b.event));
}
