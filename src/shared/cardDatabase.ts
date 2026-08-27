import type { CardLibraryResult, NormalizedCardLibraryQuery } from "./types.js";
import { inferCardCandidateSelectors, type CardCandidateSelector } from "./cardRelationRules.js";

export type CardRarity = "FREE" | "COMMON" | "RARE" | "EPIC" | "LEGENDARY" | "UNKNOWN";

export interface CardInfo {
  readonly dbfId: number;
  readonly name: string;
  readonly cardId?: string;
  readonly id?: string;
  readonly collectible?: boolean;
  readonly manaCost?: number;
  readonly attack?: number;
  readonly health?: number;
  readonly text?: string;
  readonly cardTypeId?: number;
  readonly cardType?: string;
  readonly rarity?: CardRarity;
  readonly spellSchoolId?: number;
  readonly spellSchool?: string;
  readonly heroClass?: string;
  readonly heroClasses?: readonly string[];
  readonly races?: readonly string[];
  readonly imageUrl?: string;
  readonly cropImageUrl?: string;
  readonly relatedCardIds?: readonly number[];
  readonly mechanics?: readonly string[];
}

export interface RelatedCardInfo {
  readonly dbfId: number;
  readonly name: string;
  readonly cardId?: string;
  readonly manaCost?: number;
  readonly cardType?: string;
  readonly rarity?: CardRarity;
  readonly text?: string;
  readonly imageUrl?: string;
  readonly cropImageUrl?: string;
}

export interface CardSynergyInfo extends RelatedCardInfo {
  readonly reason: string;
}

export interface CardDetails extends CardInfo {
  readonly isSpell: boolean;
  readonly relatedCards: readonly RelatedCardInfo[];
  readonly cardPoolSections?: readonly CardPoolSection[];
  readonly cardOutcomeSections?: readonly CardOutcomeSection[];
  readonly synergyCards?: readonly CardSynergyInfo[];
  readonly relationSelectors?: readonly CardCandidateSelector[];
  readonly playedSpellsThisGame?: readonly RelatedCardInfo[];
  readonly gameContextSections?: readonly GameContextSection[];
}

export interface CardPoolSection {
  readonly key: string;
  readonly title: string;
  readonly emptyText: string;
  readonly cards: readonly RelatedCardInfo[];
}

export interface CardOutcomeNode {
  readonly key: string;
  readonly card: RelatedCardInfo;
  readonly children?: readonly CardOutcomeNode[];
}

export interface CardOutcomeSection {
  readonly key: string;
  readonly title: string;
  readonly emptyText: string;
  readonly cards: readonly CardOutcomeNode[];
}

export interface GameContextSection {
  readonly key: string;
  readonly title: string;
  readonly emptyText: string;
  readonly cards: readonly RelatedCardInfo[];
  readonly totalCount?: number;
}

export type CardDatabase = Readonly<Record<string, unknown>>;

export function createCardDatabase(cards: readonly unknown[]): CardDatabase {
  const database: Record<string, CardInfo> = {};

  for (const card of cards) {
    const cardInfo = parseCardInfo(card);
    if (!cardInfo) {
      continue;
    }

    database[String(cardInfo.dbfId)] = cardInfo;
  }

  return database;
}

export function getCardInfo(cardDb: CardDatabase, dbfId: number): CardInfo | undefined {
  return parseCardInfo(cardDb[String(dbfId)]);
}

export function listCardInfos(cardDb: CardDatabase): readonly CardInfo[] {
  return Object.values(cardDb)
    .map(parseCardInfo)
    .filter((card): card is CardInfo => card !== undefined);
}

const DEFAULT_CARD_LIBRARY_PAGE_SIZE = 48;
const MAX_CARD_LIBRARY_PAGE_SIZE = 100;
const MAX_CARD_LIBRARY_PAGE = 100_000;
const CARD_LIBRARY_COLLATOR = new Intl.Collator("zh-Hans", { numeric: true, sensitivity: "base" });
const BROWSABLE_CARD_TYPES = new Set(["英雄", "随从", "法术", "武器", "地标"]);
const INVALID_CROP_IMAGE_FILENAMES = new Set(["8a60b28b4a9bb70748ce68815582bbde7a0c2ebfdf70988adb51da88c5d655fc.png"]);

