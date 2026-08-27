import type { CardInfo } from "./cardDatabase.js";

export type GlobalEffectActivation = "start-of-game" | "play" | "deathrattle" | "triggered";

export interface GlobalEffectRule {
  readonly activations: readonly GlobalEffectActivation[];
  readonly category: "persistent" | "structural";
}

const LEGACY_STRUCTURAL_EFFECT_CARD_IDS = new Set([
  "BAR_539", "BAR_881", "BOT_257", "BT_002", "CORE_CS3_029", "CS3_029",
  "DMF_108", "DMF_534", "DRG_315", "ETC_417", "GDB_467", "OG_118",
  "SCH_609", "TLC_828", "TOY_805", "TOY_877", "TSC_944", "YOG_505"
]);

const TRIGGERED_EFFECT_SOURCE_CARD_IDS = new Map([
  ["EDR_895E", "EDR_895"],
  ["MEND_801E", "MEND_801"],
  ["SC_755E", "SC_753"]
]);

const TRIGGERED_EFFECT_CARD_IDS = new Set(TRIGGERED_EFFECT_SOURCE_CARD_IDS.values());

function normalizeRulesText(text = "") {
  return text
    .replace(/<i>[\s\S]*?<\/i>/giu, "")
    .replace(/<[^>]+>/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function hasFutureRuleText(text: string) {
  const hasDuration =
    /在本局对战(?:的剩余时间内|中)/u.test(text) ||
    /\b(?:for the rest of (?:this|the) game|this game)\b/iu.test(text);
  const changesHandAndDeck = /手牌和牌库(?:中|里)/u.test(text);
  if (!hasDuration && !changesHandAndDeck) return false;

  const historicalLookback =
    /每使用过/u.test(text) ||
    /在本局对战中[^。；]*(?:过的|获得的)/u.test(text) ||
    /\byou(?:'ve| have) played\b/iu.test(text) ||
    /\bplayed this game\b/iu.test(text);
  return !historicalLookback;
}

function persistentClauseIndex(text: string) {
  const indexes = [
    text.search(/在本局对战(?:的剩余时间内|中)/u),
    text.search(/\b(?:for the rest of (?:this|the) game|this game)\b/iu),
    text.search(/手牌和牌库(?:中|里)/u)
  ].filter((index) => index >= 0);
  return indexes.length > 0 ? Math.min(...indexes) : text.length;
}

export function canonicalGlobalEffectCardId(cardId: string): string {
  const normalized = cardId.trim().toUpperCase();
  return TRIGGERED_EFFECT_SOURCE_CARD_IDS.get(normalized) ?? normalized;
}

export function inferGlobalEffectRule(card: CardInfo): GlobalEffectRule | undefined {
  const cardId = canonicalGlobalEffectCardId(card.cardId ?? card.id ?? "");
  if (LEGACY_STRUCTURAL_EFFECT_CARD_IDS.has(cardId)) {
    return { activations: ["play"], category: "structural" };
  }

  const mechanics = new Set((card.mechanics ?? []).map((mechanic) => mechanic.toUpperCase()));
  if (mechanics.has("START_OF_GAME_KEYWORD")) {
    return { activations: ["start-of-game"], category: "persistent" };
  }

  const text = normalizeRulesText(card.text);
  if (!hasFutureRuleText(text)) return undefined;

  if (TRIGGERED_EFFECT_CARD_IDS.has(cardId)) {
    return { activations: ["triggered"], category: "persistent" };
  }

  const prefix = text.slice(0, persistentClauseIndex(text));
  if (/战吼\s*[，,]\s*亡语|亡语\s*[，,]\s*战吼/iu.test(prefix)) {
    return { activations: ["play", "deathrattle"], category: "persistent" };
  }

  const battlecryIndex = Math.max(prefix.lastIndexOf("战吼"), prefix.toLowerCase().lastIndexOf("battlecry"));
  const deathrattleIndex = Math.max(prefix.lastIndexOf("亡语"), prefix.toLowerCase().lastIndexOf("deathrattle"));
  if (mechanics.has("DEATHRATTLE") && deathrattleIndex > battlecryIndex) {
    return { activations: ["deathrattle"], category: "persistent" };
  }

  return { activations: ["play"], category: "persistent" };
}
