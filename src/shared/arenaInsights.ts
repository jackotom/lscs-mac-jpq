import type { DeckCard } from "./types.js";

export interface ArenaDeckCard extends DeckCard {
  readonly score?: number;
}

export interface ArenaReward {
  readonly type: "gold" | "dust" | "pack" | "card" | "other";
  readonly amount?: number;
  readonly name?: string;
  readonly cardId?: string;
}

export interface ArenaMulliganRecord {
  readonly cardName: string;
  readonly cardId?: string;
  readonly drawnBeforeMulligan: boolean;
  readonly keptInMulligan: boolean;
  readonly inHandAfterMulligan: boolean;
  readonly won: boolean;
}

export interface ArenaRunRecord {
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly hero?: string;
  readonly wins: number;
  readonly losses: number;
  readonly deckScore?: number;
  readonly deck: readonly ArenaDeckCard[];
  readonly rewards: readonly ArenaReward[];
  readonly mulligan: readonly ArenaMulliganRecord[];
  readonly recordedMatchIds: readonly string[];
}

export interface ArenaPersonalSummary {
  readonly runCount: number;
  readonly totalWins: number;
  readonly totalLosses: number;
  readonly winRate: number;
}

export interface ArenaMulliganStat {
  readonly cardName: string;
  readonly cardId?: string;
  readonly drawnBeforeMulligan: number;
  readonly kept: number;
  readonly inHandAfterMulligan: number;
  readonly wins: number;
  readonly winRate: number;
}

export type ArenaInsightsResult =
  | {
      readonly status: "ok";
      readonly source: "本机竞技场档案";
      readonly updatedAt: string;
      readonly runs: readonly ArenaRunRecord[];
      readonly summary?: ArenaPersonalSummary;
      readonly highWinDecks: readonly ArenaRunRecord[];
      readonly mulliganStats: readonly ArenaMulliganStat[];
    }
  | {
      readonly status: "error";
      readonly source: "本机竞技场档案";
      readonly updatedAt: string;
      readonly error: string;
      readonly runs?: readonly ArenaRunRecord[];
      readonly summary?: ArenaPersonalSummary;
      readonly highWinDecks?: readonly ArenaRunRecord[];
      readonly mulliganStats?: readonly ArenaMulliganStat[];
    };

export function parseArenaRunRecord(value: unknown): ArenaRunRecord {
  if (!isRecord(value)) throw new Error("竞技场轮次必须是对象");
  const { id, startedAt, endedAt, hero, wins, losses, deckScore, deck, rewards, mulligan, recordedMatchIds } = value;
  if (!nonEmptyString(id) || !isoDate(startedAt) || (endedAt !== undefined && !isoDate(endedAt))) {
    throw new Error("竞技场轮次时间或标识无效");
  }
  if ((hero !== undefined && typeof hero !== "string") || !nonNegativeInteger(wins) || !nonNegativeInteger(losses)) {
    throw new Error("竞技场轮次胜负或职业无效");
  }
  if (deckScore !== undefined && !finiteNonNegative(deckScore)) throw new Error("竞技场套牌评分无效");
  if (!Array.isArray(deck) || !Array.isArray(rewards) || !Array.isArray(mulligan)) {
    throw new Error("竞技场轮次列表无效");
  }
  if (recordedMatchIds !== undefined && (!Array.isArray(recordedMatchIds) || !recordedMatchIds.every(nonEmptyString))) {
    throw new Error("竞技场对局标识无效");
  }
  return {
    id,
    startedAt,
    ...(endedAt ? { endedAt } : {}),
    ...(hero ? { hero } : {}),
    wins,
    losses,
    ...(deckScore !== undefined ? { deckScore } : {}),
    deck: deck.map(parseDeckCard),
    rewards: rewards.map(parseReward),
    mulligan: mulligan.map(parseMulligan),
    recordedMatchIds: [...new Set((recordedMatchIds ?? []) as string[])]
  };
}

export function parseArenaRuns(value: unknown): ArenaRunRecord[] {
  if (!Array.isArray(value)) throw new Error("竞技场档案必须是列表");
  const byId = new Map<string, ArenaRunRecord>();
  for (const entry of value) byId.set(parseArenaRunRecord(entry).id, parseArenaRunRecord(entry));
  return [...byId.values()].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

function parseDeckCard(value: unknown): ArenaDeckCard {
  if (!isRecord(value) || !nonEmptyString(value.name) || !positiveInteger(value.count)) {
    throw new Error("竞技场卡牌无效");
  }
  if (value.cardId !== undefined && typeof value.cardId !== "string") throw new Error("竞技场卡牌 ID 无效");
  if (value.score !== undefined && !finiteNonNegative(value.score)) throw new Error("竞技场卡牌评分无效");
  return {
    name: value.name,
    count: value.count,
    ...(value.cardId ? { cardId: value.cardId } : {}),
    ...(value.score !== undefined ? { score: value.score } : {})
  };
}

function parseReward(value: unknown): ArenaReward {
  if (!isRecord(value) || !["gold", "dust", "pack", "card", "other"].includes(String(value.type))) {
    throw new Error("竞技场奖励无效");
  }
  if (value.amount !== undefined && !nonNegativeInteger(value.amount)) throw new Error("竞技场奖励数量无效");
  if (value.name !== undefined && typeof value.name !== "string") throw new Error("竞技场奖励名称无效");
  if (value.cardId !== undefined && typeof value.cardId !== "string") throw new Error("竞技场奖励卡牌无效");
  return {
    type: value.type as ArenaReward["type"],
    ...(value.amount !== undefined ? { amount: value.amount } : {}),
    ...(value.name ? { name: value.name } : {}),
    ...(value.cardId ? { cardId: value.cardId } : {})
  };
}

function parseMulligan(value: unknown): ArenaMulliganRecord {
  if (!isRecord(value) || !nonEmptyString(value.cardName)) throw new Error("竞技场留牌记录无效");
  for (const key of ["drawnBeforeMulligan", "keptInMulligan", "inHandAfterMulligan", "won"] as const) {
    if (typeof value[key] !== "boolean") throw new Error("竞技场留牌字段无效");
  }
  if (value.cardId !== undefined && typeof value.cardId !== "string") throw new Error("竞技场留牌 ID 无效");
  return {
    cardName: value.cardName,
    ...(value.cardId ? { cardId: value.cardId } : {}),
    drawnBeforeMulligan: value.drawnBeforeMulligan as boolean,
    keptInMulligan: value.keptInMulligan as boolean,
    inHandAfterMulligan: value.inHandAfterMulligan as boolean,
    won: value.won as boolean
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmptyString(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function isoDate(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function nonNegativeInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function positiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function finiteNonNegative(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
