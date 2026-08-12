import { app } from "electron";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { toFirestoneClassSlug } from "../shared/arenaRatings.js";
import { readValidatedJsonCache, writeValidatedJsonCache } from "./atomicJsonCache.js";
import type {
  ArenaRatingTable,
  FirestoneCardRating,
  FirestoneClassRatingSource,
  FirestoneDraftBucket,
  FirestoneRatingSource,
  HearthArenaWebLocaleRatingSource,
  HearthArenaWebRatingSource
} from "../shared/arenaRatings.js";

const SOURCE = "Arena Tracker / HearthArena";
const VERSION_URL = "https://raw.githubusercontent.com/supertriodo/Arena-Tracker/master/HearthArena/haVersion.json";
const RATINGS_URL = "https://raw.githubusercontent.com/supertriodo/Arena-Tracker/master/HearthArena/hearthArena.json";
const FIRESTONE_CARD_STATS_URL = "https://static.zerotoheroes.com/api/arena/stats/cards/arena-underground/last-patch/global.gz.json?v=6";
const FIRESTONE_CLASS_OVERVIEW_URL = "https://static.zerotoheroes.com/api/arena/stats/classes/arena-underground/last-patch/overview.gz.json";
const FIRESTONE_DRAFT_STATS_URLS = [
  "https://static.zerotoheroes.com/api/arena/stats/draft/arena/last-patch/global.gz.json?v=6",
  "https://static.zerotoheroes.com/api/arena/stats/draft/arena-underground/last-patch/global.gz.json?v=6"
] as const;
const HEARTH_ARENA_WEB_SOURCES = [
  { locale: "zh-cn", url: "https://www.heartharena.com/zh-cn/tierlist" },
  { locale: "zh-tw", url: "https://www.heartharena.com/zh-tw/tierlist" }
] as const;
const CACHE_FILE_NAME = "hearthstone-arena-ratings.json";
const FIRESTONE_CLASS_CACHE_SCHEMA_VERSION = 1;
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const FETCH_RETRY_DELAY_MS = 150;
const FETCH_ATTEMPTS = 2;
const HEARTH_ARENA_CLASS_BY_SLUG: Readonly<Record<string, string>> = {
  "death-knight": "Death Knight",
  "demon-hunter": "Demon Hunter",
  druid: "Druid",
  hunter: "Hunter",
  mage: "Mage",
  paladin: "Paladin",
  priest: "Priest",
  rogue: "Rogue",
  shaman: "Shaman",
  warlock: "Warlock",
  warrior: "Warrior",
  any: "Neutral",
  neutral: "Neutral"
};

export interface ArenaRatingLoadResult {
  readonly table?: ArenaRatingTable;
  readonly warnings: readonly string[];
  readonly firestoneClassCacheStatus?: "fresh" | "stale" | "missing";
}

export class ArenaRatingService {
  private readonly cachePath: string | undefined;
  private readonly fetcher: typeof fetch;
  private cachedTable: ArenaRatingTable | undefined;
  private cachedTableLoadedAt = 0;
  private cachedTableCacheMtimeMs: number | undefined;
  private baseRefreshPromise: Promise<void> | undefined;
  private baseRefreshWarning: string | undefined;
  private baseRefreshRetryAfter = 0;
  private readonly firestoneClassLoadedAt = new Map<string, number>();
  private readonly firestoneClassRefreshPromises = new Map<string, Promise<ArenaRatingLoadResult>>();
  private readonly firestoneClassRefreshWarnings = new Map<string, string>();

  constructor(cachePath?: string, fetcher: typeof fetch = fetch) {
    this.cachePath = cachePath;
    this.fetcher = fetcher;
  }

  async loadRatings(className?: string): Promise<ArenaRatingLoadResult> {
    const base = await this.loadBaseRatings();
    const classSlug = toFirestoneClassSlug(className);
    const classLoadedAt = classSlug ? this.firestoneClassLoadedAt.get(classSlug) : undefined;
    if (
      !base.table ||
      !classSlug ||
      (base.table.firestoneClasses?.[classSlug] && classLoadedAt !== undefined && Date.now() - classLoadedAt < CACHE_MAX_AGE_MS)
    ) {
      return classSlug && base.table?.firestoneClasses?.[classSlug]
        ? { ...base, firestoneClassCacheStatus: "fresh" }
        : base;
    }

    const cachedClass = base.table.firestoneClasses?.[classSlug] ?? await this.readFirestoneClassCache(classSlug);
    if (cachedClass) {
      const table = this.mergeFirestoneClass(base.table, cachedClass);
      if (!(await this.isClassCacheStale(classSlug, cachedClass))) {
        this.firestoneClassLoadedAt.set(classSlug, Date.now());
        return {
          table,
          warnings: base.warnings,
          firestoneClassCacheStatus: "fresh"
        };
      }

      this.startFirestoneClassRefresh(table, classSlug);
      return {
        table,
        warnings: [
          ...base.warnings,
          this.firestoneClassRefreshWarnings.get(classSlug)
            ?? `Firestone ${classSlug} 卡组影响缓存已过期，正在后台更新；继续使用本地缓存`
        ],
        firestoneClassCacheStatus: "stale"
      };
    }

    const classResult = await this.getFirestoneClassRefresh(base.table, classSlug);
    const source = classResult.table?.firestoneClasses?.[classSlug];
    const mergedTable = source ? this.mergeFirestoneClass(this.cachedTable ?? base.table, source) : base.table;
    if (classResult.firestoneClassCacheStatus === "fresh") {
      this.firestoneClassLoadedAt.set(classSlug, Date.now());
    } else {
      this.firestoneClassLoadedAt.delete(classSlug);
    }
    return {
      table: mergedTable ?? base.table,
      warnings: [...base.warnings, ...classResult.warnings],
      firestoneClassCacheStatus: classResult.firestoneClassCacheStatus
    };
  }

