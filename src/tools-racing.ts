/**
 * 1.3.0 racing tools: Australian and New Zealand thoroughbred, harness and greyhound races under
 * /v1/racing/ (https://sockodds.com/docs/racing/). Racing needs a paid plan or the Pro trial; movers and
 * racing arbs need Pro. Same patterns as find_arbs in tools.ts.
 */
import { RESPONSIBLE_GAMBLING } from "./config.js";
import type { Params } from "./client.js";
import { SockOddsError } from "./errors.js";
import { bookName, dollars, formatClock, formatDay, formatDecimal, formatKickoff, formatStamp, ordinal, pct } from "./format.js";
import { bookmakersParam, finish, isFresh, nowOf, readLine, readPages, utc, withPlan } from "./tools.js";
import type { MoreDeps } from "./tools-analysis.js";
import type { Race, RacePrice, RacingCode, RunnerForm } from "./types.js";

export const RACING_CODES = ["thoroughbred", "harness", "greyhound"] as const;
export const RACING_COUNTRIES = ["AUS", "NZL", "all"] as const;
export type RacingCountry = (typeof RACING_COUNTRIES)[number];

/** A SockOdds race id, from the contract: code, date, then meeting and race number. */
const RACE_ID = /^(thoroughbred|harness|greyhound)_\d{4}-\d{2}-\d{2}_[A-Za-z0-9_.-]{1,120}$/;

const RACING = { what: "racing", feature: "Racing", tier: "paid" as const };
const PRICE_NOTE = "Prices move fast close to the jump: check every price at the bookmaker before betting.";

export function checkRaceID(raceID: string): string {
  const id = raceID.trim();
  if (RACE_ID.test(id)) return id;
  throw new SockOddsError(
    `"${raceID}" is not a SockOdds race ID. Race IDs name the code, date, country, meeting and race number, for example thoroughbred_2026-11-19_AUS_kestrel_downs_r3. Use list_races to get one; they are not the ev_ IDs sport uses.`,
  );
}

/** Calls a one-race route: a 403 explains the plan, a 404 points at list_races. */
async function oneRace<T>(load: () => Promise<T>, plan: { what: string; feature: string; tier: "pro" | "paid" } = RACING): Promise<T> {
  try {
    return await withPlan(load, plan.what, plan.feature, plan.tier);
  } catch (err) {
    if (err instanceof SockOddsError && err.status === 404) {
      throw new SockOddsError(
        `SockOdds has no race with that ID (HTTP 404, Not found).${err.detail ? ` SockOdds said: "${err.detail}".` : ""} Use list_races to get a current race ID.`,
        404,
        undefined,
        err.title,
        err.detail,
      );
    }
    throw err;
  }
}

function countryParam(country: RacingCountry | undefined): string | undefined {
  const c = country ?? "AUS";
  return c === "all" ? undefined : c;
}

function countryWords(country: RacingCountry | undefined): string {
  const c = country ?? "AUS";
  return c === "all" ? "Australian and New Zealand" : c === "NZL" ? "New Zealand" : "Australian";
}

function raceTitle(race: Pick<Race, "meeting" | "race_number"> & { name?: string | null }): string {
  const meeting = race.meeting?.name ?? "Meeting not given";
  return `${meeting} R${race.race_number ?? "?"}`;
}

function raceWhere(race: Pick<Race, "code" | "meeting">): string {
  const place = race.meeting?.state ?? (race.meeting?.country === "NZL" ? "NZ" : race.meeting?.country);
  return `${race.code}${place ? `, ${place}` : ""}`;
}

function startWindow(deps: MoreDeps, hours: number, maxHours: number): string {
  if (!(hours > 0 && hours <= maxHours)) throw new SockOddsError(`hours_ahead must be more than 0 and at most ${maxHours}.`);
  return utc(new Date(nowOf(deps).getTime() + hours * 3_600_000));
}

// ---------------------------------------------------------------- list_races

export interface ListRacesArgs {
  code?: RacingCode;
  country?: RacingCountry;
  meeting?: string;
  hours_ahead?: number;
}

