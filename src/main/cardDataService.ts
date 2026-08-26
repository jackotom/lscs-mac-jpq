import { app } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createCardDatabase, getCardInfo, listCardInfos, type CardDatabase } from "../shared/cardDatabase.js";
import { readValidatedJsonCache, writeValidatedJsonCache } from "./atomicJsonCache.js";

const OFFICIAL_PAGE_URL = "https://hs.blizzard.cn/cards/";
const OFFICIAL_CARDS_URL = "https://webapi.blizzard.cn/hs-cards-api-server/api/web/cards/constructed";
const LEGACY_CARD_DATABASE_URL = "https://api.hearthstonejson.com/v1/latest/zhCN/cards.json";
const LEGACY_COLLECTIBLE_DATABASE_URL = "https://api.hearthstonejson.com/v1/latest/zhCN/cards.collectible.json";
const FOREIGN_SUPPLEMENTAL_DATABASE_URLS = [
  "https://static.zerotoheroes.com/data/cards/no_audio/cards_zhCN.gz.json",
  "https://static.firestoneapp.com/data/cards/no_audio/cards_zhCN.gz.json"
] as const;
const CACHE_FILE_NAME = "hearthstone-cards.zhCN.blizzard.json";
const LEGACY_ALL_CACHE_FILE_NAME = "hearthstone-cards.zhCN.all.json";
const LEGACY_CACHE_FILE_NAME = "hearthstone-cards.zhCN.collectible.json";
const FOREIGN_SUPPLEMENTAL_CACHE_FILE_NAME = "hearthstone-cards.foreign-supplement.json";
const OFFICIAL_CARD_PAGE_SIZE = 200;
const FETCH_TIMEOUT_MS = 6000;
const FOREIGN_FETCH_BUDGET_MS = 30000;
const FOREIGN_FETCH_ATTEMPT_TIMEOUT_MS = 15000;
const OVERALL_FETCH_BUDGET_MS = 15000;
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const CACHE_SCHEMA_VERSION = 1;
const SOURCE_NAME = "Blizzard 官方卡牌浏览器";
const FOREIGN_SUPPLEMENTAL_SOURCE_NAME = "Firestone 全量中文卡牌库";
const FOREIGN_SUPPLEMENTAL_MIN_CARD_COUNT = 30_000;
const FOREIGN_SUPPLEMENTAL_MIN_VALID_RATIO = 0.99;
const REQUIRED_AZEROTHS_MOST_WANTED_CARD_IDS = [
  "CAP_000", "CAP_001", "CAP_002", "CAP_003", "CAP_004", "CAP_005", "CAP_006",
  "CAP_101", "CAP_102", "CAP_103", "CAP_104", "CAP_105", "CAP_106", "CAP_107",
  "CAP_400", "CAP_401", "CAP_402", "CAP_403", "CAP_404", "CAP_405", "CAP_406", "CAP_407",
  "CAP_800", "CAP_801", "CAP_802", "CAP_803", "CAP_804", "CAP_805", "CAP_806"
] as const;

export interface CardDatabaseLoadResult {
  readonly database?: CardDatabase;
  readonly warnings: readonly string[];
  readonly source?: string;
  readonly version?: string;
  readonly cardCount?: number;
}

export interface CardDatabaseLoadOptions {
  readonly preferCache?: boolean;
  readonly forceRefresh?: boolean;
  readonly cacheMaxAgeMs?: number;
}

interface CachedCardDatabaseLoadResult extends CardDatabaseLoadResult {
  readonly cards: readonly unknown[];
  readonly fetchedAt: string;
  readonly version?: string;
  readonly isStale: boolean;
  readonly requiresRelatedCardRefresh: boolean;
  readonly requiresForeignSupplementRefresh: boolean;
}

interface OfficialCardsResponse {
  readonly code?: number;
  readonly data?: {
    readonly list?: readonly unknown[];
    readonly total?: number;
  };
}

interface LegacyCardDatabaseProvider {
  load(): Promise<CardDatabase | undefined>;
}

interface ForeignSupplementalRefreshResult {
  readonly database?: CardDatabase;
  readonly warning?: string;
}

