import type { CardDetails, CardInfo } from "./cardDatabase.js";
import { normalizeCardId } from "./cardDatabase.js";
import type { DeckCard, SmartCardCounter, SmartCardCounterSide } from "./types.js";

export interface SmartCounterPlayEvent {
  readonly entityId: string;
  readonly side: SmartCardCounterSide;
  readonly action: "play";
  readonly turn?: number;
  readonly cardId?: string;
  readonly name?: string;
}

export interface SmartCounterCardMatcher {
  readonly cardIds?: readonly string[];
  readonly cardTypes?: readonly string[];
  readonly tribes?: readonly string[];
  readonly spellSchools?: readonly string[];
  readonly manaCost?: number | readonly number[];
  readonly textPatterns?: readonly RegExp[];
  readonly relativeToActivation?: "same-card";
  readonly textReferencesOwnName?: boolean;
}

export type SmartCounterActivation =
  | {
      readonly kind: "friendly-deck-card";
      readonly matcher: SmartCounterCardMatcher;
    }
  | {
      readonly kind: "observed-card";
      readonly matcher: SmartCounterCardMatcher;
    };

export type SmartCounterDistinctBy = "card" | "entity" | "spell-school" | "tribe";

export type SmartCounterRuleScope = "game" | "current-turn" | "previous-turn";

export interface SmartCounterAggregation {
  readonly kind: "count" | "distinct" | "boolean";
  readonly matcher: SmartCounterCardMatcher;
  readonly distinctBy?: SmartCounterDistinctBy;
  readonly excludeActivationCards?: boolean;
}

export type SmartCounterTarget =
  | { readonly kind: "fixed"; readonly value: number }
  | {
      readonly kind: "activation-card-text";
      readonly patterns: readonly RegExp[];
      readonly optional?: boolean;
    };

export interface SmartCounterRule {
  readonly ruleId: string;
  readonly label: string;
  readonly labelSource?: "activation-card-name";
  readonly side: SmartCardCounterSide;
  readonly activation: SmartCounterActivation;
  readonly activationCardMode?: "first" | "each";
  readonly scope?: SmartCounterRuleScope;
  readonly aggregation: SmartCounterAggregation;
  readonly target?: SmartCounterTarget;
}

export interface EvaluateSmartCounterRulesOptions {
  readonly rules?: readonly SmartCounterRule[];
  readonly uses: readonly SmartCounterPlayEvent[];
  readonly friendlyDeck: readonly DeckCard[];
  readonly currentTurn?: number;
  readonly activeSide?: SmartCardCounterSide;
  readonly resolveCard: (cardId?: string, name?: string, entityId?: string) => CardInfo | undefined;
  readonly toDetails: (card: CardInfo) => CardDetails | undefined;
}

const DRAGON_TARGET_PATTERNS = [
  /使用过\s*[（(]?\s*(\d+)\s*[）)]?\s*张其他龙牌/u,
  /played\s+(?:at\s+least\s+)?(\d+)\s+other\s+dragons?/iu
] as const;

const DISTINCT_SPELL_SCHOOL_ACTIVATION_PATTERNS = [
  /本局对战中[^@。]*(?:不同(?:的)?法术派系|不同派系的法术)/u,
  /this\s+game[^.]*different\s+(?:spell\s+schools?|schools?\s+of\s+magic)/iu,
  /different\s+(?:spell\s+schools?|schools?\s+of\s+magic)[^.]*this\s+game/iu
] as const;

const DISTINCT_SPELL_SCHOOL_TARGET_PATTERNS = [
  /(?:使用|施放)过?\s*[（(]?\s*([一二两三四五六七八九十\d]+)\s*[）)]?\s*(?:个|种)?(?:或以上)?不同(?:的)?法术派系/u,
  /(?:使用|施放)\s*([一二两三四五六七八九十\d]+)\s*种不同派系的法术/u,
  /(?:played|cast)\s+(\d+)\s+different\s+spell\s+schools?/iu
] as const;