export function normalizeCardLibraryQuery(input: unknown): NormalizedCardLibraryQuery {
  const value = isRecord(input) ? input : {};
  const heroClass = normalizeHeroClass(value.heroClass);
  const cardType = normalizeCardType(stringValue(value.cardType), numberValue(value.cardTypeId));

  return {
    query: (stringValue(value.query) ?? "").slice(0, 120),
    heroClass,
    cardType,
    page: clampInteger(numberValue(value.page), 1, MAX_CARD_LIBRARY_PAGE, 1),
    pageSize: clampInteger(numberValue(value.pageSize), 1, MAX_CARD_LIBRARY_PAGE_SIZE, DEFAULT_CARD_LIBRARY_PAGE_SIZE)
  };
}

export function listCardLibrary(cardDb: CardDatabase, input?: unknown): CardLibraryResult {
  const query = normalizeCardLibraryQuery(input);
  const cards = listCardInfos(cardDb).filter(isBrowsableCard);
  const heroClasses = sortText(uniqueStrings(cards.flatMap((card) => card.heroClasses ?? [])));
  const cardTypes = sortText(uniqueStrings(cards.map((card) => card.cardType).filter((type): type is string => Boolean(type))));
  const normalizedSearch = normalizeSearchText(query.query);
  const items = cards
    .filter((card) => matchesCardLibraryQuery(card, query, normalizedSearch))
    .sort(compareCardInfo)
    .map((card) => toCardDetails(cardDb, card));
  const start = (query.page - 1) * query.pageSize;

  return {
    status: "ok",
    ...query,
    total: items.length,
    items: items.slice(start, start + query.pageSize),
    heroClasses,
    cardTypes,
    warnings: []
  };
}

export function createCardLibraryErrorResult(input: unknown, error: string, warnings: readonly string[] = []): CardLibraryResult {
  const query = normalizeCardLibraryQuery(input);
  return {
    status: "error",
    ...query,
    total: 0,
    items: [],
    heroClasses: [],
    cardTypes: [],
    warnings,
    error
  };
}

export function toCardDetails(cardDb: CardDatabase, card: CardInfo): CardDetails {
  const relatedCards = (card.relatedCardIds ?? [])
    .map((dbfId) => getCardInfo(cardDb, dbfId))
    .filter((related): related is CardInfo => related !== undefined)
    .map(toRelatedCardInfo);
  const cardPoolSections = inferCardPoolSections(cardDb, card);
  const synergyCards = inferCardSynergies(cardDb, card);
  const relationSelectors = inferCardCandidateSelectors(card);

  return {
    ...card,
    isSpell: card.cardTypeId === 5 || card.cardType === "法术" || card.cardType?.toUpperCase() === "SPELL",
    relatedCards,
    ...(cardPoolSections.length > 0 ? { cardPoolSections } : {}),
    ...(synergyCards.length > 0 ? { synergyCards } : {}),
    ...(relationSelectors.length > 0 ? { relationSelectors } : {})
  };
}

const RANDOM_SPELL_POOL_PATTERN = /随机施放[^。；\n]{0,48}?(?:法术|奥秘)/;
const RANDOM_SPELL_MIN_COST_PATTERN = /这些法术的法力值消耗(?:大于或等于|不低于)[（(]?\s*(\d+)\s*[）)]?点?/;
const RANDOM_EXACT_COST_MINION_POOL_PATTERN = /随机[^。；\n]{0,80}?法力值消耗为[（(]?\s*\$?(\d+)\s*[）)]?[^。；\n]{0,40}?随从/u;
const SPELL_SCHOOL_IDS: Readonly<Record<string, number>> = {
  奥术: 1,
  火焰: 2,
  冰霜: 3,
  自然: 4,
  神圣: 5,
  暗影: 6,
  邪能: 7
};
const RANDOM_SPELL_CLASS_NAMES = [
  "死亡骑士",
  "恶魔猎手",
  "萨满祭司",
  "圣骑士",
  "德鲁伊",
  "潜行者",
  "术士",
  "法师",
  "牧师",
  "猎人",
  "战士"
] as const;
const cardPoolSectionCache = new WeakMap<CardDatabase, Map<number, readonly CardPoolSection[]>>();
const collectibleSpellPoolCache = new WeakMap<CardDatabase, readonly CardInfo[]>();
const collectibleMinionPoolCache = new WeakMap<CardDatabase, readonly CardInfo[]>();