  private async loadBaseRatings(): Promise<ArenaRatingLoadResult> {
    if (this.cachedTable && Date.now() - this.cachedTableLoadedAt < CACHE_MAX_AGE_MS) {
      const warnings = this.baseRefreshWarning ? [this.baseRefreshWarning] : [];
      return { table: this.cachedTable, warnings };
    }

    if (this.cachedTable) {
      if (Date.now() >= this.baseRefreshRetryAfter) {
        this.startBaseRefresh(this.cachedTable);
      }
      return {
        table: this.cachedTable,
        warnings: [
          this.baseRefreshWarning
            ?? `竞技场评分缓存已过期，正在后台更新；继续使用本地 v${this.cachedTable.version}`
        ]
      };
    }

    const cachedResult = await this.readCache();
    const cached = cachedResult.table;
    const cacheWarnings = cachedResult.warning ? [cachedResult.warning] : [];
    if (cached) {
      this.cachedTable = cached;
      this.cachedTableCacheMtimeMs = cachedResult.mtimeMs;
      if (!cached.firestone || !hasFirestoneDraftStats(cached.firestone) || !hasHearthArenaWebStats(cached.hearthArenaWeb)) {
        this.cachedTableLoadedAt = 0;
        return this.refresh(cached, cacheWarnings, cachedResult.mtimeMs);
      }
      if (await this.isStale(cachedResult.mtimeMs)) {
        this.cachedTableLoadedAt = 0;
        this.startBaseRefresh(cached);
        return {
          table: cached,
          warnings: [...cacheWarnings, `竞技场评分缓存已过期，正在后台更新；继续使用本地 v${cached.version}`]
        };
      }
      this.cachedTableLoadedAt = Date.now();
      return { table: cached, warnings: cacheWarnings };
    }

    return this.refresh(undefined, cacheWarnings);
  }

  private startBaseRefresh(cached: ArenaRatingTable): void {
    if (this.baseRefreshPromise) {
      return;
    }
    const promise = this.refresh(cached, [], this.cachedTableCacheMtimeMs)
      .then((result) => {
        this.baseRefreshWarning = result.warnings[0];
        this.baseRefreshRetryAfter = result.warnings.length > 0 ? Date.now() + FETCH_RETRY_DELAY_MS : 0;
      })
      .catch((error) => {
        this.baseRefreshWarning = `竞技场评分更新失败，继续使用本地 v${cached.version}：${formatError(error)}`;
        this.baseRefreshRetryAfter = Date.now() + FETCH_RETRY_DELAY_MS;
      })
      .finally(() => {
        if (this.baseRefreshPromise === promise) {
          this.baseRefreshPromise = undefined;
        }
      });
    this.baseRefreshPromise = promise;
  }

  private startFirestoneClassRefresh(table: ArenaRatingTable, classSlug: string): void {
    void this.getFirestoneClassRefresh(table, classSlug)
      .then((result) => {
        const source = result.table?.firestoneClasses?.[classSlug];
        if (source) {
          this.mergeFirestoneClass(this.cachedTable ?? table, source);
        }
        if (result.firestoneClassCacheStatus === "fresh") {
          this.firestoneClassLoadedAt.set(classSlug, Date.now());
          this.firestoneClassRefreshWarnings.delete(classSlug);
        } else {
          this.firestoneClassLoadedAt.delete(classSlug);
          if (result.warnings[0]) {
            this.firestoneClassRefreshWarnings.set(classSlug, result.warnings[0]);
          }
        }
      })
      .catch((error) => {
        this.firestoneClassLoadedAt.delete(classSlug);
        this.firestoneClassRefreshWarnings.set(
          classSlug,
          `Firestone ${classSlug} 卡组影响更新失败，继续使用本地缓存：${formatError(error)}`
        );
      });
  }

  private getFirestoneClassRefresh(
    table: ArenaRatingTable,
    classSlug: string
  ): Promise<ArenaRatingLoadResult> {
    const active = this.firestoneClassRefreshPromises.get(classSlug);
    if (active) {
      return active;
    }
    const promise = this.loadFirestoneClassRatings(table, classSlug)
      .finally(() => {
        if (this.firestoneClassRefreshPromises.get(classSlug) === promise) {
          this.firestoneClassRefreshPromises.delete(classSlug);
        }
      });
    this.firestoneClassRefreshPromises.set(classSlug, promise);
    return promise;
  }