interface SharedCardDatabaseLoad {
  readonly promise: Promise<CardDatabaseLoadResult>;
  readonly forceRefresh: boolean;
}

const foreignSupplementalRefreshes = new Map<string, Promise<ForeignSupplementalRefreshResult>>();
const sharedCardDatabaseLoads = new Map<string, SharedCardDatabaseLoad>();

export class CardDataService {
  private cachedDatabase: CardDatabase | undefined;
  private cachedForeignSupplementalDatabase: CardDatabase | undefined;
  private foreignSupplementalWarnings: string[] = [];
  private readonly cachePath: string;
  private readonly legacyAllCachePath: string;
  private readonly legacyCachePath: string;
  private readonly foreignSupplementalCachePath: string;
  private readonly fetcher: typeof fetch;

  constructor(cachePath = path.join(app.getPath("userData"), CACHE_FILE_NAME), fetcher: typeof fetch = fetch) {
    this.cachePath = cachePath;
    this.legacyAllCachePath = path.join(path.dirname(cachePath), LEGACY_ALL_CACHE_FILE_NAME);
    this.legacyCachePath = path.join(path.dirname(cachePath), LEGACY_CACHE_FILE_NAME);
    this.foreignSupplementalCachePath = path.join(path.dirname(cachePath), FOREIGN_SUPPLEMENTAL_CACHE_FILE_NAME);
    this.fetcher = fetcher;
  }

  async loadCardDatabase(options: CardDatabaseLoadOptions = {}): Promise<CardDatabaseLoadResult> {
    if (this.cachedDatabase && !options.forceRefresh && !options.preferCache) {
      return this.toResult(this.cachedDatabase);
    }

    if (options.preferCache && !options.forceRefresh) {
      return this.loadCardDatabaseOnce(options);
    }

    const sharedLoad = sharedCardDatabaseLoads.get(this.cachePath);
    if (sharedLoad) {
      if (options.forceRefresh && !sharedLoad.forceRefresh) {
        await sharedLoad.promise.catch(() => undefined);
        return this.loadCardDatabase(options);
      }
      return sharedLoad.promise;
    }

    const operation = this.loadCardDatabaseOnce(options);
    const tracked = operation.finally(() => {
      if (sharedCardDatabaseLoads.get(this.cachePath)?.promise === tracked) {
        sharedCardDatabaseLoads.delete(this.cachePath);
      }
    });
    sharedCardDatabaseLoads.set(this.cachePath, {
      promise: tracked,
      forceRefresh: options.forceRefresh === true
    });
    return tracked;
  }

  private async loadCardDatabaseOnce(options: CardDatabaseLoadOptions): Promise<CardDatabaseLoadResult> {
    this.foreignSupplementalWarnings = [];
    const cached = await this.readCache(options.cacheMaxAgeMs);
    if (cached?.database) {
      if (!options.forceRefresh && options.preferCache) {
        this.cachedDatabase = cached.database;
        return this.toResult(cached.database, cached.version, cached.warnings);
      }

      let readyCache = cached;
      let foreignRefreshAttempted = false;
      if (cached.requiresForeignSupplementRefresh) {
        foreignRefreshAttempted = true;
        const foreignSupplementalDatabase = await this.readForeignSupplementalCardDatabase();
        const database = mergeCardDatabases(cached.database, foreignSupplementalDatabase);
        if (database && foreignSupplementalDatabase) {
          readyCache = {
            ...cached,
            database,
            cardCount: Object.keys(database).length,
            requiresForeignSupplementRefresh: false
          };
        }
      }
      if (
        !options.forceRefresh &&
        !readyCache.requiresForeignSupplementRefresh &&
        (options.preferCache || (
          !readyCache.isStale &&
          !readyCache.requiresRelatedCardRefresh
        ))
      ) {
        const readyDatabase = readyCache.database ?? cached.database;
        this.cachedDatabase = readyDatabase;
        return this.toResult(readyDatabase, readyCache.version, readyCache.warnings);
      }

      return this.refreshOfficial(
        readyCache,
        Boolean(options.forceRefresh),
        [],
        foreignRefreshAttempted
      );
    }

    return this.refreshOfficial(undefined, false, cached?.warnings ?? []);
  }