function inferCardPoolSections(cardDb: CardDatabase, source: CardInfo): readonly CardPoolSection[] {
  let sectionsByCard = cardPoolSectionCache.get(cardDb);
  if (!sectionsByCard) {
    sectionsByCard = new Map();
    cardPoolSectionCache.set(cardDb, sectionsByCard);
  }
  const cached = sectionsByCard.get(source.dbfId);
  if (cached) {
    return cached;
  }
  const text = source.text ?? "";
  const randomSpellPool = isRandomSpellPoolCard(source);
  const exactMinionCost = randomExactCostMinionPool(text);
  if (!randomSpellPool && exactMinionCost === undefined) {
    sectionsByCard.set(source.dbfId, []);
    return [];
  }

  const sections: CardPoolSection[] = [];
  if (randomSpellPool) {
    let allSpells = collectibleSpellPoolCache.get(cardDb);
    if (!allSpells) {
      allSpells = listCardInfos(cardDb)
        .filter((card) => card.collectible === true && card.cardType === "法术")
        .sort(compareCardInfo);
      collectibleSpellPoolCache.set(cardDb, allSpells);
    }
    const pool = resolveRandomSpellPool(text, allSpells.filter((card) => card.dbfId !== source.dbfId));
    const spells = pool.cards.map(toRelatedCardInfo);
    sections.push({
      key: "random-spells",
      title: pool.title,
      emptyText: "当前卡牌库没有可匹配的法术",
      cards: spells
    });
    const minimumCost = numberValue(text.match(RANDOM_SPELL_MIN_COST_PATTERN)?.[1]);
    if (minimumCost !== undefined) {
      sections.push({
        key: `random-spells-min-cost-${minimumCost}`,
        title: `牌库无随从时：卡库可见的${minimumCost}费及以上候选`,
        emptyText: `当前卡牌库没有${minimumCost}费及以上的法术`,
        cards: spells.filter((card) => (card.manaCost ?? -1) >= minimumCost)
      });
    }
  }
  if (exactMinionCost !== undefined) {
    let allMinions = collectibleMinionPoolCache.get(cardDb);
    if (!allMinions) {
      allMinions = listCardInfos(cardDb)
        .filter((card) => card.collectible === true && card.cardType === "随从")
        .sort(compareCardInfo);
      collectibleMinionPoolCache.set(cardDb, allMinions);
    }
    sections.push({
      key: `random-minions-exact-${exactMinionCost}`,
      title: `卡库可见的${exactMinionCost}费随从候选`,
      emptyText: `当前卡牌库没有${exactMinionCost}费随从`,
      cards: allMinions
        .filter((card) => card.dbfId !== source.dbfId && card.manaCost === exactMinionCost)
        .map(toRelatedCardInfo)
    });
  }
  sectionsByCard.set(source.dbfId, sections);
  return sections;
}

export function isRandomSpellPoolCard(card: CardInfo): boolean {
  return RANDOM_SPELL_POOL_PATTERN.test(card.text ?? "");
}

function randomExactCostMinionPool(text: string): number | undefined {
  return numberValue(text.match(RANDOM_EXACT_COST_MINION_POOL_PATTERN)?.[1]);
}