const SPELL_COUNT_ACTIVATION_PATTERNS = [
  /本局对战中[^@。]*(?:使用过|施放过)\s*[（(]?\s*([一二两三四五六七八九十\d]+)\s*[）)]?\s*个?(?:或以上)?法术/u,
  /本局对战中[^@。]*每施放一个法术/u,
  /you(?:'ve|\s+have)\s+(?:played|cast)\s+(?:at\s+least\s+)?(\d+)\s+spells?[^.]*this\s+game/iu
] as const;

const SPELL_COUNT_TARGET_PATTERNS = [
  /本局对战中[^@。]*(?:使用过|施放过)\s*[（(]?\s*([一二两三四五六七八九十\d]+)\s*[）)]?\s*个?(?:或以上)?法术/u,
  /you(?:'ve|\s+have)\s+(?:played|cast)\s+(?:at\s+least\s+)?(\d+)\s+spells?[^.]*this\s+game/iu
] as const;

const PREVIOUS_TURN_ELEMENTAL_PATTERNS = [
  /上(?:个)?回合[^@。]*(?:使用|打出)过?元素牌/u,
  /last\s+turn[^.]*played\s+an?\s+elemental/iu
] as const;

const CURRENT_TURN_CARD_COUNT_PATTERNS = [
  /本回合中[^@。]*每使用过?一张(?:其他)?牌/u,
  /本回合中[^@。]*使用的其他牌的数量/u,
  /this\s+turn[^.]*for\s+each\s+(?:other\s+)?card\s+you(?:'ve|\s+have)?\s+played/iu
] as const;

const CURRENT_TURN_SPELL_COUNT_PATTERNS = [
  /本回合中[^@。]*每施放过?一个法术/u,
  /this\s+turn[^.]*for\s+each\s+spell\s+you(?:'ve|\s+have)?\s+cast/iu
] as const;

const SAME_NAME_PLAYED_PATTERNS = [
  /本局对战中[^@。]*每使用过一张其他[^，。@]+(?:，|便|则)/u,
  /for\s+each\s+other\s+.+?\s+you(?:'ve|\s+have)?\s+played\s+this\s+game/iu
] as const;

const DISTINCT_MINION_TRIBE_ACTIVATION_PATTERNS = [
  /本局对战中[^@。]*使用过[^@。]*不同类型的随从牌/u,
  /任务[：:]?[^@。]*使用\s*[一二两三四五六七八九十\d]+\s*个不同类型的随从牌/u,
  /different\s+minion\s+types?/iu
] as const;

const DISTINCT_MINION_TRIBE_TARGET_PATTERNS = [
  /使用\s*([一二两三四五六七八九十\d]+)\s*个不同类型的随从牌/u,
  /(?:played|play)\s+(\d+)\s+different\s+minion\s+types?/iu
] as const;

/**
 * Built-in rules are declarative on purpose. Adding another ordinary counter
 * should only require another entry here; event collection stays in TrackerEngine.
 */
const BASE_SMART_COUNTER_RULES: readonly SmartCounterRule[] = [
  {
    ruleId: "friendly-dragons-played",
    label: "龙牌触发",
    side: "friendly",
    activation: {
      kind: "friendly-deck-card",
      matcher: { textPatterns: DRAGON_TARGET_PATTERNS }
    },
    aggregation: {
      kind: "count",
      matcher: { tribes: ["DRAGON"] },
      excludeActivationCards: true
    },
    target: {
      kind: "activation-card-text",
      patterns: DRAGON_TARGET_PATTERNS
    }
  },
  {
    ruleId: "friendly-distinct-spell-schools",
    label: "不同法术派系",
    side: "friendly",
    activation: {
      kind: "friendly-deck-card",
      matcher: { textPatterns: DISTINCT_SPELL_SCHOOL_ACTIVATION_PATTERNS }
    },
    aggregation: {
      kind: "distinct",
      matcher: { cardTypes: ["SPELL"] },
      distinctBy: "spell-school",
      excludeActivationCards: true
    },
    target: {
      kind: "activation-card-text",
      patterns: DISTINCT_SPELL_SCHOOL_TARGET_PATTERNS,
      optional: true
    }
  },
  {
    ruleId: "friendly-spells-played",
    label: "法术进度",
    side: "friendly",
    activation: {
      kind: "friendly-deck-card",
      matcher: { textPatterns: SPELL_COUNT_ACTIVATION_PATTERNS }
    },
    aggregation: {
      kind: "count",
      matcher: { cardTypes: ["SPELL"] },
      excludeActivationCards: true
    },
    target: {
      kind: "activation-card-text",
      patterns: SPELL_COUNT_TARGET_PATTERNS,
      optional: true
    }
  },
  {
    ruleId: "friendly-distinct-minion-tribes",
    label: "不同随从种族",
    side: "friendly",
    activation: {
      kind: "friendly-deck-card",
      matcher: { textPatterns: DISTINCT_MINION_TRIBE_ACTIVATION_PATTERNS }
    },
    aggregation: {
      kind: "distinct",
      matcher: { cardTypes: ["MINION"] },
      distinctBy: "tribe",
      excludeActivationCards: true
    },
    target: {
      kind: "activation-card-text",
      patterns: DISTINCT_MINION_TRIBE_TARGET_PATTERNS,
      optional: true
    }
  },
  {
    ruleId: "friendly-previous-turn-elemental",
    label: "上回合元素",
    side: "friendly",
    scope: "previous-turn",
    activation: {
      kind: "friendly-deck-card",
      matcher: { textPatterns: PREVIOUS_TURN_ELEMENTAL_PATTERNS }
    },
    aggregation: {
      kind: "boolean",
      matcher: { tribes: ["ELEMENTAL"] }
    },
    target: { kind: "fixed", value: 1 }
  },
  {
    ruleId: "friendly-current-turn-cards",
    label: "本回合用牌",
    side: "friendly",
    scope: "current-turn",
    activation: {
      kind: "friendly-deck-card",
      matcher: { textPatterns: CURRENT_TURN_CARD_COUNT_PATTERNS }
    },
    aggregation: {
      kind: "count",
      matcher: {}
    }
  },
  {
    ruleId: "friendly-current-turn-spells",
    label: "本回合法术",
    side: "friendly",
    scope: "current-turn",
    activation: {
      kind: "friendly-deck-card",
      matcher: { textPatterns: CURRENT_TURN_SPELL_COUNT_PATTERNS }
    },
    aggregation: {
      kind: "count",
      matcher: { cardTypes: ["SPELL"] }
    }
  },
  {
    ruleId: "friendly-other-same-name-played",
    label: "同名牌次数",
    labelSource: "activation-card-name",
    side: "friendly",
    activationCardMode: "each",
    activation: {
      kind: "friendly-deck-card",
      matcher: {
        textPatterns: SAME_NAME_PLAYED_PATTERNS,
        textReferencesOwnName: true
      }
    },
    aggregation: {
      kind: "count",
      matcher: { relativeToActivation: "same-card" }
    }
  }
] as const;

export interface SmartCounterSeriesGroupCatalogEntry {
  readonly groupId: string;
  readonly ruleId?: string;
  readonly label: string;
  readonly side: SmartCardCounterSide;
  readonly activation: "friendly-deck" | "observed";
  readonly cardIds: readonly string[];
}

/** Card families whose effect grows each time any member is actually played. */
export const SMART_COUNTER_SERIES_GROUP_CATALOG: readonly SmartCounterSeriesGroupCatalogEntry[] = [
  {
    groupId: "void-soul",
    ruleId: "opponent-void-souls",
    label: "虚空灵魂",
    side: "opponent",
    activation: "observed",
    cardIds: ["JAIL_732"]
  }
] as const;

export interface SmartCounterManaCostCatalogEntry {
  readonly manaCost: number;
  readonly label: string;
}

/** The two reliable low-cost buckets are ready even when no relevant deck card activates one. */
export const SMART_COUNTER_MANA_COST_CATALOG: readonly SmartCounterManaCostCatalogEntry[] = [
  { manaCost: 1, label: "1费牌" },
  { manaCost: 2, label: "2费牌" }
] as const;

export const SMART_COUNTER_RULES: readonly SmartCounterRule[] = [
  ...BASE_SMART_COUNTER_RULES,
  ...SMART_COUNTER_MANA_COST_CATALOG.map(createManaCostRule),
  ...SMART_COUNTER_SERIES_GROUP_CATALOG.map(createSeriesGroupRule)
];

function createManaCostRule(entry: SmartCounterManaCostCatalogEntry): SmartCounterRule {
  const escapedCost = String(entry.manaCost).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const activationPatterns = [
    new RegExp(`本局对战中[^@。]*(?:使用过|打出过)[^@。]*法力值消耗为[（(]${escapedCost}[）)][^@。]*牌`, "u"),
    new RegExp(`(?:played|play)[^.]*costs?\\s*[（(]?${escapedCost}[）)]?[^.]*this\\s+game`, "iu")
  ];
  return {
    ruleId: `friendly-mana-${entry.manaCost}-cards-played`,
    label: entry.label,
    side: "friendly",
    scope: "game",
    activation: {
      kind: "friendly-deck-card",
      matcher: { textPatterns: activationPatterns }
    },
    aggregation: {
      kind: "count",
      matcher: { manaCost: entry.manaCost }
    }
  };
}

function createSeriesGroupRule(entry: SmartCounterSeriesGroupCatalogEntry): SmartCounterRule {
  const matcher = { cardIds: entry.cardIds } as const;
  return {
    ruleId: entry.ruleId ?? `${entry.side}-series-${entry.groupId}`,
    label: entry.label,
    side: entry.side,
    scope: "game",
    activation: entry.activation === "friendly-deck"
      ? { kind: "friendly-deck-card", matcher }
      : { kind: "observed-card", matcher },
    aggregation: {
      kind: "count",
      matcher
    }
  };
}

export function evaluateSmartCounterRules(
  options: EvaluateSmartCounterRulesOptions
): readonly SmartCardCounter[] {
  const resolvedDeck = options.friendlyDeck
    .map((card) => options.resolveCard(card.cardId, card.name))
    .filter((card): card is CardInfo => card !== undefined);
  const resolvedUses = options.uses.map((use) => ({
    use,
    card: options.resolveCard(use.cardId, use.name, use.entityId)
  }));

  return (options.rules ?? SMART_COUNTER_RULES).flatMap((rule) => {
    const activationCards = resolveActivationCards(rule, resolvedDeck, resolvedUses);
    if (activationCards.length === 0) return [];
    const activationGroups = rule.activationCardMode === "each"
      ? activationCards.map((card) => [card] as const)
      : [activationCards];

    return activationGroups.flatMap((activeCards) => {
      const target = resolveTarget(rule.target, activeCards);
      if (
        rule.target &&
        target === undefined &&
        (rule.target.kind === "fixed" || !rule.target.optional)
      ) return [];

      const sourceCard = activeCards[0];
      const matchingUses = resolvedUses.filter(({ use, card }) =>
        use.side === rule.side &&
        use.action === "play" &&
        matchesRuleScope(use, rule, options.currentTurn, options.activeSide) &&
        card !== undefined &&
        matchesCard(card, rule.aggregation.matcher, sourceCard) &&
        (!rule.aggregation.excludeActivationCards ||
          !activeCards.some((activationCard) => isSameCard(card, activationCard)))
      );
      const value = aggregateUses(matchingUses, rule.aggregation);
      const cardId = sourceCard.cardId ?? sourceCard.id;
      const details = options.toDetails(sourceCard);
      const counterRuleId = rule.activationCardMode === "each"
        ? `${rule.ruleId}-${safeCounterIdToken(cardIdentity(sourceCard))}`.slice(0, 128)
        : rule.ruleId;

      return [{
        id: counterRuleId,
        ruleId: counterRuleId,
        side: rule.side,
        label: rule.labelSource === "activation-card-name" ? sourceCard.name : rule.label,
        value,
        ...(target !== undefined ? { target } : {}),
        ...(rule.scope && rule.scope !== "game" ? { scope: rule.scope } : {}),
        ...(cardId ? { cardId } : {}),
        ...(details ? { details } : {})
      }];
    });
  });
}

function resolveActivationCards(
  rule: SmartCounterRule,
  deck: readonly CardInfo[],
  uses: readonly { readonly use: SmartCounterPlayEvent; readonly card?: CardInfo }[]
): readonly CardInfo[] {
  if (rule.activation.kind === "friendly-deck-card") {
    return deck.filter((card) => matchesCard(card, rule.activation.matcher, card));
  }

  return uniqueCards(uses
    .filter(({ use, card }) =>
      use.side === rule.side &&
      card !== undefined &&
      matchesCard(card, rule.activation.matcher, card)
    )
    .map(({ card }) => card!));
}

function resolveTarget(
  target: SmartCounterTarget | undefined,
  activationCards: readonly CardInfo[]
): number | undefined {
  if (!target) return undefined;
  if (target.kind === "fixed") return target.value;
  const targets = activationCards
    .flatMap((card) => parseTargets(card.text, target.patterns))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  return targets.length > 0 ? Math.min(...targets) : undefined;
}

function parseTargets(text: string | undefined, patterns: readonly RegExp[]): readonly number[] {
  if (!text) return [];
  const normalized = text.replace(/<[^>]*>/gu, " ").replace(/&nbsp;/giu, " ");
  return patterns.flatMap((pattern) => {
    pattern.lastIndex = 0;
    const match = pattern.exec(normalized);
    const value = match?.[1] ? parseCounterNumber(match[1]) : Number.NaN;
    return Number.isSafeInteger(value) ? [value] : [];
  });
}

function parseCounterNumber(raw: string): number {
  if (/^\d+$/u.test(raw)) return Number.parseInt(raw, 10);
  const digits = new Map<string, number>([
    ["一", 1], ["二", 2], ["两", 2], ["三", 3], ["四", 4], ["五", 5],
    ["六", 6], ["七", 7], ["八", 8], ["九", 9]
  ] as const);
  if (raw === "十") return 10;
  if (raw.includes("十")) {
    const [tens, ones] = raw.split("十");
    return (tens ? digits.get(tens) ?? 0 : 1) * 10 + (ones ? digits.get(ones) ?? 0 : 0);
  }
  return digits.get(raw) ?? Number.NaN;
}

function aggregateUses(
  uses: readonly { readonly use: SmartCounterPlayEvent; readonly card?: CardInfo }[],
  aggregation: SmartCounterAggregation
): number {
  if (aggregation.kind === "boolean") return uses.length > 0 ? 1 : 0;
  if (aggregation.kind === "count") return uses.length;
  const keys = new Set<string>();
  for (const entry of uses) {
    for (const key of distinctKeys(entry.use, entry.card!, aggregation.distinctBy ?? "card")) {
      if (key) keys.add(key);
    }
  }
  return keys.size;
}

function distinctKeys(
  use: SmartCounterPlayEvent,
  card: CardInfo,
  distinctBy: SmartCounterDistinctBy
): readonly string[] {
  if (distinctBy === "entity") return [use.entityId];
  if (distinctBy === "spell-school") {
    const school = card.spellSchool ?? (card.spellSchoolId !== undefined ? String(card.spellSchoolId) : undefined);
    return school ? [normalizeToken(school)] : [];
  }
  if (distinctBy === "tribe") {
    return (card.races ?? []).map(normalizeTribe).filter(Boolean);
  }
  return [cardIdentity(card)];
}

function matchesRuleScope(
  use: SmartCounterPlayEvent,
  rule: SmartCounterRule,
  currentTurn: number | undefined,
  activeSide: SmartCardCounterSide | undefined
): boolean {
  const scope = rule.scope ?? "game";
  if (scope === "game") return true;
  if (currentTurn === undefined || use.turn === undefined) return false;
  if (scope === "current-turn") {
    return (activeSide === undefined || activeSide === rule.side) && use.turn === currentTurn;
  }
  const previousTurn = activeSide === rule.side ? currentTurn - 2 : currentTurn - 1;
  return previousTurn > 0 && use.turn === previousTurn;
}

function matchesCard(
  card: CardInfo,
  matcher: SmartCounterCardMatcher,
  activationCard?: CardInfo
): boolean {
  if (
    matcher.relativeToActivation === "same-card" &&
    (!activationCard || !isSameCard(card, activationCard))
  ) {
    return false;
  }
  if (matcher.cardIds && !matcher.cardIds.some((id) => normalizeCardId(id) === cardIdentity(card))) {
    return false;
  }
  if (matcher.cardTypes && !matcher.cardTypes.some((type) =>
    normalizeCardTypeToken(type) === normalizeCardTypeToken(card.cardType)
  )) {
    return false;
  }
  if (matcher.tribes && !matchesAnyTribe(card, matcher.tribes)) {
    return false;
  }
  if (matcher.spellSchools && !matcher.spellSchools.some((school) =>
    normalizeToken(school) === normalizeToken(card.spellSchool ?? String(card.spellSchoolId ?? ""))
  )) {
    return false;
  }
  if (matcher.manaCost !== undefined) {
    const costs = Array.isArray(matcher.manaCost) ? matcher.manaCost : [matcher.manaCost];
    if (card.manaCost === undefined || !costs.includes(card.manaCost)) return false;
  }
  if (matcher.textPatterns && !matcher.textPatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(card.text ?? "");
  })) {
    return false;
  }
  if (matcher.textReferencesOwnName) {
    const text = normalizeText(card.text);
    const name = normalizeText(card.name);
    if (!name || !text.includes(name)) return false;
  }
  return true;
}

function normalizeText(value: string | undefined): string {
  return (value ?? "")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/\s+/gu, "")
    .toLocaleLowerCase();
}

function matchesAnyTribe(card: CardInfo, expected: readonly string[]): boolean {
  const actual = new Set((card.races ?? []).map(normalizeTribe));
  if (actual.has("ALL")) return true;
  return expected.some((tribe) => actual.has(normalizeTribe(tribe)));
}

function normalizeTribe(value: string): string {
  const normalized = normalizeToken(value);
  if (["ALL", "ALLTRIBES", "全部", "所有"].includes(normalized)) return "ALL";
  if (["DRAGON", "龙", "龙族"].includes(normalized)) return "DRAGON";
  if (["ELEMENTAL", "元素", "元素族"].includes(normalized)) return "ELEMENTAL";
  return normalized;
}

function normalizeToken(value: string | undefined): string {
  return (value ?? "").trim().replace(/[\s_-]+/gu, "").toLocaleUpperCase();
}

function normalizeCardTypeToken(value: string | undefined): string {
  const normalized = normalizeToken(value);
  if (["SPELL", "法术"].includes(normalized)) return "SPELL";
  if (["MINION", "随从"].includes(normalized)) return "MINION";
  if (["WEAPON", "武器"].includes(normalized)) return "WEAPON";
  return normalized;
}

function cardIdentity(card: CardInfo): string {
  const id = normalizeCardId(card.cardId ?? card.id ?? "");
  return id || `dbf:${card.dbfId}`;
}

function safeCounterIdToken(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "unknown";
}

function isSameCard(left: CardInfo, right: CardInfo): boolean {
  return cardIdentity(left) === cardIdentity(right);
}

function uniqueCards(cards: readonly CardInfo[]): readonly CardInfo[] {
  const byId = new Map<string, CardInfo>();
  for (const card of cards) byId.set(cardIdentity(card), card);
  return [...byId.values()];
}