const RACES_SHOWN = 60;

export async function listRaces(deps: MoreDeps, args: ListRacesArgs): Promise<string> {
  const hours = args.hours_ahead ?? 12;
  const now = nowOf(deps);
  const params: Params = {
    code: args.code,
    country: countryParam(args.country),
    // Races that jumped in the last half hour are still listed, for results and late scratchings.
    starts_after: utc(new Date(now.getTime() - 30 * 60_000)),
    starts_before: startWindow(deps, hours, 192),
    limit: 100,
  };
  const { pages, all, moreUnread } = await withPlan(() => readPages((cursor) => deps.source.races({ ...params, cursor }), 3), RACING.what, RACING.feature, RACING.tier);
  const wanted = args.meeting?.trim().toLowerCase();
  const races = wanted ? all.filter((r) => (r.meeting?.name ?? "").toLowerCase().includes(wanted)) : all;
  const scope = `${countryWords(args.country)} ${args.code ?? "thoroughbred, harness and greyhound"} races in the next ${hours} hours${wanted ? `, meetings matching "${args.meeting}"` : ""}`;
  const lines = [...readLine(pages[0], deps), "", `${scope.charAt(0).toUpperCase()}${scope.slice(1)}:`];
  if (races.length === 0) lines.push(`  None. Try more hours_ahead${wanted ? ", another meeting name" : ""}${args.code ? " or another code" : ""}.`);
  // Group by meeting and day, in start order.
  const groups = new Map<string, Race[]>();
  for (const r of races.slice(0, RACES_SHOWN)) {
    const key = `${r.meeting?.name}|${r.code}|${formatDay(r.scheduled_start, deps.timeZone)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const list of groups.values()) {
    const first = list[0];
    const track = list.map((r) => r.track_condition).find(Boolean);
    lines.push("", `${first.meeting?.name ?? "Meeting not given"} (${raceWhere(first)}), ${formatDay(first.scheduled_start, deps.timeZone)}${track ? `, track ${track}` : ""}`);
    for (const r of list) {
      const detail = [r.name, r.distance_m ? `${r.distance_m} m` : "", r.class_conditions ?? ""].filter(Boolean).join(", ");
      const state = r.status && r.status !== "open" ? ` [${r.status}]` : r.jumped_at ? " [jumped]" : "";
      lines.push(`  R${r.race_number ?? "?"} ${formatClock(r.scheduled_start, deps.timeZone)}${detail ? `, ${detail}` : ""}${state}: ${r.id}`);
    }
  }
  if (races.length > RACES_SHOWN) lines.push("", `${races.length - RACES_SHOWN} more races not shown. Pass code, meeting or fewer hours_ahead to narrow the list.`);
  if (moreUnread) lines.push("", "SockOdds has more races than were read. Pass code, country or fewer hours_ahead to narrow the list.");
  lines.push("", "Next: race_odds with a race ID for every bookmaker's win and place prices, race_form for the runners' recent starts. The race list costs no credits.");
  return finish(lines);
}

// ---------------------------------------------------------------- race_odds

export interface RaceOddsArgs {
  race_id: string;
  bookmakers?: string;
}

function best(prices: RacePrice[], field: "win" | "place"): RacePrice[] {
  const fixed = prices.filter((p) => p.available && p.bookmaker !== "betfair_exchange" && typeof p[field] === "number");
  const top = Math.max(...fixed.map((p) => p[field]!));
  return fixed.filter((p) => p[field] === top);
}

export async function raceOdds(deps: MoreDeps, args: RaceOddsArgs): Promise<string> {
  const raceId = checkRaceID(args.race_id);
  const bookmakers = bookmakersParam(args.bookmakers);
  const fetched = await oneRace(() => deps.source.raceOdds(raceId, { bookmakers }));
  const { race, runners } = fetched.data;
  const lines = [
    ...readLine(fetched, deps),
    "",
    `${raceTitle(race)}${race.name ? `, ${race.name}` : ""}${race.distance_m ? `, ${race.distance_m} m` : ""} (${raceWhere(race)})`,
    `Starts: ${formatKickoff(race.scheduled_start, deps.timeZone)}${race.status && race.status !== "open" ? `. Status: ${race.status}` : race.jumped_at ? ". Jumped: prices are no longer available" : ""}`,
    `Race ID: ${race.id}`,
  ];
  const books = new Set<string>();
  const sorted = [...runners].sort((a, b) => (a.number ?? 99) - (b.number ?? 99));
  for (const r of sorted) {
    const head = `${r.number ?? "?"}. ${r.name ?? "Runner not named"}${r.barrier ? ` (barrier ${r.barrier})` : ""}`;
    if (r.scratched) {
      lines.push("", `${head}: SCRATCHED`);
      continue;
    }
    for (const p of r.prices) books.add(p.bookmaker);
    lines.push("", head);
    const bw = best(r.prices, "win"), bp = best(r.prices, "place");
    const bestText = [
      bw.length ? `best win ${formatDecimal(bw[0].win)} at ${bw.map((p) => bookName(p.bookmaker, p.bookmaker_name)).join(" and ")}` : "no available fixed win price",
      bp.length ? `best place ${formatDecimal(bp[0].place)} at ${bp.map((p) => bookName(p.bookmaker, p.bookmaker_name)).join(" and ")}` : "",
    ].filter(Boolean).join(", ");
    lines.push(`   ${bestText.charAt(0).toUpperCase()}${bestText.slice(1)}`);
    const bf = r.prices.find((p) => p.bookmaker === "betfair_exchange");
    if (bf && (bf.win !== undefined || bf.win_lay !== undefined)) {
      const back = bf.win !== undefined ? `back ${formatDecimal(bf.win)}${bf.win_back_size !== undefined ? ` (${dollars(bf.win_back_size)} available)` : ""}` : "no back price";
      const lay = bf.win_lay !== undefined ? `lay ${formatDecimal(bf.win_lay)}${bf.win_lay_size !== undefined ? ` (${dollars(bf.win_lay_size)})` : ""}` : "no lay price";
      lines.push(`   Betfair Exchange win: ${back}, ${lay}${bf.win_matched !== undefined ? `, ${dollars(bf.win_matched)} matched` : ""}${bf.available ? "" : " (not available)"}`);
    }
    const fixed = r.prices.filter((p) => p.bookmaker !== "betfair_exchange" && typeof p.win === "number").sort((a, b) => Number(b.available) - Number(a.available) || b.win! - a.win!);
    if (fixed.length) {
      lines.push(
        `   Win/place: ${fixed.map((p) => `${bookName(p.bookmaker, p.bookmaker_name)} ${formatDecimal(p.win)}${p.place !== undefined ? `/${formatDecimal(p.place)}` : ""}${p.available ? "" : " (not available)"}`).join(", ")}`,
      );
      const times = fixed.map((p) => p.observed_at).filter((t): t is string => !!t).sort();
      if (times.length) lines.push(`   Seen ${times[0] === times[times.length - 1] ? formatStamp(times[0]) : `${formatStamp(times[0])} to ${formatStamp(times[times.length - 1])}`}`);
    }
  }
  if (runners.length === 0) lines.push("", "No runners are listed for this race yet.");
  lines.push("", "Prices are decimal, exactly as each bookmaker showed them. A price is available while the race has not jumped and was seen in the last 10 minutes.", PRICE_NOTE);
  if (isFresh(fetched, deps) && books.size > 0) {
    const regions = Math.ceil((bookmakers ? bookmakers.split(",").length : books.size) / 10);
    lines.push("", `This answer used about ${regions} credit${regions === 1 ? "" : "s"} (1 for every 10 bookmakers).`);
  }
  lines.push("", RESPONSIBLE_GAMBLING);
  return finish(lines);
}

// ---------------------------------------------------------------- racing_arbs

export interface RacingArbsArgs {
  code?: RacingCode;
  country?: RacingCountry;
  hours_ahead?: number;
  commission?: number;
  min_margin_pct?: number;
  back_stake?: number;
  max_results?: number;
}

export async function racingArbs(deps: MoreDeps, args: RacingArbsArgs): Promise<string> {
  const hours = args.hours_ahead ?? 3;
  const commission = args.commission ?? 0.05;
  const stake = args.back_stake ?? 100;
  const fetched = await withPlan(
    () =>
      deps.source.racingArbs({
        code: args.code,
        country: countryParam(args.country),
        starts_before: startWindow(deps, hours, 24),
        commission: args.commission,
        min_margin: args.min_margin_pct === undefined ? undefined : args.min_margin_pct / 100,
        limit: 50,
      }),
    "racing arbs",
    "Racing arbs",
  );
  const arbs = fetched.data;
  const shown = arbs.slice(0, args.max_results ?? 10);
  const lines = [
    ...readLine(fetched, deps),
    "",
    `Racing arbs (bookmaker win price against the Betfair Exchange win lay), ${countryWords(args.country)} ${args.code ?? ""} races in the next ${hours} hours:`.replace("  ", " "),
  ];
  if (arbs.length === 0) lines.push("  None right now. The list is recomputed every 20 seconds from prices seen in the last 10 minutes.");
  else lines.push(`Showing ${shown.length} of ${arbs.length}, best margin first. Backing ${dollars(stake)} each, with ${pct(commission, commission * 100 % 1 ? 1 : 0)} exchange commission.`);
  shown.forEach((a, i) => {
    const lay = stake * a.lay_stake_per_unit;
    const liability = lay * (a.lay.decimal_odds - 1);
    lines.push(
      "",
      `${i + 1}. ${pct(a.margin, 2)} profit on the back stake. ${raceTitle(a.race)} (${raceWhere(a.race)}), ${formatKickoff(a.race.scheduled_start, deps.timeZone)}`,
      `   Runner: ${a.runner_number ?? "?"}. ${a.runner_name ?? "not named"}`,
      `   Back ${dollars(stake)} at ${formatDecimal(a.back.decimal_odds)} with ${bookName(a.back.bookmaker)} (seen ${formatStamp(a.back.observed_at)})`,
      `   Lay ${dollars(lay)} at ${formatDecimal(a.lay.decimal_odds)} on ${bookName(a.lay.bookmaker)} (liability ${dollars(liability)}; seen ${formatStamp(a.lay.observed_at)})`,
    );
    if (a.lay.size !== null && a.lay.size !== undefined) {
      lines.push(
        a.lay.size < lay
          ? `   Only ${dollars(a.lay.size)} is available at that lay price, less than the lay stake: the rest would be laid at a worse price.`
          : `   ${dollars(a.lay.size)} is available at that lay price.`,
      );
    }
    lines.push(`   Either way the race goes, you keep about ${dollars(stake * a.margin)} after commission.`);
  });
  if (arbs.length > shown.length) lines.push("", `${arbs.length - shown.length} more not shown. Pass min_margin_pct or max_results.`);
  lines.push(
    "",
    "A racing arb only pays if the back bet is accepted at that price and the lay is matched at that price. Prices move fast near the jump and bookmakers can refuse or limit bets; check both prices before betting. Place markets are not compared.",
  );
  if (isFresh(fetched, deps) && arbs.length > 0) lines.push("", "This answer used 10 credits.");
  lines.push("", RESPONSIBLE_GAMBLING);
  return finish(lines);
}

// ---------------------------------------------------------------- racing_movers

export interface RacingMoversArgs {
  code?: RacingCode;
  country?: RacingCountry;
  hours_ahead?: number;
  direction?: "any" | "firming" | "drifting";
  min_change_pct?: number;
  max_results?: number;
}

export async function racingMovers(deps: MoreDeps, args: RacingMoversArgs): Promise<string> {
  const hours = args.hours_ahead ?? 3;
  const fetched = await withPlan(
    () =>
      deps.source.racingMovers({
        code: args.code,
        country: countryParam(args.country),
        starts_before: startWindow(deps, hours, 24),
        direction: args.direction,
        min_change: args.min_change_pct === undefined ? undefined : args.min_change_pct / 100,
        limit: 50,
      }),
    "market movers",
    "Market movers",
  );
  const movers = fetched.data;
  const shown = movers.slice(0, args.max_results ?? 10);
  const dir = args.direction && args.direction !== "any" ? `${args.direction} ` : "";
  const lines = [...readLine(fetched, deps), "", `Market movers (${dir}win price against its opening price), ${countryWords(args.country)} ${args.code ?? ""} races in the next ${hours} hours:`.replace("  ", " ")];
  if (movers.length === 0) lines.push("  None right now. Only prices seen in the last 10 minutes count.");
  else lines.push(`Showing ${shown.length} of ${movers.length}, biggest move first.`);
  shown.forEach((m, i) => {
    const word = m.change < 0 ? "Firming" : "Drifting";
    lines.push(
      "",
      `${i + 1}. ${word} ${Math.abs(m.change * 100).toFixed(0)}%: ${m.runner_number ?? "?"}. ${m.runner_name ?? "not named"}, ${raceTitle(m.race)} (${raceWhere(m.race)}), ${formatKickoff(m.race.scheduled_start, deps.timeZone)}`,
      `   Opened ${formatDecimal(m.opening.decimal_odds)} at ${bookName(m.opening.bookmaker)} (${formatStamp(m.opening.observed_at)}); now median ${formatDecimal(m.current.median)} across ${m.current.bookmaker_count} bookmaker${m.current.bookmaker_count === 1 ? "" : "s"}, best ${formatDecimal(m.current.best)} at ${bookName(m.current.best_bookmaker)} (seen ${formatStamp(m.current.observed_at)})`,
    );
  });
  if (movers.length > shown.length) lines.push("", `${movers.length - shown.length} more not shown. Pass min_change_pct or max_results.`);
  lines.push("", "Firming means the price shortened (more money for the runner); drifting means it lengthened. The median leaves out Betfair Exchange. A move is not a tip.");
  if (isFresh(fetched, deps) && movers.length > 0) lines.push("", "This answer used 10 credits.");
  lines.push("", RESPONSIBLE_GAMBLING);
  return finish(lines);
}

// ---------------------------------------------------------------- race_result

export interface RaceResultArgs {
  race_id: string;
}

const POOL_WORDS: Record<string, string> = { win: "Win", place: "Place", quinella: "Quinella", exacta: "Exacta", trifecta: "Trifecta", first_four: "First four", duet: "Duet" };

export async function raceResult(deps: MoreDeps, args: RaceResultArgs): Promise<string> {
  const raceId = checkRaceID(args.race_id);
  const fetched = await oneRace(() => deps.source.raceResult(raceId));
  const { race, result } = fetched.data;
  const head = race.meeting ? `${raceTitle(race as Race)}${race.name ? `, ${race.name}` : ""}${race.code ? ` (${raceWhere(race as Race)})` : ""}` : race.id;
  const lines = [...readLine(fetched, deps), "", head];
  if (race.scheduled_start) lines.push(`Started: ${formatKickoff(race.scheduled_start, deps.timeZone)}`);
  lines.push(`Race ID: ${race.id}`);
  if (!result) {
    lines.push("", "Not resulted yet. A result can take a few hours after the race to appear; a race no source has resulted within 24 hours stays without one.");
    return finish(lines);
  }
  lines.push("", "Placings (TAB fixed win/place, tote win/place, Betfair SP win):");
  for (const p of [...result.placings].sort((a, b) => a.position - b.position)) {
    const fixed = p.fixed_win != null ? `fixed ${formatDecimal(p.fixed_win)}${p.fixed_place != null ? `/${formatDecimal(p.fixed_place)}` : ""}` : "";
    const tote = p.tote_win != null ? `tote ${formatDecimal(p.tote_win)}${p.tote_place != null ? `/${formatDecimal(p.tote_place)}` : ""}` : p.tote_place != null ? `tote place ${formatDecimal(p.tote_place)}` : "";
    const bsp = p.bsp_win != null ? `BSP ${formatDecimal(p.bsp_win)}` : "";
    const prices = [fixed, tote, bsp].filter(Boolean).join(", ");
    lines.push(`  ${ordinal(p.position)}: ${p.runner_number}. ${p.name ?? "not named"}${prices ? `, ${prices}` : ""}`);
  }
  if (result.scratched?.length) {
    lines.push(
      "",
      `Scratched: ${result.scratched
        .map((s) => {
          const ded = [s.win_deduction != null ? `win deduction ${formatDecimal(s.win_deduction)}` : "", s.place_deduction != null ? `place ${formatDecimal(s.place_deduction)}` : ""].filter(Boolean).join(", ");
          return `${s.runner_number}${ded ? ` (${ded})` : ""}`;
        })
        .join("; ")}`,
    );
  }
  const divs = (result.dividends ?? []).filter((d) => d.dividend !== null);
  if (divs.length) {
    lines.push("", "Tote dividends (per $1):");
    const byPool = new Map<string, string[]>();
    for (const d of divs) byPool.set(d.pool, [...(byPool.get(d.pool) ?? []), `${d.selections.join("-")} ${dollars(d.dividend!)}`]);
    for (const [pool, list] of byPool) lines.push(`  ${POOL_WORDS[pool] ?? pool.replace(/_/g, " ")}: ${list.join(", ")}`);
  }
  if (result.recorded_at) lines.push("", `Result recorded ${formatStamp(result.recorded_at)}. Betfair SP arrives the day after the race.`);
  if (isFresh(fetched, deps)) lines.push("", "This answer used 1 credit.");
  return finish(lines);
}

// ---------------------------------------------------------------- race_form

export interface RaceFormArgs {
  race_id: string;
  starts?: number;
}

export async function raceForm(deps: MoreDeps, args: RaceFormArgs): Promise<string> {
  const raceId = checkRaceID(args.race_id);
  const starts = args.starts ?? 3;
  const fetched = await oneRace(() => deps.source.raceForm(raceId, { limit: starts }));
  const data = fetched.data;
  const runners: RunnerForm[] = Array.isArray(data) ? data : (data.runners ?? []);
  const lines = [...readLine(fetched, deps), "", `Form for ${raceId} (last ${starts} recorded start${starts === 1 ? "" : "s"} per runner, newest first):`];
  if (runners.length === 0) lines.push("  No runners are listed for this race yet.");
  for (const r of [...runners].sort((a, b) => (a.number ?? 99) - (b.number ?? 99))) {
    lines.push("", `${r.number ?? "?"}. ${r.name ?? "not named"}${r.form_figures ? `, form ${r.form_figures}` : ""}`);
    if (!r.starts.length) lines.push("   No starts recorded since 1 August 2026.");
    for (const s of r.starts.slice(0, starts)) {
      const where = [s.meeting?.name, s.race_number ? `R${s.race_number}` : "", s.distance_m ? `${s.distance_m} m` : "", s.class_conditions ?? "", s.track_condition ?? ""].filter(Boolean).join(" ");
      const finish = s.position ? `${ordinal(s.position)}` : "unplaced (5th or worse)";
      const field = s.field_size ? ` of ${s.field_size}` : "";
      const who = [s.jockey, s.trainer ? `trainer ${s.trainer}` : "", s.barrier ? `barrier ${s.barrier}` : "", s.weight_kg ? `${s.weight_kg} kg` : ""].filter(Boolean).join(", ");
      const sp = [s.fixed_win != null ? `fixed ${formatDecimal(s.fixed_win)}` : "", s.tote_win != null ? `tote ${formatDecimal(s.tote_win)}` : "", s.bsp != null ? `BSP ${formatDecimal(s.bsp)}` : ""].filter(Boolean).join(", ");
      lines.push(`   ${formatDay(s.start, deps.timeZone)} ${where}: ${finish}${field}${who ? `, ${who}` : ""}${sp ? ` (started ${sp})` : ""}`);
    }
  }
  lines.push("", "Form is the starts SockOdds recorded itself, from 1 August 2026, not a runner's full career. Figures are newest last; x is a spell.");
  if (isFresh(fetched, deps) && runners.length > 0) lines.push("", "This answer used 1 credit.");
  return finish(lines);
}
