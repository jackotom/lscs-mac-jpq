import type { CardDetails, CardInfo, RelatedCardInfo } from "./cardDatabase.js";

export interface CardCandidateSelector {
  readonly source: "deck" | "visible";
  readonly cardTypes?: readonly string[];
  readonly manaCost?: CardNumericConstraint;
  readonly attack?: CardNumericConstraint;
  readonly health?: CardNumericConstraint;
  readonly racesAny?: readonly string[];
  readonly spellSchoolsAny?: readonly string[];
  readonly mechanicsAny?: readonly string[];
  readonly mechanicsAll?: readonly string[];
  readonly raritiesAny?: readonly string[];
}

export interface CardNumericConstraint {
  readonly min?: number;
  readonly max?: number;
  readonly exact?: number;
  readonly oneOf?: readonly number[];
}

const CARD_TYPES = ["随从", "法术", "武器", "英雄", "地标"] as const;
const SEGMENT_BOUNDARY = "\u0000";
const DECK_CANDIDATE_PATTERN = /从你的牌库(?:中|里|内)?\s*(?:随机\s*)?(?:抽(?:取)?|召唤|施放|检索|发现|选择|装备)\s*(?:(?:[一二三四五六七八九十两]|\d+)(?:张|个|只|名|把)?\s*)?([^。；;！!?？]{1,80})/u;
const FOLLOW_UP_ACTION_PATTERN = /(?:并|然后|再)(?:使|让|将)|改为|如果/u;
const DYNAMIC_VALUE_PATTERN = /(?:最低|最高|本随从|相同|增加|减少|有足够的法力值|随机费用)/u;
const RACE_NAMES: Readonly<Record<string, string>> = {
  德莱尼: "DRAENEI", 亡灵: "UNDEAD", 鱼人: "MURLOC", 恶魔: "DEMON",
  机械: "MECHANICAL", 元素: "ELEMENTAL", 野兽: "BEAST", 图腾: "TOTEM",
  海盗: "PIRATE", 龙: "DRAGON", 野猪人: "QUILBOAR", 纳迦: "NAGA"
};
const SPELL_SCHOOLS = ["奥术", "火焰", "冰霜", "自然", "神圣", "暗影", "邪能"] as const;
const MECHANIC_NAMES: Readonly<Record<string, string>> = {
  战吼: "BATTLECRY", 亡语: "DEATHRATTLE", 嘲讽: "TAUNT", 突袭: "RUSH",
  吸血: "LIFESTEAL", 圣盾: "DIVINE_SHIELD", 连击: "COMBO", 过载: "OVERLOAD",
  流放: "OUTCAST", 奥秘: "SECRET", 可交易: "TRADEABLE", 复生: "REBORN",
  潜行: "STEALTH", 冲锋: "CHARGE", 风怒: "WINDFURY", 剧毒: "POISONOUS"
};
const RARITY_NAMES: Readonly<Record<string, string>> = {
  普通: "COMMON", 稀有: "RARE", 史诗: "EPIC", 传说: "LEGENDARY"
};