function resolveRandomSpellPool(
  text: string,
  allSpells: readonly CardInfo[]
): { readonly title: string; readonly cards: readonly CardInfo[] } {
  const phrase = text.match(RANDOM_SPELL_POOL_PATTERN)?.[0] ?? "";
  const minimum = numberValue(phrase.match(/(?:大于或等于|不低于)[（(]?\s*(\d+)/)?.[1]);
  const maximum = numberValue(phrase.match(/(?:小于或等于|不高于)[（(]?\s*(\d+)/)?.[1]);
  const exact = minimum === undefined && maximum === undefined
    ? numberValue(phrase.match(/法力值消耗为[（(]?\s*(\d+)/)?.[1])
    : undefined;
  const heroClass = RANDOM_SPELL_CLASS_NAMES.find((name) => phrase.includes(`${name}法术`));
  const school = Object.keys(SPELL_SCHOOL_IDS).find((name) => phrase.includes(`${name}法术`));
  const isSecretPool = phrase.includes("奥秘");
  let cards = allSpells.filter((card) =>
    (minimum === undefined || (card.manaCost ?? -1) >= minimum) &&
    (maximum === undefined || (card.manaCost ?? Number.MAX_SAFE_INTEGER) <= maximum) &&
    (exact === undefined || card.manaCost === exact) &&
    (!heroClass || (card.heroClasses ?? []).includes(normalizeHeroClass(heroClass)!)) &&
    (!school || card.spellSchoolId === SPELL_SCHOOL_IDS[school] || card.spellSchool === school) &&
    (!isSecretPool || card.mechanics?.includes("SECRET") || card.text?.startsWith("奥秘："))
  );
  const qualifier = heroClass
    ? normalizeHeroClass(heroClass)
    : school
      ? school
      : exact !== undefined
        ? `${exact}费`
        : minimum !== undefined
          ? `${minimum}费及以上`
          : maximum !== undefined ? `${maximum}费及以下` : undefined;
  let title = qualifier
    ? `卡库可见的${qualifier}${isSecretPool ? "奥秘" : "法术"}候选`
    : `卡库可见的随机${isSecretPool ? "奥秘" : "法术"}候选`;
  if (/从你的牌库中随机施放/.test(text)) {
    title += "（实际按当时牌库缩小）";
  } else if (/法力值消耗(?:相同|增加|减少)/.test(phrase) || /法力值消耗为[（(]\s*[）)]/.test(phrase)) {
    title += "（实际按当时费用缩小）";
  } else if (/另一职业/.test(phrase)) {
    title += "（实际按当时职业缩小）";
  }
  return { title, cards };
}

type SynergyRole = "produce" | "consume";

interface CardNameMention {
  readonly name: string;
  readonly role: SynergyRole;
  readonly verb: string;
}

const CARD_NAME_PREFIX_LENGTH = 4;
const MAX_ACTION_DISTANCE = 24;
const MAX_SYNERGY_CARDS = 6;
const PRODUCER_ACTIONS = ["召唤", "制造", "获取", "获得", "置入", "加入", "发现", "复制", "变形为"] as const;
const CONSUMER_ACTIONS = ["复活", "触发", "消耗", "消灭", "牺牲", "摧毁", "使用", "施放", "打出", "控制", "拥有", "强化"] as const;
const ACTION_BOUNDARIES = ["。", "；", ";", "！", "!", "？", "?", "\n"] as const;
const synergyIndexCache = new WeakMap<CardDatabase, ReadonlyMap<number, readonly CardSynergyInfo[]>>();

export function inferCardSynergies(cardDb: CardDatabase, source: CardInfo): readonly CardSynergyInfo[] {
  let index = synergyIndexCache.get(cardDb);
  if (!index) {
    index = buildCardSynergyIndex(cardDb);
    synergyIndexCache.set(cardDb, index);
  }
  return index.get(source.dbfId) ?? [];
}

function buildCardSynergyIndex(cardDb: CardDatabase): ReadonlyMap<number, readonly CardSynergyInfo[]> {
  const allCards = listCardInfos(cardDb);
  const cards = allCards.filter(isSynergyEligibleCard).sort((left, right) => left.dbfId - right.dbfId);
  const namePrefixes = buildCardNamePrefixes(cards);
  const mentionsByReference = new Map<string, { produce: Map<number, MentionedCard>; consume: Map<number, MentionedCard> }>();

  for (const card of cards) {
    for (const mention of findCardNameMentions(card, namePrefixes)) {
      const group = mentionsByReference.get(mention.name) ?? { produce: new Map(), consume: new Map() };
      group[mention.role].set(card.dbfId, { card, verb: mention.verb });
      mentionsByReference.set(mention.name, group);
    }
  }

  const results = new Map<number, Map<string, CardSynergyInfo>>();
  for (const [referenceName, group] of mentionsByReference) {
    for (const source of group.produce.values()) {
      for (const target of group.consume.values()) {
        addSynergy(results, source, target, referenceName);
        addSynergy(results, target, source, referenceName);
      }
    }
  }

  const indexedResults = new Map<number, readonly CardSynergyInfo[]>(
    [...results].map(([dbfId, cardsByName]) => [
      dbfId,
      Object.freeze([...cardsByName.values()].slice(0, MAX_SYNERGY_CARDS))
    ])
  );
  const resultsByCanonicalCardId = new Map<string, readonly CardSynergyInfo[]>();
  for (const card of cards) {
    const canonicalCardId = normalizeSynergyCardId(card.cardId ?? card.id);
    const cardResults = indexedResults.get(card.dbfId);
    if (canonicalCardId && cardResults && !resultsByCanonicalCardId.has(canonicalCardId)) {
      resultsByCanonicalCardId.set(canonicalCardId, cardResults);
    }
  }
  for (const card of allCards) {
    if (indexedResults.has(card.dbfId)) {
      continue;
    }
    const canonicalCardId = normalizeSynergyCardId(card.cardId ?? card.id);
    const canonicalResults = canonicalCardId ? resultsByCanonicalCardId.get(canonicalCardId) : undefined;
    if (canonicalResults) {
      indexedResults.set(card.dbfId, canonicalResults);
    }
  }
  return indexedResults;
}

interface MentionedCard {
  readonly card: CardInfo;
  readonly verb: string;
}

function addSynergy(
  results: Map<number, Map<string, CardSynergyInfo>>,
  source: MentionedCard,
  target: MentionedCard,
  referenceName: string
): void {
  if (source.card.dbfId === target.card.dbfId || source.card.name === target.card.name) {
    return;
  }

  const cardsByName = results.get(source.card.dbfId) ?? new Map<string, CardSynergyInfo>();
  if (!cardsByName.has(target.card.name)) {
    cardsByName.set(target.card.name, {
      ...toRelatedCardInfo(target.card),
      reason: `共同关联「${referenceName}」：${source.verb} ↔ ${target.verb}`
    });
  }
  results.set(source.card.dbfId, cardsByName);
}

function isSynergyEligibleCard(card: CardInfo): boolean {
  return card.collectible === true
    && Boolean(card.text)
    && Boolean(card.imageUrl || card.cropImageUrl)
    && Array.from(card.name).length >= CARD_NAME_PREFIX_LENGTH
    && BROWSABLE_CARD_TYPES.has(card.cardType ?? "");
}

function normalizeSynergyCardId(cardId: string | undefined): string | undefined {
  return cardId ? normalizeCardId(cardId).replace(/^core_/, "") : undefined;
}

function buildCardNamePrefixes(cards: readonly CardInfo[]): ReadonlyMap<string, readonly string[]> {
  const prefixes = new Map<string, string[]>();
  for (const name of new Set(cards.map((card) => card.name))) {
    const prefix = name.slice(0, CARD_NAME_PREFIX_LENGTH);
    const names = prefixes.get(prefix) ?? [];
    names.push(name);
    names.sort((left, right) => right.length - left.length);
    prefixes.set(prefix, names);
  }
  return prefixes;
}

function findCardNameMentions(
  card: CardInfo,
  namePrefixes: ReadonlyMap<string, readonly string[]>
): readonly CardNameMention[] {
  const text = card.text ?? "";
  const mentions = new Map<string, CardNameMention>();
  for (let index = 0; index <= text.length - CARD_NAME_PREFIX_LENGTH; index += 1) {
    const prefix = text.slice(index, index + CARD_NAME_PREFIX_LENGTH);
    const name = (namePrefixes.get(prefix) ?? []).find((candidate) => text.startsWith(candidate, index));
    if (name) {
      const action = findMentionAction(text, index);
      if (action && name !== card.name) {
        mentions.set(`${name}:${action.role}`, { name, ...action });
      }
      index += name.length - 1;
    }
  }
  return [...mentions.values()];
}

function findMentionAction(text: string, mentionIndex: number): Omit<CardNameMention, "name"> | undefined {
  const before = text.slice(Math.max(0, mentionIndex - 30), mentionIndex);
  const boundaryIndex = Math.max(...ACTION_BOUNDARIES.map((boundary) => before.lastIndexOf(boundary)));
  const clause = before.slice(boundaryIndex + 1);
  const producer = findLatestAction(clause, PRODUCER_ACTIONS);
  const consumer = findLatestAction(clause, CONSUMER_ACTIONS);
  const latest = producer.index > consumer.index
    ? { role: "produce" as const, ...producer }
    : consumer.index > producer.index
      ? { role: "consume" as const, ...consumer }
      : undefined;
  return latest && clause.length - latest.index <= MAX_ACTION_DISTANCE
    ? { role: latest.role, verb: latest.verb }
    : undefined;
}

function findLatestAction(text: string, actions: readonly string[]): { readonly index: number; readonly verb: string } {
  return actions.reduce(
    (latest, verb) => {
      const index = text.lastIndexOf(verb);
      return index > latest.index ? { index, verb } : latest;
    },
    { index: -1, verb: "" }
  );
}

export function toRelatedCardInfo(
  { dbfId, name, cardId, manaCost, cardType, rarity, text, imageUrl, cropImageUrl }: CardInfo
): RelatedCardInfo {
  return { dbfId, name, cardId, manaCost, cardType, rarity, text, imageUrl, cropImageUrl };
}

export function createCardIdNameLookup(cardDb: CardDatabase): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>();

  for (const value of Object.values(cardDb)) {
    const cardInfo = parseCardInfo(value);
    const cardId = cardInfo?.cardId ?? cardInfo?.id;
    if (cardInfo && cardId) {
      lookup.set(normalizeCardId(cardId), cardInfo.name);
    }
  }

  return lookup;
}

export function normalizeCardId(cardId: string): string {
  return cardId.trim().toLocaleLowerCase();
}

export function cardArtworkSources(
  card: Pick<CardInfo, "cardId" | "cropImageUrl" | "imageUrl">,
  order: "crop-first" | "image-first" = "crop-first"
): readonly string[] {
  const artworkCardId = card.cardId?.trim();
  const derived = artworkCardId && /^[A-Z0-9_]+$/iu.test(artworkCardId)
    ? {
        crop: `https://art.hearthstonejson.com/v1/tiles/${encodeURIComponent(artworkCardId)}.jpg`,
        image: `https://art.hearthstonejson.com/v1/render/latest/zhCN/256x/${encodeURIComponent(artworkCardId)}.png`
      }
    : undefined;
  const sources = order === "image-first"
    ? [card.imageUrl, card.cropImageUrl, derived?.image, derived?.crop]
    : [card.cropImageUrl, card.imageUrl, derived?.crop, derived?.image];
  return sources.filter((source, index, items): source is string =>
    Boolean(source) && items.indexOf(source) === index
  );
}

function parseCardInfo(value: unknown): CardInfo | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const dbfId = numberValue(value.dbfId) ?? numberValue(value.id);
  const name = value.name;
  if (
    typeof dbfId !== "number" ||
    !Number.isSafeInteger(dbfId) ||
    dbfId <= 0 ||
    typeof name !== "string" ||
    name.trim().length === 0
  ) {
    return undefined;
  }

  const cardId = stringValue(value.cardId) ?? stringValue(value.id);
  const id = stringValue(value.id);
  const cardTypeId = numberValue(value.cardTypeId) ?? numberValue(value.card_type_id) ?? numberValue(value.type);
  const rawCardType = stringValue(value.cardType) ?? stringValue(value.type);
  const cardType = normalizeCardType(rawCardType, cardTypeId);
  const rarity = normalizeCardRarity(
    stringValue(value.rarity) ?? stringValue(value.rarityName) ?? stringValue(value.rarity_name),
    numberValue(value.rarityId) ?? numberValue(value.rarity_id)
  );
  const spellSchoolId = numberValue(value.spellSchoolId) ?? numberValue(value.spell_school_id);
  const spellSchool =
    stringValue(value.spellSchool) ??
    stringValue(value.spell_school) ??
    Object.entries(SPELL_SCHOOL_IDS).find(([, id]) => id === spellSchoolId)?.[0];
  const heroClasses = parseHeroClasses(value);
  const races = parseCardRaces(value);
  const relatedCardIds = uniqueNumbers([
    ...numberArray(value.relatedCardIds),
    ...numberArray(value.child_ids),
    ...numberArray(value.childIds),
    ...numberArray(value.bundledCardIds),
    ...numberArray(value.bundled_card_ids),
    ...(numberValue(value.parent_id) ?? numberValue(value.parentId)
      ? [numberValue(value.parent_id) ?? numberValue(value.parentId)!]
      : [])
  ]);

  return {
    dbfId,
    name,
    cardId,
    id,
    collectible: booleanValue(value.collectible),
    manaCost: numberValue(value.mana_cost) ?? numberValue(value.manaCost) ?? numberValue(value.cost),
    attack: numberValue(value.attack),
    health: numberValue(value.health),
    text: cleanCardText(stringValue(value.text) ?? stringValue(value.description)),
    cardTypeId,
    cardType,
    rarity,
    spellSchoolId,
    spellSchool,
    heroClass: heroClasses.length > 0 ? heroClasses.join(" / ") : undefined,
    heroClasses: heroClasses.length > 0 ? heroClasses : undefined,
    races: races.length > 0 ? races : undefined,
    imageUrl: stringValue(value.image) ?? stringValue(value.imageUrl) ?? stringValue(value.img),
    cropImageUrl: validCropImageUrl(value.crop_image) ?? validCropImageUrl(value.cropImage) ?? validCropImageUrl(value.cropImageUrl),
    relatedCardIds: relatedCardIds.length > 0 ? relatedCardIds : undefined,
    mechanics: textArray(value.mechanics).map((mechanic) => mechanic.toUpperCase())
  };
}

function normalizeCardRarity(rawRarity: string | undefined, rarityId: number | undefined): CardRarity | undefined {
  if (rawRarity) {
    const normalized = rawRarity.trim().toLocaleUpperCase("zh-CN");
    if (normalized === "FREE" || normalized === "基本" || normalized === "免费") {
      return "FREE";
    }
    if (normalized === "COMMON" || normalized === "普通") {
      return "COMMON";
    }
    if (normalized === "RARE" || normalized === "稀有") {
      return "RARE";
    }
    if (normalized === "EPIC" || normalized === "史诗") {
      return "EPIC";
    }
    if (normalized === "LEGENDARY" || normalized === "传说") {
      return "LEGENDARY";
    }
  }

  const officialRarityById: Readonly<Record<number, CardRarity>> = {
    1: "COMMON",
    2: "FREE",
    3: "RARE",
    4: "EPIC",
    5: "LEGENDARY"
  };

  if (rarityId !== undefined) {
    return officialRarityById[rarityId] ?? "UNKNOWN";
  }

  return rawRarity ? "UNKNOWN" : undefined;
}

function matchesCardLibraryQuery(card: CardInfo, query: NormalizedCardLibraryQuery, normalizedSearch: string): boolean {
  if (query.heroClass && !(card.heroClasses ?? []).includes(query.heroClass)) {
    return false;
  }

  if (query.cardType && card.cardType !== query.cardType) {
    return false;
  }

  if (!normalizedSearch) {
    return true;
  }

  return [card.name, card.cardId, card.id, card.text, card.heroClass, card.cardType]
    .filter((value): value is string => typeof value === "string")
    .some((value) => normalizeSearchText(value).includes(normalizedSearch));
}

function isBrowsableCard(card: CardInfo): boolean {
  const name = card.name.trim();
  return (
    name.length > 0 &&
    card.collectible === true &&
    !/[?？]/.test(name) &&
    !/^unknown(?:\s+card)?$/i.test(name) &&
    BROWSABLE_CARD_TYPES.has(card.cardType ?? "")
  );
}

function compareCardInfo(left: CardInfo, right: CardInfo): number {
  const manaDifference = (left.manaCost ?? Number.MAX_SAFE_INTEGER) - (right.manaCost ?? Number.MAX_SAFE_INTEGER);
  if (manaDifference !== 0) {
    return manaDifference;
  }

  const nameDifference = CARD_LIBRARY_COLLATOR.compare(left.name, right.name);
  return nameDifference !== 0 ? nameDifference : left.dbfId - right.dbfId;
}

function parseHeroClasses(value: Record<string, unknown>): string[] {
  const sourceValues = [
    value.heroClasses,
    value.classes,
    value.class,
    value.cardClass,
    value.card_class,
    value.playerClass,
    value.player_class,
    value.className,
    value.class_name,
    value.heroClass
  ];

  const numericClassIds = [
    numberValue(value.classId),
    numberValue(value.class_id),
    ...numberArray(value.multiClassIds),
    ...numberArray(value.multi_class_ids)
  ].filter((id): id is number => id !== undefined);
  return uniqueStrings([
    ...sourceValues.flatMap(extractHeroClassValues),
    ...numericClassIds
      .map((id) => OFFICIAL_HERO_CLASSES[id])
      .filter((heroClass): heroClass is string => heroClass !== undefined)
  ]);
}

const OFFICIAL_HERO_CLASSES: Readonly<Record<number, string>> = {
  1: "死亡骑士",
  2: "德鲁伊",
  3: "猎人",
  4: "法师",
  5: "圣骑士",
  6: "牧师",
  7: "盗贼",
  8: "萨满祭司",
  9: "术士",
  10: "战士",
  12: "中立",
  14: "恶魔猎手"
};

const OFFICIAL_MINION_TYPE_RACES: Readonly<Record<number, string>> = {
  2: "DRAENEI",
  11: "UNDEAD",
  14: "MURLOC",
  15: "DEMON",
  17: "MECHANICAL",
  18: "ELEMENTAL",
  20: "BEAST",
  21: "TOTEM",
  23: "PIRATE",
  24: "DRAGON",
  26: "ALL",
  43: "QUILBOAR",
  92: "NAGA"
};

function parseCardRaces(value: Record<string, unknown>): string[] {
  const scalarRaces = [
    stringValue(value.race),
    stringValue(value.raceName),
    stringValue(value.race_name)
  ].filter((race): race is string => Boolean(race));
  const officialMinionTypeId =
    numberValue(value.minionTypeId) ??
    numberValue(value.minion_type_id);
  const officialRace = officialMinionTypeId === undefined
    ? undefined
    : OFFICIAL_MINION_TYPE_RACES[officialMinionTypeId];
  return uniqueStrings([
    ...scalarRaces,
    ...textArray(value.races),
    ...textArray(value.raceIds),
    ...textArray(value.race_ids),
    ...(officialRace ? [officialRace] : [])
  ]).map((race) => race.toLocaleUpperCase());
}

function extractHeroClassValues(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(/[|,/]/)
      .map((entry) => normalizeHeroClass(entry))
      .filter((entry): entry is string => entry !== undefined);
  }

  if (Array.isArray(value)) {
    return value.flatMap(extractHeroClassValues);
  }

  return [];
}

