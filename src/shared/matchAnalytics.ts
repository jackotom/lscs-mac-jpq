import type { MatchDetails, MulliganObservation } from "./decisionInsights.js";
import type { MatchMode, MatchRecord } from "./types.js";

const heroClasses = new Set(["WARRIOR", "SHAMAN", "ROGUE", "PALADIN", "HUNTER", "DRUID", "WARLOCK", "MAGE", "PRIEST", "DEMONHUNTER", "DEATHKNIGHT"]);

/** Shared disk / IPC boundary. Missing observations stay missing. */
export function parseMatchDetails(value: unknown): MatchDetails {
  if (!isRecord(value)) throw new Error("对局详情格式无效");
  const details: {
    friendlyClass?: string; opponentClass?: string; initiative?: "first" | "second";
    durationSeconds?: number; turns?: number; deckKey?: string; mulligan?: MulliganObservation[];
  } = {};
  for (const field of ["friendlyClass", "opponentClass"] as const) {
    if (value[field] === undefined) continue;
    const heroClass = parseText(value[field], field).replace(/[\s_-]+/g, "").toUpperCase();
    if (!heroClasses.has(heroClass)) throw new Error(`对局详情 ${field} 无效`);
    details[field] = heroClass;
  }
  if (value.initiative !== undefined) {
    if (value.initiative !== "first" && value.initiative !== "second") throw new Error("对局详情 initiative 无效");
    details.initiative = value.initiative;
  }
  for (const field of ["durationSeconds", "turns"] as const) {
    const number = value[field];
    if (number === undefined) continue;
    if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || (field === "turns" && !Number.isSafeInteger(number))) {
      throw new Error(`对局详情 ${field} 无效`);
    }
    details[field] = number;
  }
  if (value.deckKey !== undefined) details.deckKey = parseText(value.deckKey, "deckKey");
  if (value.mulligan !== undefined) {
    if (!Array.isArray(value.mulligan)) throw new Error("对局详情 mulligan 无效");
    details.mulligan = value.mulligan.map((entry): MulliganObservation => {
      if (!isRecord(entry) || typeof entry.drawnBeforeMulligan !== "boolean" || typeof entry.keptInMulligan !== "boolean" || typeof entry.inHandAfterMulligan !== "boolean") {
        throw new Error("对局留牌记录无效");
      }
      return {
        cardId: parseText(entry.cardId, "cardId"), cardName: parseText(entry.cardName, "cardName"),
        drawnBeforeMulligan: entry.drawnBeforeMulligan, keptInMulligan: entry.keptInMulligan, inHandAfterMulligan: entry.inHandAfterMulligan
      };
    });
  }
  return details;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`对局详情 ${field} 无效`);
  return value.trim();
}

export interface MatchFilters {
  readonly mode?: MatchMode;
  readonly from?: string;
  readonly to?: string;
  readonly deckKey?: string | null;
  readonly opponentClass?: string | null;
  readonly initiative?: "first" | "second" | null;
}

export function localMatchDay(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function filterMatches(matches: readonly MatchRecord[], filters: MatchFilters): MatchRecord[] {
  return matches.filter((match) => {
    const day = localMatchDay(match.endedAt);
    return (!filters.mode || match.mode === filters.mode)
      && (!filters.from || day >= filters.from)
      && (!filters.to || day <= filters.to)
      && (filters.deckKey === undefined || (match.details?.deckKey ?? null) === filters.deckKey)
      && (filters.opponentClass === undefined || (match.details?.opponentClass ?? null) === filters.opponentClass)
      && (filters.initiative === undefined || (match.details?.initiative ?? null) === filters.initiative);
  });
}

export interface MatchSummary {
  readonly total: number;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly winRate: number | undefined;
}

export interface MatchGroup extends MatchSummary { readonly key: string | null }

export function analyzeMatches(matches: readonly MatchRecord[]) {
  return {
    summary: summarize(matches),
    duration: average(matches, "durationSeconds"),
    turns: average(matches, "turns"),
    initiative: groupMatches(matches, (match) => match.details?.initiative ?? null),
    opponents: groupMatches(matches, (match) => match.details?.opponentClass ?? null),
    decks: groupMatches(matches, (match) => match.details?.deckKey ?? null),
    days: groupMatches(matches, (match) => localMatchDay(match.endedAt)).sort((left, right) => left.key!.localeCompare(right.key!))
  };
}

function summarize(matches: readonly MatchRecord[]): MatchSummary {
  const wins = matches.filter((match) => match.result === "win").length;
  return {
    total: matches.length, wins,
    losses: matches.filter((match) => match.result === "loss").length,
    ties: matches.filter((match) => match.result === "tie").length,
    winRate: matches.length ? wins / matches.length : undefined
  };
}

function average(matches: readonly MatchRecord[], field: "durationSeconds" | "turns") {
  const known = matches.flatMap((match) => match.details?.[field] === undefined ? [] : [match.details[field]!]);
  return { samples: known.length, value: known.length ? known.reduce((total, value) => total + value, 0) / known.length : undefined };
}

function groupMatches(matches: readonly MatchRecord[], keyOf: (match: MatchRecord) => string | null): MatchGroup[] {
  const groups = new Map<string | null, MatchRecord[]>();
  for (const match of matches) {
    const key = keyOf(match);
    const group = groups.get(key) ?? [];
    group.push(match);
    groups.set(key, group);
  }
  return [...groups].map(([key, records]) => ({ key, ...summarize(records) }));
}