  private async refreshOfficial(
    cached: CachedCardDatabaseLoadResult | undefined,
    forceRefresh = false,
    initialWarnings: readonly string[] = [],
    foreignRefreshAttempted = false
  ): Promise<CardDatabaseLoadResult> {
    let legacyDatabase: CardDatabase | undefined;
    const overallStartTime = Date.now();
    const baseWarnings = cached?.warnings ?? initialWarnings;
    const currentWarnings = () => [...baseWarnings, ...this.foreignSupplementalWarnings];

    try {
      const version = await this.fetchOfficialSourceVersion();
      if (
        !forceRefresh &&
        cached?.database &&
        cached.version &&
        cached.version === version &&
        !cached.isStale &&
        !cached.requiresRelatedCardRefresh &&
        !cached.requiresForeignSupplementRefresh
      ) {
        return this.toResult(cached.database, version, currentWarnings());
      }

      const officialCards = await this.fetchOfficialCards(overallStartTime);
      legacyDatabase = await this.readLegacyCardDatabase({
        refreshForeign: !foreignRefreshAttempted,
        allowForeignNetwork: !foreignRefreshAttempted
      });
      const mergedCards = mergeOfficialCards(officialCards, legacyDatabase);
      const database = createCardDatabase(mergedCards);
      if (Object.keys(database).length === 0) {
        throw new Error("官网卡牌库没有返回可用卡牌");
      }
      const fetchedAt = new Date().toISOString();
      await writeValidatedJsonCache(
        this.cachePath,
        { schemaVersion: CACHE_SCHEMA_VERSION, source: SOURCE_NAME, version, fetchedAt, cards: mergedCards },
        parseUsableCachedCards
      );
      if (this.cachedForeignSupplementalDatabase) {
        this.cachedDatabase = database;
      }

      return this.toResult(database, version, currentWarnings());
    } catch (error) {
      if (cached?.database) {
        return {
          ...this.toResult(cached.database, cached.version),
          warnings: [
            ...currentWarnings(),
            `官网卡牌库更新失败，继续使用本地 v${cached.version ?? "旧缓存"}：${formatError(error)}`
          ]
        };
      }

      legacyDatabase ??= await this.readLegacyCardDatabase({
        refreshForeign: !foreignRefreshAttempted,
        allowForeignNetwork: !foreignRefreshAttempted
      });
      if (legacyDatabase) {
        if (this.cachedForeignSupplementalDatabase) {
          this.cachedDatabase = legacyDatabase;
        }
        return {
          ...this.toResult(legacyDatabase),
          warnings: [...currentWarnings(), `官网卡牌库读取失败，继续使用旧卡牌库：${formatError(error)}`]
        };
      }

      return { warnings: [...currentWarnings(), `卡牌数据库读取失败：${formatError(error)}`] };
    }
  }

  private async readCache(cacheMaxAgeMs = CACHE_MAX_AGE_MS): Promise<CachedCardDatabaseLoadResult | undefined> {
    const cache = await readValidatedJsonCache(this.cachePath, parseUsableCachedCards, "卡牌数据库");
    if (cache.value) {
      const parsed = cache.value;
      const foreignSupplementalCache = await readValidatedJsonCache(
        this.foreignSupplementalCachePath,
        parseForeignSupplementalCache,
        "海外卡牌补充库"
      );
      this.cachedForeignSupplementalDatabase = foreignSupplementalCache.value?.database;
      const database = mergeCardDatabases(parsed.database, foreignSupplementalCache.value?.database) ?? parsed.database;
      const fetchedAt = parsed.fetchedAt ?? new Date(cache.mtimeMs ?? Date.now()).toISOString();
      const fetchedAtMs = Date.parse(fetchedAt);
      const requiresRelatedCardRefresh = hasMissingRelatedCards(database);
      return {
        cards: parsed.cards,
        database,
        warnings: [cache.warning, foreignSupplementalCache.warning]
          .filter((warning): warning is string => Boolean(warning)),
        source: parsed.source ?? SOURCE_NAME,
        version: parsed.version,
        cardCount: Object.keys(database).length,
        fetchedAt,
        isStale: !Number.isFinite(fetchedAtMs) || Date.now() - fetchedAtMs > cacheMaxAgeMs,
        requiresRelatedCardRefresh,
        requiresForeignSupplementRefresh: !foreignSupplementalCache.value?.database
      };
    }

    return cache.warning ? {
      cards: [],
      warnings: [cache.warning],
      fetchedAt: "",
      isStale: true,
      requiresRelatedCardRefresh: false,
      requiresForeignSupplementRefresh: true
    } : undefined;
  }