export function normalizeHeroClass(value: unknown): string | undefined {
  const source = stringValue(value);
  if (!source) {
    return undefined;
  }

  const normalized = source.replace(/[\s_-]+/g, "").toUpperCase();
  const knownClasses: Record<string, string> = {
    WARRIOR: "战士",
    战士: "战士",
    SHAMAN: "萨满祭司",
    萨满: "萨满祭司",
    萨满祭司: "萨满祭司",
    ROGUE: "盗贼",
    盗贼: "盗贼",
    PALADIN: "圣骑士",
    圣骑士: "圣骑士",
    HUNTER: "猎人",
    猎人: "猎人",
    DRUID: "德鲁伊",
    德鲁伊: "德鲁伊",
    WARLOCK: "术士",
    术士: "术士",
    MAGE: "法师",
    法师: "法师",
    PRIEST: "牧师",
    牧师: "牧师",
    DEMONHUNTER: "恶魔猎手",
    恶魔猎手: "恶魔猎手",
    DEATHKNIGHT: "死亡骑士",
    死亡骑士: "死亡骑士",
    NEUTRAL: "中立",
    中立: "中立"
  };

  return knownClasses[normalized] ?? source;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === 1 || value === "1" || value === "true") {
    return true;
  }

  if (value === 0 || value === "0" || value === "false") {
    return false;
  }

  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function validCropImageUrl(value: unknown): string | undefined {
  const url = stringValue(value);
  if (!url) {
    return undefined;
  }

  try {
    const filename = new URL(url).pathname.split("/").at(-1)?.toLocaleLowerCase();
    return filename && INVALID_CROP_IMAGE_FILENAMES.has(filename) ? undefined : url;
  } catch {
    return url;
  }
}

function numberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(numberValue).filter((entry): entry is number => entry !== undefined && Number.isSafeInteger(entry) && entry > 0);
}

function textArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (isRecord(entry)) return [stringValue(entry.name) ?? stringValue(entry.id)].filter((item): item is string => Boolean(item));
    return [];
  });
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)];
}

function cleanCardText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const text = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();

  return text.length > 0 ? text : undefined;
}

export function normalizeCardType(value: string | undefined, cardTypeId: number | undefined): string | undefined {
  if (cardTypeId !== undefined) {
    const byId: Record<number, string> = {
      3: "英雄",
      4: "随从",
      5: "法术",
      7: "武器",
      39: "地标"
    };
    if (byId[cardTypeId]) {
      return byId[cardTypeId];
    }
  }

  const byName: Record<string, string> = {
    HERO: "英雄",
    MINION: "随从",
    SPELL: "法术",
    WEAPON: "武器",
    LOCATION: "地标"
  };
  return value ? byName[value.toUpperCase()] ?? value : undefined;
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function sortText(values: readonly string[]): string[] {
  return [...values].sort((left, right) => CARD_LIBRARY_COLLATOR.compare(left, right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