export function inferCardCandidateSelectors(card: CardInfo): readonly CardCandidateSelector[] {
  const selectors: CardCandidateSelector[] = [];
  let previousWasExplicitFriendlyDeckDraw = false;
  for (const fragment of splitCardTextIntoSegments(card.text)) {
    const fragmentIsSafe = !isUnsafeDeckConstruction(fragment);
    selectors.push(...inferFragmentSelectors(fragment));
    if (previousWasExplicitFriendlyDeckDraw) {
      selectors.push(...inferDeckDrawContinuationSelectors(fragment));
    }
    previousWasExplicitFriendlyDeckDraw = fragmentIsSafe &&
      /从你的牌库(?:中|里|内)?\s*(?:随机\s*)?抽(?:取)?/u.test(fragment);
  }
  const seen = new Set<string>();
  return selectors.filter((selector) => {
    const key = JSON.stringify(selector);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inferDeckDrawContinuationSelectors(fragment: string): readonly CardCandidateSelector[] {
  const phrase = fragment.match(
    /^(?:连击|战吼|亡语|压轴|流放|锻造)\s*[:：]\s*并抽(?:取)?\s*(?:(?:[一二三四五六七八九十两]|\d+)(?:张|个|只|名|把)?\s*)?(.+)$/u
  )?.[1]?.trim();
  return phrase ? inferSelectorsFromPhrase(phrase) : [];
}

function inferFragmentSelectors(fragment: string): readonly CardCandidateSelector[] {
  if (isUnsafeDeckConstruction(fragment)) return [];
  return [
    ...inferDeckCandidateSelectors(fragment),
    ...inferFriendlyContextSelectors(fragment)
  ];
}

function isUnsafeDeckConstruction(fragment: string): boolean {
  const hasDeckCondition = /如果你(?:的)?(?:牌库|套牌)/u.test(fragment);
  const hasExplicitPositiveDeckAction = /，[^，]{0,40}从你的牌库(?:中|里|内)?\s*(?:随机\s*)?(?:抽(?:取)?|召唤|施放|检索|发现|选择|装备)/u.test(fragment);
  return /(?:牌库|套牌)(?:中|里|内)?(?:没有|只有|均为|不含|不存在|仅包含|已空|为空|没有相同)/u.test(fragment) ||
    (hasDeckCondition && !hasExplicitPositiveDeckAction);
}

export function areCardDetailsRelated(
  active: CardDetails,
  candidate: CardDetails,
  candidateGroup: "deck" | "hand" | "board" | "other"
): boolean {
  if (isSameCardIdentity(active, candidate)) {
    return false;
  }

  if (referencesCard(active, candidate) || referencesCard(candidate, active)) {
    return true;
  }

  if (candidateGroup !== "deck") return false;
  return active.relationSelectors?.some((selector) => matchesSelector(selector, candidate, "deck")) === true ||
    candidate.relationSelectors?.some((selector) => matchesSelector(selector, active, "deck")) === true;
}

function splitCardTextIntoSegments(text: string | undefined): readonly string[] {
  return (text ?? "")
    .replace(/<br\s*\/?\s*>/giu, SEGMENT_BOUNDARY)
    .replace(/\r\n?|\n|[。；;！!?？]/gu, SEGMENT_BOUNDARY)
    .split(SEGMENT_BOUNDARY)
    .map(normalizeCardText)
    .filter(Boolean);
}

function normalizeCardText(text: string): string {
  return text
    .replace(/<[^>]*>/gu, "")
    .replace(/&nbsp;/giu, " ")
    .replace(/[（]/gu, "(")
    .replace(/[）]/gu, ")")
    .replace(/\s+/gu, " ")
    .trim();
}

function inferDeckCandidateSelectors(fragment: string): readonly CardCandidateSelector[] {
  const match = fragment.match(DECK_CANDIDATE_PATTERN);
  const phrase = trimCandidatePhrase(match?.[1]);
  if (!phrase || FOLLOW_UP_ACTION_PATTERN.test(phrase) || /^牌(?:并|，|,|$)/u.test(phrase)) {
    return [];
  }
  const alternatives = phrase.split(/\s*(?:、|和|以及)\s*(?=(?:[一二三四五六七八九十两]|\d+)张)/u);
  return alternatives.flatMap((alternative) => inferSelectorsFromPhrase(
    alternative.replace(/^(?:[一二三四五六七八九十两]|\d+)张\s*/u, "")
  ));
}

function inferFriendlyContextSelectors(fragment: string): readonly CardCandidateSelector[] {
  if (/(?:对手|敌方|双方|套牌之外)/u.test(fragment)) return [];
  const patterns = [
    /(?:使|让)(?:你(?:的)?手牌(?:、|和))?(?:你(?:的)?)?牌库(?:中|里|内|中的|里的)?(?:所有|全部)?\s*(.+?)(?:获得|的法力值|法力值|，|,|$)/u,
    /如果你(?:的)?手牌中有\s*(.+?)(?:，|,|$)/u,
    /(?:每当|在)你(?:使用|打出|施放)(?:一张|一个|一只)?\s*(.+?)(?:后|时|，|,|$)/u,
    /你的下一张\s*(.+?)(?:的法力值|会|，|,|$)/u,
    /(?:使|让)你(?:的)?手牌中(?:的)?(?:所有|全部|一张|一个|一只)?\s*(.+?)(?:获得|的法力值|法力值|，|,|$)/u,
    /(?:使|让)你的(?:所有|全部)?\s*(.+?)(?:获得|的法力值|法力值|，|,|$)/u,
    /(?:使|让)(?:一个|一只|一张)?友方\s*(.+?)(?:获得|的法力值|法力值|，|,|$)/u
  ] as const;
  for (const pattern of patterns) {
    const phrase = fragment.match(pattern)?.[1]?.trim();
    const selectors = phrase ? inferSelectorsFromPhrase(phrase) : [];
    if (selectors.length > 0) return selectors;
  }
  return [];
}

function trimCandidatePhrase(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const followUpIndex = value.search(/，\s*(?:并|然后|如果|则|改为|再|使|让|将)|(?:并|然后)(?:使|让|将)/u);
  return (followUpIndex >= 0 ? value.slice(0, followUpIndex) : value).trim();
}

function inferSelectorsFromPhrase(phrase: string): readonly CardCandidateSelector[] {
  if (DYNAMIC_VALUE_PATTERN.test(phrase) || /(?:本牌|本随从|它自己)/u.test(phrase)) return [];
  const cardTypes = CARD_TYPES.filter((type) => type === "英雄"
    ? phrase.includes("英雄牌")
    : new RegExp(`${type}牌?`, "u").test(phrase));
  const racesAny = Object.entries(RACE_NAMES)
    .filter(([label]) => new RegExp(`${label}(?:牌|随从)?`, "u").test(phrase))
    .map(([, race]) => race);
  const spellSchoolsAny = SPELL_SCHOOLS.filter((school) => phrase.includes(`${school}法术`));
  const mechanics = Object.entries(MECHANIC_NAMES)
    .filter(([label]) => phrase.includes(label))
    .map(([, mechanic]) => mechanic);
  const raritiesAny = Object.entries(RARITY_NAMES)
    .filter(([label]) => phrase.includes(`${label}牌`) || phrase.includes(`${label}${cardTypes[0] ?? ""}`))
    .map(([, rarity]) => rarity);
  const manaCost = inferNumericConstraint(phrase, "法力值消耗");
  const attack = inferNumericConstraint(phrase, "攻击力");
  const health = inferNumericConstraint(phrase, "生命值");
  if ((phrase.includes("法力值消耗") && !manaCost) ||
      (phrase.includes("攻击力") && !attack) ||
      (phrase.includes("生命值") && !health)) {
    return [];
  }
  if (phrase.includes("奥秘") && !cardTypes.includes("法术")) cardTypes.push("法术");
  const mechanicField = mechanics.length > 0
    ? mechanics.length === 1 ||
      (!/(?:或|任一)/u.test(phrase) && /(?:同时具有|并同时具有|且|具有[^。；]{0,30}和)/u.test(phrase))
      ? { mechanicsAll: mechanics }
      : { mechanicsAny: mechanics }
    : {};
  const selector: CardCandidateSelector = {
    source: "deck",
    ...(cardTypes.length > 0 ? { cardTypes } : {}),
    ...(manaCost ? { manaCost } : {}),
    ...(attack ? { attack } : {}),
    ...(health ? { health } : {}),
    ...(racesAny.length > 0 ? { racesAny } : {}),
    ...(spellSchoolsAny.length > 0 ? { spellSchoolsAny } : {}),
    ...mechanicField,
    ...(raritiesAny.length > 0 ? { raritiesAny } : {})
  };
  return Object.keys(selector).length > 1 ? [selector] : [];
}

function inferNumericConstraint(text: string, label: "法力值消耗" | "攻击力" | "生命值"): CardNumericConstraint | undefined {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const comparison = text.match(new RegExp(`${escapedLabel}(?:小于或等于|不高于)\\s*\\(?\\s*(\\d+)\\s*\\)?(?:点)?`, "u"));
  if (comparison) return { max: Number(comparison[1]) };
  const minimum = text.match(new RegExp(`${escapedLabel}(?:大于或等于|不低于)\\s*\\(?\\s*(\\d+)\\s*\\)?(?:点)?`, "u"));
  if (minimum) return { min: Number(minimum[1]) };
  const exactTail = text.match(new RegExp(`${escapedLabel}(?:等于|为)([^的牌随从法术武器英雄地标]{0,48})`, "u"))?.[1];
  const exactValues = exactTail ? [...exactTail.matchAll(/\(?\s*(\d+)\s*\)?/gu)].map((match) => Number(match[1])) : [];
  if (exactValues.length > 1) return { oneOf: [...new Set(exactValues)] };
  return exactValues.length === 1 ? { exact: exactValues[0] } : undefined;
}

function matchesSelector(
  selector: CardCandidateSelector,
  candidate: CardDetails,
  candidateGroup: "deck" | "hand" | "board" | "other"
): boolean {
  if (selector.source === "deck" ? candidateGroup !== "deck" : candidateGroup === "deck") {
    return false;
  }
  if (selector.cardTypes && (!candidate.cardType || !selector.cardTypes.includes(candidate.cardType))) {
    return false;
  }
  if (selector.manaCost && !matchesNumericConstraint(candidate.manaCost, selector.manaCost)) {
    return false;
  }
  if (selector.attack && !matchesNumericConstraint(candidate.attack, selector.attack)) {
    return false;
  }
  if (selector.health && !matchesNumericConstraint(candidate.health, selector.health)) {
    return false;
  }
  if (selector.racesAny && (!candidate.races || !candidate.races.includes("ALL") && !selector.racesAny.some((race) => candidate.races?.includes(race)))) {
    return false;
  }
  if (selector.spellSchoolsAny && (!candidate.spellSchool || !selector.spellSchoolsAny.includes(candidate.spellSchool))) {
    return false;
  }
  if (selector.mechanicsAny && (!candidate.mechanics || !selector.mechanicsAny.some((mechanic) => candidate.mechanics?.includes(mechanic)))) {
    return false;
  }
  if (selector.mechanicsAll && (!candidate.mechanics || !selector.mechanicsAll.every((mechanic) => candidate.mechanics?.includes(mechanic)))) {
    return false;
  }
  return !selector.raritiesAny || (candidate.rarity !== undefined && selector.raritiesAny.includes(candidate.rarity));
}

function matchesNumericConstraint(
  candidateCost: number | undefined,
  selector: NonNullable<CardCandidateSelector["manaCost"]>
): boolean {
  return candidateCost !== undefined &&
    (selector.min === undefined || candidateCost >= selector.min) &&
    (selector.max === undefined || candidateCost <= selector.max) &&
    (selector.exact === undefined || candidateCost === selector.exact) &&
    (selector.oneOf === undefined || selector.oneOf.includes(candidateCost));
}

function isSameCardIdentity(left: CardInfo, right: CardInfo): boolean {
  if (left.dbfId === right.dbfId) return true;
  const leftCardId = normalizeCardIdentity(left.cardId);
  const rightCardId = normalizeCardIdentity(right.cardId);
  return Boolean(leftCardId && rightCardId && leftCardId === rightCardId);
}

function referencesCard(details: CardDetails, candidate: CardDetails): boolean {
  return details.relatedCards.some((card) => isSameCard(card, candidate)) ||
    details.synergyCards?.some((card) => isSameCard(card, candidate)) === true;
}

function isSameCard(referenced: RelatedCardInfo, candidate: CardDetails): boolean {
  if (referenced.dbfId === candidate.dbfId) return true;
  const referencedCardId = normalizeCardIdentity(referenced.cardId);
  const candidateCardId = normalizeCardIdentity(candidate.cardId);
  return Boolean(referencedCardId && candidateCardId && referencedCardId === candidateCardId);
}

function normalizeCardIdentity(cardId: string | undefined): string | undefined {
  return cardId?.trim().toLocaleUpperCase().replace(/^(?:(?:CORE|VAN)_)+/u, "");
}