  private mergeFirestoneClass(table: ArenaRatingTable, source: FirestoneClassRatingSource): ArenaRatingTable {
    const latestTable = this.cachedTable ?? table;
    const mergedTable = withFirestoneClass(latestTable, source);
    this.cachedTable = mergedTable;
    return mergedTable;
  }

  private async loadFirestoneClassRatings(
    table: ArenaRatingTable,
    classSlug: string
  ): Promise<ArenaRatingLoadResult> {
    const cached = await this.readFirestoneClassCache(classSlug);
    if (cached && !(await this.isClassCacheStale(classSlug, cached))) {
      return { table: withFirestoneClass(table, cached), warnings: [], firestoneClassCacheStatus: "fresh" };
    }

    try {
      const [overviewPayload, cardPayload] = await Promise.all([
        this.fetchJson(FIRESTONE_CLASS_OVERVIEW_URL),
        this.fetchJson(firestoneClassCardsUrl(classSlug))
      ]);
      const source = parseFirestoneClass(overviewPayload, cardPayload, classSlug);
      const cachePath = this.getClassCachePath(classSlug);
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, JSON.stringify(source), "utf8");
      return { table: withFirestoneClass(table, source), warnings: [], firestoneClassCacheStatus: "fresh" };
    } catch (error) {
      if (cached) {
        return {
          table: withFirestoneClass(table, cached),
          warnings: [`Firestone ${classSlug} 卡组影响更新失败，继续使用本地缓存：${formatError(error)}`],
          firestoneClassCacheStatus: "stale"
        };
      }
      return {
        table,
        warnings: [`Firestone ${classSlug} 卡组影响读取失败：${formatError(error)}`],
        firestoneClassCacheStatus: "missing"
      };
    }
  }

  private async readFirestoneClassCache(classSlug: string): Promise<FirestoneClassRatingSource | undefined> {
    try {
      return parseFirestoneClassCache(JSON.parse(await fs.readFile(this.getClassCachePath(classSlug), "utf8")), classSlug);
    } catch {
      return undefined;
    }
  }

  private async isClassCacheStale(classSlug: string, source?: FirestoneClassRatingSource) {
    if (source?.schemaVersion !== FIRESTONE_CLASS_CACHE_SCHEMA_VERSION) {
      return true;
    }
    try {
      const stat = await fs.stat(this.getClassCachePath(classSlug));
      return Date.now() - stat.mtimeMs > CACHE_MAX_AGE_MS;
    } catch {
      return true;
    }
  }

  private async refresh(
    cached: ArenaRatingTable | undefined,
    initialWarnings: readonly string[] = [],
    cacheMtimeMs = this.cachedTableCacheMtimeMs
  ): Promise<ArenaRatingLoadResult> {
    const warnings: string[] = [...initialWarnings];

    try {
      const cacheIsStale = !cached || (await this.isStale(cacheMtimeMs));
      const versionPayload = await this.fetchJson(VERSION_URL);
      const version = parseVersion(versionPayload);
      const firestoneVersion = await this.fetchFirestoneVersion().catch((error) => {
        warnings.push(`Firestone 评分版本读取失败：${formatError(error)}`);
        return undefined;
      });
      const needsHearthArena = !cached || version !== cached.version;
      const needsHearthArenaWeb = cacheIsStale || !hasHearthArenaWebStats(cached.hearthArenaWeb);
      const needsFirestone =
        !cached?.firestone ||
        firestoneVersion === undefined ||
        cached.firestone.version !== firestoneVersion ||
        !hasFirestoneDraftStats(cached.firestone);

      if (!needsHearthArena && !needsHearthArenaWeb && !needsFirestone && cached) {
        const table = preserveFirestoneClasses(cached, this.cachedTable);
        this.cachedTable = table;
        this.cachedTableLoadedAt = Date.now();
        return { table, warnings };
      }

      const ratings = needsHearthArena ? parseRatings(await this.fetchJson(RATINGS_URL)) : cached?.ratings;
      if (!ratings) {
        throw new Error("HearthArena 评分数据为空");
      }

      let hearthArenaWeb = cached?.hearthArenaWeb;
      if (needsHearthArenaWeb) {
        const nextLocales = await Promise.all(
          HEARTH_ARENA_WEB_SOURCES.map(async (source) => {
            try {
              return parseHearthArenaWebLocale(source.locale, source.url, await this.fetchText(source.url));
            } catch (error) {
              warnings.push(`HearthArena ${source.locale} 网页评分读取失败：${formatError(error)}`);
              return cached?.hearthArenaWeb?.locales[source.locale];
            }
          })
        );
        hearthArenaWeb = buildHearthArenaWebSource(nextLocales.filter((locale): locale is HearthArenaWebLocaleRatingSource => Boolean(locale))) ?? hearthArenaWeb;
      }

      let firestone = cached?.firestone;
      if (needsFirestone) {
        try {
          const cardStatsPayload = await this.fetchJson(FIRESTONE_CARD_STATS_URL);
          const draftStatsPayloads = await Promise.all(
            FIRESTONE_DRAFT_STATS_URLS.map(async (url) => {
              try {
                return await this.fetchJson(url);
              } catch (error) {
                warnings.push(`Firestone 选牌统计读取失败：${formatError(error)}`);
                return undefined;
              }
            })
          );
          firestone = parseFirestone(cardStatsPayload, draftStatsPayloads, firestoneVersion);
        } catch (error) {
          if (!firestone) {
            throw error;
          }
          warnings.push(`Firestone 评分读取失败，继续使用本地缓存：${formatError(error)}`);
        }
      }

      const table: ArenaRatingTable = {
        source: SOURCE,
        version,
        fetchedAt: new Date().toISOString(),
        ratings,
        hearthArenaWeb,
        firestone,
        firestoneClasses: this.cachedTable?.firestoneClasses ?? cached?.firestoneClasses
      };
      const cachePath = this.getCachePath();
      await writeValidatedJsonCache(cachePath, table, parseCachedTable);
      this.cachedTable = table;
      this.cachedTableLoadedAt = Date.now();
      this.cachedTableCacheMtimeMs = Date.now();
      const refreshWarning = warnings.slice(initialWarnings.length)[0];
      this.baseRefreshWarning = refreshWarning;
      this.baseRefreshRetryAfter = refreshWarning ? Date.now() + FETCH_RETRY_DELAY_MS : 0;
      return { table, warnings };
    } catch (error) {
      if (cached) {
        const table = preserveFirestoneClasses(cached, this.cachedTable);
        const refreshWarning = `竞技场评分更新失败，继续使用本地 v${cached.version}：${formatError(error)}`;
        this.cachedTable = table;
        this.cachedTableLoadedAt = 0;
        this.baseRefreshWarning = refreshWarning;
        this.baseRefreshRetryAfter = Date.now() + FETCH_RETRY_DELAY_MS;
        return {
          table,
          warnings: [...warnings, refreshWarning]
        };
      }
      return { warnings: [...warnings, `竞技场评分读取失败：${formatError(error)}`] };
    }
  }

  private async readCache(): Promise<{
    readonly table?: ArenaRatingTable;
    readonly warning?: string;
    readonly mtimeMs?: number;
  }> {
    const cache = await readValidatedJsonCache(this.getCachePath(), parseCachedTable, "竞技场评分");
    return { table: cache.value, warning: cache.warning, mtimeMs: cache.mtimeMs };
  }

  private async isStale(mtimeMs = this.cachedTableCacheMtimeMs) {
    if (mtimeMs !== undefined) {
      return Date.now() - mtimeMs > CACHE_MAX_AGE_MS;
    }
    try {
      const stat = await fs.stat(this.getCachePath());
      return Date.now() - stat.mtimeMs > CACHE_MAX_AGE_MS;
    } catch {
      return true;
    }
  }

  private getCachePath(): string {
    return this.cachePath ?? path.join(app.getPath("userData"), CACHE_FILE_NAME);
  }

  private getClassCachePath(classSlug: string): string {
    const parsed = path.parse(this.getCachePath());
    return path.join(parsed.dir, `${parsed.name}-firestone-${classSlug}${parsed.ext || ".json"}`);
  }

  private async fetchJson(url: string): Promise<unknown> {
    return this.withShortRetry(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await this.fetcher(url, { headers: { accept: "application/json" }, signal: controller.signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  private async fetchText(url: string): Promise<string> {
    return this.withShortRetry(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await this.fetcher(url, {
          headers: {
            accept: "text/html,application/xhtml+xml",
            "user-agent": "Mozilla/5.0 HearthstoneMacTracker/0.1"
          },
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.text();
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  private async fetchFirestoneVersion(): Promise<string> {
    const [cardVersion, draftVersion] = await Promise.all([
      this.fetchVersionHeader(FIRESTONE_CARD_STATS_URL),
      Promise.all(FIRESTONE_DRAFT_STATS_URLS.map((url) => this.fetchVersionHeader(url))).then((versions) => uniqueStrings(versions).join(","))
    ]);
    return `cards:${cardVersion}|draft:${draftVersion}`;
  }

  private async fetchVersionHeader(url: string): Promise<string> {
    return this.withShortRetry(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await this.fetcher(url, {
          method: "HEAD",
          headers: { accept: "application/json" },
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const version = response.headers.get("last-modified") ?? response.headers.get("etag");
        if (!version) {
          throw new Error("Firestone 评分版本号未找到");
        }
        return version;
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  private async withShortRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt + 1 >= FETCH_ATTEMPTS || !isRetryableFetchError(error)) {
          throw error;
        }
        await delay(FETCH_RETRY_DELAY_MS);
      }
    }
    throw lastError;
  }
}

function preserveFirestoneClasses(
  base: ArenaRatingTable,
  latest: ArenaRatingTable | undefined
): ArenaRatingTable {
  const firestoneClasses = latest?.firestoneClasses ?? base.firestoneClasses;
  return firestoneClasses ? { ...base, firestoneClasses } : base;
}

function isRetryableFetchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const status = /^HTTP (\d+)$/.exec(message)?.[1];
  if (!status) {
    return true;
  }
  const code = Number(status);
  return code === 408 || code === 429 || code >= 500;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseCachedTable(value: unknown): ArenaRatingTable | undefined {
  if (!isRecord(value) || typeof value.source !== "string" || typeof value.version !== "number" || typeof value.fetchedAt !== "string") {
    return undefined;
  }

  const ratings = parseRatings(value.ratings);
  const hearthArenaWeb = parseHearthArenaWebCache(value.hearthArenaWeb);
  const firestone = parseFirestoneCache(value.firestone);
  return { source: value.source, version: value.version, fetchedAt: value.fetchedAt, ratings, hearthArenaWeb, firestone };
}

function parseHearthArenaWebCache(value: unknown): HearthArenaWebRatingSource | undefined {
  if (!isRecord(value) || value.source !== "HearthArena Web" || typeof value.version !== "string" || !isRecord(value.locales)) {
    return undefined;
  }

  const locales: HearthArenaWebLocaleRatingSource[] = [];
  for (const [locale, rawLocale] of Object.entries(value.locales)) {
    if (!isRecord(rawLocale) || typeof rawLocale.url !== "string" || typeof rawLocale.version !== "string" || typeof rawLocale.fetchedAt !== "string") {
      continue;
    }

    const ratings = parseRatings(rawLocale.ratings);
    const ratingCount = numberValue(rawLocale.ratingCount) ?? countRatings(ratings);
    if (ratingCount <= 0) {
      continue;
    }

    locales.push({
      locale,
      url: rawLocale.url,
      version: rawLocale.version,
      fetchedAt: rawLocale.fetchedAt,
      ratingCount,
      ratings
    });
  }

  return buildHearthArenaWebSource(locales);
}

function parseHearthArenaWebLocale(locale: string, url: string, html: string): HearthArenaWebLocaleRatingSource {
  const ratings: Record<string, Record<string, number>> = {};
  const sectionPattern = /<section class="tab tierlist [^"]*" id="([^"]+)">([\s\S]*?)(?=<section class="tab tierlist [^"]*" id="|<section class="footer"|$)/g;
  const cardPattern =
    /<dl class="card[^"]*">\s*<dt class="([^"]*)"[^>]*data-card-image="([^"]+)"[^>]*>[\s\S]*?<\/dt>\s*<dd class="score[^"]*">\s*([^<]+?)\s*<\/dd>/g;

  for (const sectionMatch of html.matchAll(sectionPattern)) {
    const className = HEARTH_ARENA_CLASS_BY_SLUG[sectionMatch[1] ?? ""];
    if (!className) {
      continue;
    }

    const classRatings = ratings[className] ?? {};
    for (const cardMatch of (sectionMatch[2] ?? "").matchAll(cardPattern)) {
      const cardId = extractCardIdFromImageUrl(cardMatch[2] ?? "");
      const score = parseScoreText(cardMatch[3] ?? "");
      if (cardId && score !== undefined) {
        classRatings[cardId] = score;
      }
    }
    if (Object.keys(classRatings).length) {
      ratings[className] = classRatings;
    }
  }

  const ratingCount = countRatings(ratings);
  if (ratingCount <= 0) {
    throw new Error("HearthArena 网页评分为空");
  }

  return {
    locale,
    url,
    version: shortHash(html),
    fetchedAt: new Date().toISOString(),
    ratingCount,
    ratings
  };
}

function buildHearthArenaWebSource(locales: readonly HearthArenaWebLocaleRatingSource[]): HearthArenaWebRatingSource | undefined {
  if (locales.length === 0) {
    return undefined;
  }

  const byLocale: Record<string, HearthArenaWebLocaleRatingSource> = {};
  for (const locale of locales) {
    byLocale[locale.locale] = locale;
  }

  return {
    source: "HearthArena Web",
    version: locales.map((locale) => `${locale.locale}:${locale.version}`).sort().join("|"),
    locales: byLocale
  };
}

function parseFirestone(value: unknown, draftValue: unknown | readonly unknown[] | undefined, version: string | undefined): FirestoneRatingSource {
  if (!isRecord(value) || typeof value.lastUpdated !== "string" || !Array.isArray(value.stats)) {
    throw new Error("Firestone 评分数据格式无效");
  }

  const ratings: Record<string, FirestoneCardRating> = {};
  for (const entry of value.stats) {
    if (!isRecord(entry) || typeof entry.cardId !== "string" || !isRecord(entry.stats)) {
      continue;
    }

    const stats = entry.stats;
    const includedGames = numberValue(stats.decksWithCard);
    const includedWins = numberValue(stats.decksWithCardThenWin);
    const playedGames = numberValue(stats.played);
    const playedWins = numberValue(stats.playedThenWin);
    const rating: FirestoneCardRating = {
      includedWinrate: ratioAsPercent(includedWins, includedGames),
      playedWinrate: ratioAsPercent(playedWins, playedGames),
      sampleSize: includedGames
    };

    if (rating.includedWinrate !== undefined || rating.playedWinrate !== undefined) {
      ratings[entry.cardId.trim().toUpperCase()] = rating;
    }
  }

  for (const draftRating of parseFirestoneDraftRatings(draftValue)) {
    const current = ratings[draftRating.cardId] ?? {};
    ratings[draftRating.cardId] = {
      ...current,
      ...draftRating.rating
    };
  }

  return {
    source: "Firestone",
    version: version ?? value.lastUpdated,
    lastUpdated: value.lastUpdated,
    ratings
  };
}

function parseFirestoneClass(
  overviewValue: unknown,
  cardValue: unknown,
  classSlug: string
): FirestoneClassRatingSource {
  if (!isRecord(overviewValue) || typeof overviewValue.lastUpdated !== "string" || !Array.isArray(overviewValue.stats)) {
    throw new Error("Firestone 职业基准数据格式无效");
  }
  if (!isRecord(cardValue) || typeof cardValue.lastUpdated !== "string" || !Array.isArray(cardValue.stats)) {
    throw new Error("Firestone 职业单卡数据格式无效");
  }

  const classStats = overviewValue.stats.filter(
    (entry): entry is Record<string, unknown> => isRecord(entry) && entry.playerClass === classSlug
  );
  if (!classStats.length) {
    throw new Error(`Firestone 职业基准未找到：${classSlug}`);
  }
  const validClassStats = classStats
    .map((entry) => ({ wins: numberValue(entry.totalsWins), games: numberValue(entry.totalGames) }))
    .filter((entry): entry is { wins: number; games: number } => entry.wins !== undefined && entry.games !== undefined);
  const overallWins = validClassStats.reduce((total, entry) => total + entry.wins, 0);
  const overallGames = validClassStats.reduce((total, entry) => total + entry.games, 0);
  const overallRatio = ratioValue(overallWins, overallGames);
  if (overallRatio === undefined) {
    throw new Error(`Firestone 职业基准样本无效：${classSlug}`);
  }
  const overallWinrate = roundPercent(overallRatio * 100);

  const ratings: Record<string, FirestoneCardRating> = {};
  for (const entry of cardValue.stats) {
    if (!isRecord(entry) || typeof entry.cardId !== "string" || !isRecord(entry.stats)) {
      continue;
    }
    const sampleSize = numberValue(entry.stats.decksWithCard);
    const includedWins = numberValue(entry.stats.decksWithCardThenWin);
    const includedRatio = ratioValue(includedWins, sampleSize);
    const drawnSampleSize = numberValue(entry.stats.drawn);
    const drawnWins = numberValue(entry.stats.drawnThenWin);
    const drawnRatio = ratioValue(drawnWins, drawnSampleSize);
    if (includedRatio === undefined && drawnRatio === undefined) {
      continue;
    }
    ratings[entry.cardId.trim().toUpperCase()] = {
      ...(includedRatio === undefined ? {} : {
        includedWinrate: roundPercent(includedRatio * 100),
        includedWins,
        sampleSize,
        deckImpact: roundPercent((includedRatio - overallRatio) * 100)
      }),
      ...(drawnRatio === undefined ? {} : {
        drawnWinrate: roundPercent(drawnRatio * 100),
        drawnWins,
        drawnSampleSize,
        drawnImpact: roundPercent((drawnRatio - overallRatio) * 100)
      })
    };
  }

  return {
    source: "Firestone",
    playerClass: classSlug,
    schemaVersion: FIRESTONE_CLASS_CACHE_SCHEMA_VERSION,
    version: `overview:${overviewValue.lastUpdated}|cards:${cardValue.lastUpdated}`,
    lastUpdated: [overviewValue.lastUpdated, cardValue.lastUpdated].sort().at(-1)!,
    overallWinrate,
    overallWins,
    overallGames,
    ratings
  };
}

function parseFirestoneClassCache(value: unknown, classSlug: string): FirestoneClassRatingSource | undefined {
  const overallWins = isRecord(value) ? numberValue(value.overallWins) : undefined;
  const overallGames = isRecord(value) ? numberValue(value.overallGames) : undefined;
  const schemaVersion = isRecord(value) ? numberValue(value.schemaVersion) : undefined;
  const overallRatio = ratioValue(overallWins, overallGames);
  if (
    !isRecord(value) ||
    value.source !== "Firestone" ||
    value.playerClass !== classSlug ||
    typeof value.version !== "string" ||
    typeof value.lastUpdated !== "string" ||
    overallRatio === undefined ||
    !isRecord(value.ratings)
  ) {
    return undefined;
  }
  const overallWinrate = roundPercent(overallRatio * 100);

  const ratings: Record<string, FirestoneCardRating> = {};
  for (const [cardId, rawRating] of Object.entries(value.ratings)) {
    if (!isRecord(rawRating)) {
      continue;
    }
    const rating: FirestoneCardRating = {
      includedWins: numberValue(rawRating.includedWins),
      sampleSize: numberValue(rawRating.sampleSize),
      drawnWins: numberValue(rawRating.drawnWins),
      drawnSampleSize: numberValue(rawRating.drawnSampleSize)
    };
    const includedRatio = ratioValue(rating.includedWins, rating.sampleSize);
    const drawnRatio = ratioValue(rating.drawnWins, rating.drawnSampleSize);
    if (includedRatio !== undefined || drawnRatio !== undefined) {
      ratings[cardId.trim().toUpperCase()] = {
        ...rating,
        ...(includedRatio === undefined ? {} : {
          includedWinrate: roundPercent(includedRatio * 100),
          deckImpact: roundPercent((includedRatio - overallRatio) * 100)
        }),
        ...(drawnRatio === undefined ? {} : {
          drawnWinrate: roundPercent(drawnRatio * 100),
          drawnImpact: roundPercent((drawnRatio - overallRatio) * 100)
        })
      };
    }
  }

  return {
    source: "Firestone",
    playerClass: classSlug,
    schemaVersion,
    version: value.version,
    lastUpdated: value.lastUpdated,
    overallWinrate,
    overallWins,
    overallGames,
    ratings
  };
}

function withFirestoneClass(
  table: ArenaRatingTable,
  source: FirestoneClassRatingSource
): ArenaRatingTable {
  return {
    ...table,
    firestoneClasses: {
      ...table.firestoneClasses,
      [source.playerClass]: source
    }
  };
}

function firestoneClassCardsUrl(classSlug: string) {
  return `https://static.zerotoheroes.com/api/arena/stats/cards/arena-underground/last-patch/${classSlug}.gz.json?v=6`;
}

function parseFirestoneCache(value: unknown): FirestoneRatingSource | undefined {
  if (!isRecord(value) || value.source !== "Firestone" || typeof value.version !== "string" || typeof value.lastUpdated !== "string") {
    return undefined;
  }

  if (!isRecord(value.ratings)) {
    return undefined;
  }

  const ratings: Record<string, FirestoneCardRating> = {};
  for (const [cardId, rawRating] of Object.entries(value.ratings)) {
    if (!isRecord(rawRating)) {
      continue;
    }

    const rating: FirestoneCardRating = {
      includedWinrate: numberValue(rawRating.includedWinrate),
      playedWinrate: numberValue(rawRating.playedWinrate),
      sampleSize: numberValue(rawRating.sampleSize),
      pickRate: numberValue(rawRating.pickRate),
      pickRateSampleSize: numberValue(rawRating.pickRateSampleSize),
      highWinPickRate: numberValue(rawRating.highWinPickRate),
      highWinPickRateSampleSize: numberValue(rawRating.highWinPickRateSampleSize),
      highWinThreshold: numberValue(rawRating.highWinThreshold),
      highWinPickRateImpact: numberValue(rawRating.highWinPickRateImpact),
      twelveWinRate: numberValue(rawRating.twelveWinRate),
      twelveWinRateSampleSize: numberValue(rawRating.twelveWinRateSampleSize),
      draftBuckets: parseCachedDraftBuckets(rawRating.draftBuckets)
    };
    if (hasUsefulFirestoneRating(rating)) {
      ratings[cardId.trim().toUpperCase()] = rating;
    }
  }

  return { source: "Firestone", version: value.version, lastUpdated: value.lastUpdated, ratings };
}

function parseFirestoneDraftRatings(value: unknown | readonly unknown[]): Array<{ cardId: string; rating: FirestoneCardRating }> {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => parseFirestoneDraftRatings(entry));
  }

  if (!isRecord(value) || !Array.isArray(value.stats)) {
    return [];
  }

  const ratings: Array<{ cardId: string; rating: FirestoneCardRating }> = [];
  for (const entry of value.stats) {
    if (!isRecord(entry) || typeof entry.cardId !== "string" || !isRecord(entry.statsByWins)) {
      continue;
    }

    const draftBuckets = parseDraftBuckets(entry.statsByWins) ?? {};
    const baseStats = draftBuckets["0"];
    const highWinBucket = selectHighWinBucket(entry.statsByWins);
    const twelveWinBucket = draftBuckets["12"];
    const pickRate = ratioAsPercent(baseStats?.picked, baseStats?.offered);
    const highWinPickRate = ratioAsPercent(highWinBucket?.bucket.picked, highWinBucket?.bucket.offered);
    const twelveWinRate = ratioAsPercent(twelveWinBucket?.picked, twelveWinBucket?.offered);
    const rating: FirestoneCardRating = {
      pickRate,
      pickRateSampleSize: baseStats?.offered,
      highWinPickRate,
      highWinPickRateSampleSize: highWinBucket?.bucket.offered,
      highWinThreshold: highWinBucket?.wins,
      highWinPickRateImpact:
        highWinPickRate === undefined || pickRate === undefined
          ? undefined
          : roundPercent(highWinPickRate - pickRate),
      twelveWinRate,
      twelveWinRateSampleSize: twelveWinBucket?.offered,
      draftBuckets
    };

    if (hasUsefulFirestoneRating(rating)) {
      ratings.push({ cardId: entry.cardId.trim().toUpperCase(), rating });
    }
  }

  return ratings;
}

function selectHighWinBucket(statsByWins: Record<string, unknown>): { wins: number; bucket: DraftBucket } | undefined {
  for (const wins of [6, 3]) {
    const bucket = parseDraftBucket(statsByWins[String(wins)]);
    if (bucket?.offered !== undefined) {
      return { wins, bucket };
    }
  }

  return Object.entries(statsByWins)
    .map(([wins, rawBucket]) => ({ wins: Number(wins), bucket: parseDraftBucket(rawBucket) }))
    .filter((entry): entry is { wins: number; bucket: DraftBucket } => entry.wins > 0 && entry.wins < 12 && Number.isSafeInteger(entry.wins) && entry.bucket !== undefined)
    .sort((left, right) => right.wins - left.wins)[0];
}

interface DraftBucket {
  readonly offered?: number;
  readonly picked?: number;
}

function parseDraftBucket(value: unknown): DraftBucket | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const offered = numberValue(value.offered);
  const picked = numberValue(value.picked);
  return offered === undefined && picked === undefined ? undefined : { offered, picked };
}

function parseDraftBuckets(value: unknown): Readonly<Record<string, FirestoneDraftBucket>> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const buckets: Record<string, FirestoneDraftBucket> = {};
  for (const [wins, rawBucket] of Object.entries(value)) {
    const bucket = parseDraftBucket(rawBucket);
    if (!bucket) {
      continue;
    }
    buckets[wins] = {
      ...bucket,
      pickRate: ratioAsPercent(bucket.picked, bucket.offered)
    };
  }

  return Object.keys(buckets).length ? buckets : undefined;
}

function parseCachedDraftBuckets(value: unknown): Readonly<Record<string, FirestoneDraftBucket>> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const buckets: Record<string, FirestoneDraftBucket> = {};
  for (const [wins, rawBucket] of Object.entries(value)) {
    if (!isRecord(rawBucket)) {
      continue;
    }
    const bucket: FirestoneDraftBucket = {
      offered: numberValue(rawBucket.offered),
      picked: numberValue(rawBucket.picked),
      pickRate: numberValue(rawBucket.pickRate)
    };
    if (bucket.offered !== undefined || bucket.picked !== undefined || bucket.pickRate !== undefined) {
      buckets[wins] = bucket;
    }
  }

  return Object.keys(buckets).length ? buckets : undefined;
}

function hasUsefulFirestoneRating(rating: FirestoneCardRating): boolean {
  return (
    rating.includedWinrate !== undefined ||
    rating.playedWinrate !== undefined ||
    rating.drawnWinrate !== undefined ||
    rating.pickRate !== undefined ||
    rating.highWinPickRate !== undefined ||
    rating.twelveWinRate !== undefined
  );
}

function hasFirestoneDraftStats(source: FirestoneRatingSource): boolean {
  return Object.values(source.ratings).some(
    (rating) => rating.pickRate !== undefined || rating.highWinPickRate !== undefined || rating.twelveWinRate !== undefined
  );
}

function hasHearthArenaWebStats(source: HearthArenaWebRatingSource | undefined): boolean {
  if (!source) {
    return false;
  }

  return Object.values(source.locales).some((locale) => locale.ratingCount > 0 && countRatings(locale.ratings) > 0);
}

function ratioAsPercent(numerator: number | undefined, denominator: number | undefined): number | undefined {
  const ratio = ratioValue(numerator, denominator);
  return ratio === undefined ? undefined : roundPercent(ratio * 100);
}

function ratioValue(numerator: number | undefined, denominator: number | undefined): number | undefined {
  return numerator === undefined || denominator === undefined || denominator <= 0 || numerator < 0 || numerator > denominator
    ? undefined
    : numerator / denominator;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseScoreText(value: string): number | undefined {
  const score = Number(value.match(/-?\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(score) ? score : undefined;
}

function extractCardIdFromImageUrl(value: string): string | undefined {
  const fileName = value.split(/[?#]/)[0]?.split("/").pop();
  const cardId = fileName?.replace(/\.(?:webp|png|jpe?g)$/i, "").trim();
  return cardId ? cardId.toUpperCase() : undefined;
}

function countRatings(ratings: Readonly<Record<string, Readonly<Record<string, number>>>>): number {
  return Object.values(ratings).reduce((total, classRatings) => total + Object.keys(classRatings).length, 0);
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function parseVersion(value: unknown): number {
  if (!isRecord(value) || typeof value.haVersion !== "number" || !Number.isSafeInteger(value.haVersion)) {
    throw new Error("评分版本格式无效");
  }
  return value.haVersion;
}

function parseRatings(value: unknown): Readonly<Record<string, Readonly<Record<string, number>>>> {
  if (!isRecord(value)) {
    throw new Error("评分数据格式无效");
  }

  const result: Record<string, Readonly<Record<string, number>>> = {};
  for (const [className, classValue] of Object.entries(value)) {
    if (!isRecord(classValue)) {
      continue;
    }

    const classRatings: Record<string, number> = {};
    for (const [cardId, score] of Object.entries(classValue)) {
      if (typeof score === "number" && Number.isFinite(score)) {
        classRatings[cardId.toUpperCase()] = score;
      }
    }
    result[className] = classRatings;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values)];
}