  private async readLegacyCardDatabase(options: {
    readonly refreshForeign?: boolean;
    readonly allowForeignNetwork?: boolean;
  } = {}): Promise<CardDatabase | undefined> {
    const [legacyDatabase, foreignSupplementalDatabase] = await Promise.all([
      this.readPrimaryLegacyCardDatabase(),
      this.readForeignSupplementalCardDatabase(
        options.refreshForeign === true,
        options.allowForeignNetwork !== false
      )
    ]);
    return mergeCardDatabases(legacyDatabase, foreignSupplementalDatabase);
  }

  private async readPrimaryLegacyCardDatabase(): Promise<CardDatabase | undefined> {
    const cachedAll = await readJsonArray(this.legacyAllCachePath);
    if (cachedAll) {
      const database = createCardDatabase(cachedAll);
      if (Object.keys(database).length > 0) {
        return database;
      }
    }

    try {
      const payload = await this.fetchJson(LEGACY_CARD_DATABASE_URL);
      if (Array.isArray(payload)) {
        await fs.mkdir(path.dirname(this.legacyAllCachePath), { recursive: true });
        await fs.writeFile(this.legacyAllCachePath, JSON.stringify(payload), "utf8");
        const database = createCardDatabase(payload);
        if (Object.keys(database).length > 0) {
          return database;
        }
      }
    } catch {
      // Fall back to the smaller collectible database when the full legacy mirror is unavailable.
    }

    const cachedCollectible = await readJsonArray(this.legacyCachePath);
    if (cachedCollectible) {
      const database = createCardDatabase(cachedCollectible);
      if (Object.keys(database).length > 0) {
        return database;
      }
    }

    try {
      const payload = await this.fetchJson(LEGACY_COLLECTIBLE_DATABASE_URL);
      if (Array.isArray(payload)) {
        const database = createCardDatabase(payload);
        return Object.keys(database).length > 0 ? database : undefined;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private async readForeignSupplementalCardDatabase(
    forceRefresh = false,
    allowNetwork = true
  ): Promise<CardDatabase | undefined> {
    if (this.cachedForeignSupplementalDatabase && !forceRefresh) {
      return this.cachedForeignSupplementalDatabase;
    }
    if (allowNetwork) {
      const refresh = await this.refreshForeignSupplementalCardDatabase();
      if (refresh.warning) {
        this.foreignSupplementalWarnings.push(refresh.warning);
      }
      if (refresh.database) {
        this.cachedForeignSupplementalDatabase = refresh.database;
        return refresh.database;
      }
    }

    const cached = await readValidatedJsonCache(
      this.foreignSupplementalCachePath,
      parseForeignSupplementalCache,
      "海外卡牌补充库"
    );
    this.cachedForeignSupplementalDatabase = cached.value?.database;
    return this.cachedForeignSupplementalDatabase;
  }

  private async refreshForeignSupplementalCardDatabase(): Promise<ForeignSupplementalRefreshResult> {
    const inFlight = foreignSupplementalRefreshes.get(this.foreignSupplementalCachePath);
    if (inFlight) {
      return inFlight;
    }

    const operation = this.downloadForeignSupplementalCardDatabase();
    const tracked = operation.finally(() => {
      if (foreignSupplementalRefreshes.get(this.foreignSupplementalCachePath) === tracked) {
        foreignSupplementalRefreshes.delete(this.foreignSupplementalCachePath);
      }
    });
    foreignSupplementalRefreshes.set(this.foreignSupplementalCachePath, tracked);
    return tracked;
  }

  private async downloadForeignSupplementalCardDatabase(): Promise<ForeignSupplementalRefreshResult> {
    const failures: string[] = [];
    const deadline = Date.now() + FOREIGN_FETCH_BUDGET_MS;
    for (const sourceUrl of FOREIGN_SUPPLEMENTAL_DATABASE_URLS) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        failures.push("刷新超过 30 秒整体时间预算");
        break;
      }
      try {
        const payload = await this.fetchJson(
          sourceUrl,
          undefined,
          Math.min(FOREIGN_FETCH_ATTEMPT_TIMEOUT_MS, remainingMs)
        );
        const parsed = parseForeignSupplementalCards(payload);
        if (!parsed) {
          failures.push(`${sourceUrl} 返回数据未通过完整性校验`);
          continue;
        }
        await writeValidatedJsonCache(
          this.foreignSupplementalCachePath,
          {
            schemaVersion: CACHE_SCHEMA_VERSION,
            source: FOREIGN_SUPPLEMENTAL_SOURCE_NAME,
            fetchedAt: new Date().toISOString(),
            cards: parsed.cards
          },
          parseForeignSupplementalCache
        );
        return { database: parsed.database };
      } catch (error) {
        failures.push(`${sourceUrl} ${formatError(error)}`);
      }
    }

    return {
      warning: `Firestone 补充卡牌库刷新失败，继续使用本地可用数据：${failures.join("；")}`
    };
  }

  private async fetchOfficialSourceVersion(): Promise<string> {
    const html = await this.fetchText(OFFICIAL_PAGE_URL);
    const versionMatch = html.match(/https:\/\/hs\.res\.netease\.com\/pc\/zt\/[^"'\s]+\/js\/cards\/index_[^"'\s]+\.js/);
    if (!versionMatch?.[0]) {
      throw new Error("官网卡牌页面版本号未找到");
    }

    return versionMatch[0];
  }

  private async fetchOfficialCards(overallStartTime = Date.now(), budgetMs = OVERALL_FETCH_BUDGET_MS): Promise<readonly unknown[]> {
    const cards: unknown[] = [];
    let page = 1;
    let total: number | undefined;

    while (total === undefined || cards.length < total) {
      const elapsed = Date.now() - overallStartTime;
      if (elapsed > budgetMs) {
        throw new Error(`官网卡牌拉取超过整体时间预算（已耗时 ${elapsed}ms，预算 ${budgetMs}ms），提前中断并开始降级。`);
      }

      const payload = (await this.fetchJson(OFFICIAL_CARDS_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          page,
          page_size: OFFICIAL_CARD_PAGE_SIZE,
          class: "all",
          mana_cost: [],
          sort: "manaCost:asc",
          set: "all",
          text_filter: "",
          attack: -1,
          faction: "",
          health: -1,
          keyword: "",
          minion_type: "",
          rarity: "",
          spell_school: "",
          type: ""
        })
      })) as OfficialCardsResponse;

      if (payload.code !== 0 || !payload.data || !Array.isArray(payload.data.list) || typeof payload.data.total !== "number") {
        throw new Error(`官网卡牌接口返回格式无效（第 ${page} 页）`);
      }

      total = payload.data.total;
      if (payload.data.list.length === 0) {
        break;
      }

      cards.push(...payload.data.list);
      page += 1;
      if (page > 100) {
        throw new Error("官网卡牌分页超过安全上限");
      }
    }

    if (total === undefined || cards.length !== total) {
      throw new Error(`官网卡牌数量不完整：${cards.length}/${total ?? "?"}`);
    }

    return cards;
  }

