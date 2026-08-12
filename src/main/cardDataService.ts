import { app } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createCardDatabase, getCardInfo, listCardInfos, type CardDatabase } from "../shared/cardDatabase.js";
import { readValidatedJsonCache, writeValidatedJsonCache } from "./atomicJsonCache.js";

const OFFICIAL_PAGE_URL = "https://hs.blizzard.cn/cards/";
const OFFICIAL_CARDS_URL = "https://webapi.blizzard.cn/hs-cards-api-server/api/web/cards/constructed";
const LEGACY_CARD_DATABASE_URL = "https://api.hearthstonejson.com/v1/latest/zhCN/cards.json";
const LEGACY_COLLECTIBLE_DATABASE_URL = "https://api.hearthstonejson.com/v1/latest/zhCN/cards.collectible.json";
const CACHE_FILE_NAME = "hearthstone-cards.zhCN.blizzard.json";
const LEGACY_ALL_CACHE_FILE_NAME = "hearthstone-cards.zhCN.all.json";
const LEGACY_CACHE_FILE_NAME = "hearthstone-cards.zhCN.collectible.json";
const OFFICIAL_CARD_PAGE_SIZE = 200;
const FETCH_TIMEOUT_MS = 6000;
const OVERALL_FETCH_BUDGET_MS = 15000;
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const CACHE_SCHEMA_VERSION = 1;
const SOURCE_NAME = "Blizzard 官方卡牌浏览器";

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

export class CardDataService {
  private cachedDatabase: CardDatabase | undefined;
  private readonly cachePath: string;
  private readonly legacyAllCachePath: string;
  private readonly legacyCachePath: string;
  private readonly fetcher: typeof fetch;

  constructor(cachePath = path.join(app.getPath("userData"), CACHE_FILE_NAME), fetcher: typeof fetch = fetch) {
    this.cachePath = cachePath;
    this.legacyAllCachePath = path.join(path.dirname(cachePath), LEGACY_ALL_CACHE_FILE_NAME);
    this.legacyCachePath = path.join(path.dirname(cachePath), LEGACY_CACHE_FILE_NAME);
    this.fetcher = fetcher;
  }

  async loadCardDatabase(options: CardDatabaseLoadOptions = {}): Promise<CardDatabaseLoadResult> {
    if (this.cachedDatabase && !options.forceRefresh) {
      return this.toResult(this.cachedDatabase);
    }

    const cached = await this.readCache(options.cacheMaxAgeMs);
    if (cached?.database) {
      this.cachedDatabase = cached.database;
      if (!options.forceRefresh && (options.preferCache || (!cached.isStale && !cached.requiresRelatedCardRefresh))) {
        return this.toResult(cached.database, cached.version, cached.warnings);
      }

      return this.refreshOfficial(cached, Boolean(options.forceRefresh));
    }

    return this.refreshOfficial(undefined, false, cached?.warnings ?? []);
  }

  private async refreshOfficial(
    cached: CachedCardDatabaseLoadResult | undefined,
    forceRefresh = false,
    initialWarnings: readonly string[] = []
  ): Promise<CardDatabaseLoadResult> {
    let legacyDatabase: CardDatabase | undefined;
    const overallStartTime = Date.now();
    const cacheWarnings = cached?.warnings ?? initialWarnings;

    try {
      const version = await this.fetchOfficialSourceVersion();
      if (
        !forceRefresh &&
        cached?.database &&
        cached.version &&
        cached.version === version &&
        !cached.isStale &&
        !cached.requiresRelatedCardRefresh
      ) {
        return this.toResult(cached.database, version, cacheWarnings);
      }

      const officialCards = await this.fetchOfficialCards(overallStartTime);
      legacyDatabase = await this.readLegacyCardDatabase();
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
      this.cachedDatabase = database;

      return this.toResult(database, version, cacheWarnings);
    } catch (error) {
      if (cached?.database) {
        return {
          ...this.toResult(cached.database, cached.version),
          warnings: [
            ...cacheWarnings,
            `官网卡牌库更新失败，继续使用本地 v${cached.version ?? "旧缓存"}：${formatError(error)}`
          ]
        };
      }

      legacyDatabase ??= await this.readLegacyCardDatabase();
      if (legacyDatabase) {
        this.cachedDatabase = legacyDatabase;
        return {
          ...this.toResult(legacyDatabase),
          warnings: [...cacheWarnings, `官网卡牌库读取失败，继续使用旧卡牌库：${formatError(error)}`]
        };
      }

      return { warnings: [...cacheWarnings, `卡牌数据库读取失败：${formatError(error)}`] };
    }
  }

  private async readCache(cacheMaxAgeMs = CACHE_MAX_AGE_MS): Promise<CachedCardDatabaseLoadResult | undefined> {
    const cache = await readValidatedJsonCache(this.cachePath, parseUsableCachedCards, "卡牌数据库");
    if (cache.value) {
      const parsed = cache.value;
      const fetchedAt = parsed.fetchedAt ?? new Date(cache.mtimeMs ?? Date.now()).toISOString();
      const fetchedAtMs = Date.parse(fetchedAt);
      const requiresRelatedCardRefresh = hasMissingRelatedCards(parsed.database);
      return {
        cards: parsed.cards,
        database: parsed.database,
        warnings: cache.warning ? [cache.warning] : [],
        source: parsed.source ?? SOURCE_NAME,
        version: parsed.version,
        cardCount: Object.keys(parsed.database).length,
        fetchedAt,
        isStale: !Number.isFinite(fetchedAtMs) || Date.now() - fetchedAtMs > cacheMaxAgeMs,
        requiresRelatedCardRefresh
      };
    }

    return cache.warning ? {
      cards: [],
      warnings: [cache.warning],
      fetchedAt: "",
      isStale: true,
      requiresRelatedCardRefresh: false
    } : undefined;
  }

  private async readLegacyCardDatabase(): Promise<CardDatabase | undefined> {
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

  private async fetchJson(url: string, init?: RequestInit): Promise<unknown> {
    const response = await this.fetchResponse(url, init);
    return response.json();
  }

  private async fetchText(url: string): Promise<string> {
    const response = await this.fetchResponse(url);
    return response.text();
  }

  private async fetchResponse(url: string, init?: RequestInit) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await this.fetcher(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response;
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
      ...(legacy?.cardId || legacy?.id ? { cardId: legacy.cardId ?? legacy.id } : {})
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
