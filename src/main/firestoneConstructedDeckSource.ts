import { decode } from "deckstrings";
import type { LadderDeckRecommendation, LadderMode } from "../shared/ladderDeckRecommendation.js";

interface ParseOptions {
  readonly mode: LadderMode;
  readonly expectedPatch: string;
  readonly sourceUrl: string;
}

const CLASS_NAMES: Readonly<Record<string, string>> = {
  deathknight: "死亡骑士",
  "death-knight": "死亡骑士",
  demonhunter: "恶魔猎手",
  "demon-hunter": "恶魔猎手",
  druid: "德鲁伊",
  hunter: "猎人",
  mage: "法师",
  paladin: "圣骑士",
  priest: "牧师",
  rogue: "潜行者",
  shaman: "萨满祭司",
  warlock: "术士",
  warrior: "战士"
};

const ARCHETYPE_WORDS: Readonly<Record<string, string>> = {
  aggro: "快攻",
  big: "大哥",
  burn: "直伤",
  control: "控制",
  dragon: "龙",
  egg: "蛋",
  exodia: "OTK",
  face: "打脸",
  handbuff: "污手",
  highlander: "宇宙",
  hl: "宇宙",
  mech: "机械",
  midrange: "中速",
  mill: "爆牌",
  miracle: "奇迹",
  quest: "任务",
  questline: "任务线",
  token: "铺场",
  xl: "40卡"
};

export function parseFirestoneConstructedDecks(value: unknown, options: ParseOptions): LadderDeckRecommendation[] {
  if (!isRecord(value) || typeof value.lastUpdated !== "string" || !Array.isArray(value.deckStats)) {
    throw new Error("Firestone 天梯卡组数据格式无效");
  }
  if (value.format !== options.mode || !Number.isFinite(Date.parse(value.lastUpdated))) {
    throw new Error("Firestone 天梯卡组模式或更新时间无效");
  }

  const recommendations: LadderDeckRecommendation[] = [];
  for (const entry of value.deckStats) {
    if (!isRecord(entry) || entry.format !== options.mode || typeof entry.decklist !== "string") continue;
    const games = finitePositiveInteger(entry.totalGames);
    const wins = finiteNonNegativeInteger(entry.totalWins);
    const playerClass = typeof entry.playerClass === "string" ? entry.playerClass.trim().toLowerCase() : "";
    if (!games || wins === undefined || wins > games || !CLASS_NAMES[playerClass]) continue;
    try {
      const decoded = decode(entry.decklist);
      if (decoded.cards.reduce((sum, [, count]) => sum + count, 0) < 1) continue;
    } catch {
      continue;
    }
    const archetype = typeof entry.archetypeName === "string" ? entry.archetypeName : "热门";
    const id = typeof entry.archetypeId === "number" && Number.isSafeInteger(entry.archetypeId)
      ? String(entry.archetypeId)
      : stableDeckId(entry.decklist);
    recommendations.push({
      id: `firestone-${id}-${stableDeckId(entry.decklist)}`,
      mode: options.mode,
      region: "GLOBAL",
      patch: options.expectedPatch,
      name: localizeArchetypeName(archetype, playerClass),
      className: CLASS_NAMES[playerClass],
      winRate: Math.round((wins / games) * 10_000) / 100,
      games,
      deckCode: entry.decklist,
      cards: [],
      source: { name: "Firestone 天梯统计（传说分段·近7天）", url: options.sourceUrl },
      updatedAt: value.lastUpdated
    });
  }
  if (recommendations.length === 0) throw new Error("Firestone 天梯统计中没有可用卡组");
  return recommendations;
}

function localizeArchetypeName(value: string, playerClass: string): string {
  const words = value.toLowerCase().split(/[-_\s]+/).filter(Boolean);
  const className = CLASS_NAMES[playerClass];
  const concepts = words
    .filter((word) => word !== playerClass && word !== "deck")
    .map((word) => ARCHETYPE_WORDS[word])
    .filter((word): word is string => Boolean(word));
  return `${[...new Set(concepts)].join("") || "热门"}${className}`;
}

function stableDeckId(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function finitePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function finiteNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