  private async fetchJson(url: string, init?: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<unknown> {
    return this.fetchWithTimeout(url, init, timeoutMs, (response) => response.json());
  }

  private async fetchText(url: string): Promise<string> {
    return this.fetchWithTimeout(url, undefined, FETCH_TIMEOUT_MS, (response) => response.text());
  }

  private async fetchWithTimeout<T>(
    url: string,
    init: RequestInit | undefined,
    timeoutMs: number,
    read: (response: Response) => Promise<T>
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetcher(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await read(response);
    } finally {
      clearTimeout(timeout);
    }
  }

  private toResult(
    database: CardDatabase,
    version?: string,
    warnings: readonly string[] = []
  ): CardDatabaseLoadResult {
    return {
      database,
      warnings,
      source: SOURCE_NAME,
      version,
      cardCount: Object.keys(database).length
    };
  }
}

function parseCachedCards(value: unknown): {
  readonly cards: readonly unknown[];
  readonly source?: string;
  readonly version?: string;
  readonly fetchedAt?: string;
} | undefined {
  if (Array.isArray(value)) {
    return { cards: value };
  }

  if (
    !isRecord(value)
    || (value.schemaVersion !== undefined && value.schemaVersion !== CACHE_SCHEMA_VERSION)
    || !Array.isArray(value.cards)
    || typeof value.fetchedAt !== "string"
  ) {
    return undefined;
  }

  return {
    cards: value.cards,
    source: typeof value.source === "string" ? value.source : undefined,
    version: typeof value.version === "string" ? value.version : undefined,
    fetchedAt: value.fetchedAt
  };
}

function parseUsableCachedCards(value: unknown): (ReturnType<typeof parseCachedCards> & { readonly database: CardDatabase }) | undefined {
  const parsed = parseCachedCards(value);
  if (!parsed) {
    return undefined;
  }
  const database = createCardDatabase(parsed.cards);
  return Object.keys(database).length > 0 ? { ...parsed, database } : undefined;
}

function mergeOfficialCards(officialCards: readonly unknown[], legacyDatabase?: CardDatabase): unknown[] {
  const merged: unknown[] = [];
  const officialDbfIds = new Set<number>();

  for (const card of officialCards) {
    if (!isRecord(card) || typeof card.id !== "number" || !Number.isSafeInteger(card.id)) {
      continue;
    }

    const legacy = legacyDatabase ? getCardInfo(legacyDatabase, card.id) : undefined;
    merged.push({
      ...card,
      dbfId: card.id,
      ...(legacy?.cardId || legacy?.id ? { cardId: legacy.cardId ?? legacy.id } : {}),
      ...(legacy?.manaCost !== undefined ? { manaCost: legacy.manaCost } : {}),
      ...(legacy?.cardType ? { cardType: legacy.cardType } : {}),
      ...(legacy?.rarity ? { rarity: legacy.rarity } : {}),
      ...(legacy?.heroClasses?.length ? { heroClasses: legacy.heroClasses } : {}),
      ...(legacy?.races?.length ? { races: legacy.races } : {}),
      ...(legacy?.mechanics?.length ? { mechanics: legacy.mechanics } : {}),
      ...(legacy?.relatedCardIds?.length ? { relatedCardIds: legacy.relatedCardIds } : {}),
      ...(legacy?.text && !hasCardText(card) ? { text: legacy.text } : {}),
      ...(legacy?.imageUrl ? { imageUrl: legacy.imageUrl } : {}),
      ...(legacy?.cropImageUrl ? { cropImageUrl: legacy.cropImageUrl } : {})
    });
    officialDbfIds.add(card.id);
  }

  for (const value of Object.values(legacyDatabase ?? {})) {
    const legacy = isRecord(value) ? getCardInfo(legacyDatabase!, Number(value.dbfId)) : undefined;
    if (!legacy || officialDbfIds.has(legacy.dbfId)) {
      continue;
    }

    merged.push(legacy);
  }

  return merged;
}

function hasCardText(card: Record<string, unknown>): boolean {
  return [card.text, card.description].some((value) => typeof value === "string" && value.trim().length > 0);
}

function mergeCardDatabases(
  primaryDatabase: CardDatabase | undefined,
  supplementalDatabase: CardDatabase | undefined
): CardDatabase | undefined {
  if (!primaryDatabase) return supplementalDatabase;
  if (!supplementalDatabase) return primaryDatabase;

  const merged = new Map(listCardInfos(primaryDatabase).map((card) => [card.dbfId, card]));
  for (const supplemental of listCardInfos(supplementalDatabase)) {
    const primary = merged.get(supplemental.dbfId);
    merged.set(supplemental.dbfId, primary ? {
      ...supplemental,
      ...primary,
      cardId: primary.cardId ?? supplemental.cardId,
      id: primary.id ?? supplemental.id ?? supplemental.cardId,
      collectible: primary.collectible ?? supplemental.collectible,
      manaCost: primary.manaCost ?? supplemental.manaCost,
      attack: primary.attack ?? supplemental.attack,
      health: primary.health ?? supplemental.health,
      text: primary.text ?? supplemental.text,
      cardTypeId: primary.cardTypeId ?? supplemental.cardTypeId,
      cardType: primary.cardType ?? supplemental.cardType,
      rarity: primary.rarity ?? supplemental.rarity,
      spellSchoolId: primary.spellSchoolId ?? supplemental.spellSchoolId,
      spellSchool: primary.spellSchool ?? supplemental.spellSchool,
      heroClass: primary.heroClass ?? supplemental.heroClass,
      heroClasses: primary.heroClasses?.length ? primary.heroClasses : supplemental.heroClasses,
      races: primary.races?.length ? primary.races : supplemental.races,
      imageUrl: primary.imageUrl ?? supplemental.imageUrl,
      cropImageUrl: primary.cropImageUrl ?? supplemental.cropImageUrl,
      relatedCardIds: primary.relatedCardIds?.length ? primary.relatedCardIds : supplemental.relatedCardIds,
      mechanics: primary.mechanics?.length ? primary.mechanics : supplemental.mechanics
    } : supplemental);
  }
  return createCardDatabase([...merged.values()]);
}

function parseForeignSupplementalCards(value: unknown): {
  readonly cards: readonly unknown[];
  readonly database: CardDatabase;
} | undefined {
  if (
    !Array.isArray(value) ||
    value.length < FOREIGN_SUPPLEMENTAL_MIN_CARD_COUNT ||
    value.length > 100_000
  ) {
    return undefined;
  }
  const enrichedCards = value.map((card) => {
    if (!isRecord(card) || typeof card.id !== "string") return card;
    const cardId = card.id.trim();
    if (!/^[A-Za-z0-9_]{1,120}$/.test(cardId)) return card;
    return {
      ...card,
      cardId,
      imageUrl: `https://art.hearthstonejson.com/v1/render/latest/zhCN/256x/${encodeURIComponent(cardId)}.png`,
      cropImageUrl: `https://art.hearthstonejson.com/v1/tiles/${encodeURIComponent(cardId)}.jpg`
    };
  });
  const database = createCardDatabase(enrichedCards);
  const cards = listCardInfos(database);
  const cardIds = new Set(cards.map((card) => card.cardId));
  if (
    cards.length / value.length < FOREIGN_SUPPLEMENTAL_MIN_VALID_RATIO ||
    !REQUIRED_AZEROTHS_MOST_WANTED_CARD_IDS.every((cardId) => cardIds.has(cardId)) ||
    cards.some((card) => !card.cardId || !/^[A-Za-z0-9_]{1,120}$/.test(card.cardId))
  ) {
    return undefined;
  }
  return { cards: enrichedCards, database };
}

function parseForeignSupplementalCache(value: unknown): {
  readonly cards: readonly unknown[];
  readonly database: CardDatabase;
} | undefined {
  const parsed = parseCachedCards(value);
  return parsed ? parseForeignSupplementalCards(parsed.cards) : undefined;
}

function hasMissingRelatedCards(database: CardDatabase): boolean {
  return listCardInfos(database).some((card) =>
    (card.relatedCardIds ?? []).some((relatedDbfId) => getCardInfo(database, relatedDbfId) === undefined)
  );
}

async function readJsonArray(filePath: string): Promise<readonly unknown[] | undefined> {
  try {
    const value = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    return Array.isArray(value) ? value : undefined;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
