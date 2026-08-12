import { promises as fs } from "node:fs";
import path from "node:path";
import type { ArenaHeroWinRateRankingEntry, ArenaHeroWinRateRankingResult } from "../shared/arenaHeroStats.js";

const SOURCE_URL =
  "https://static.zerotoheroes.com/api/arena/stats/classes/arena-underground/last-patch/overview.gz.json";
const CACHE_FILE_NAME = "arena-hero-stats.json";
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;

const CLASS_NAMES: Readonly<Record<string, string>> = {
  "death-knight": "死亡骑士",
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

interface CachedHeroStats {
  readonly source: "Firestone";
  readonly sourceUrl: typeof SOURCE_URL;
  readonly lastUpdated: string;
  readonly fetchedAt: string;
  readonly sample: number;
  readonly heroes: readonly InternalHeroStat[];
}

interface InternalHeroStat extends ArenaHeroWinRateRankingEntry {
  readonly wins: number;
}

export class ArenaHeroStatsService {
  private readonly cachePath: string;
  private readonly fetcher: typeof fetch;
  private inFlight: Promise<ArenaHeroWinRateRankingResult> | undefined;

  constructor(userDataDirectory: string, fetcher: typeof fetch = fetch) {
    this.cachePath = path.join(userDataDirectory, CACHE_FILE_NAME);
    this.fetcher = fetcher;
  }

  load(options: { forceRefresh?: boolean } = {}): Promise<ArenaHeroWinRateRankingResult> {
    if (this.inFlight) return this.inFlight;
    const request = this.loadOnce(Boolean(options.forceRefresh)).finally(() => {
      if (this.inFlight === request) this.inFlight = undefined;
    });
    this.inFlight = request;
    return request;
  }

  private async loadOnce(forceRefresh: boolean): Promise<ArenaHeroWinRateRankingResult> {
    const cached = await this.readCache();
    if (!forceRefresh && cached && !(await this.isCacheStale())) {
      return toPublicResult(cached);
    }

    try {
      const response = await this.fetcher(SOURCE_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = parseArenaHeroStats(await response.json());
      const fresh = { ...parsed, fetchedAt: new Date().toISOString() };
      await this.writeCache(fresh);
      return toPublicResult(fresh);
    } catch (error) {
      if (cached) {
        return {
          ...toPublicResult(cached),
          warning: `英雄胜率更新失败，继续使用本地缓存：${formatError(error)}`
        };
      }
      return { status: "error", message: `英雄胜率暂时不可用：${formatError(error)}` };
    }
  }

  private async readCache(): Promise<CachedHeroStats | undefined> {
    try {
      return parseCachedHeroStats(JSON.parse(await fs.readFile(this.cachePath, "utf8")));
    } catch {
      return undefined;
    }
  }

  private async isCacheStale(): Promise<boolean> {
    try {
      return Date.now() - (await fs.stat(this.cachePath)).mtimeMs > CACHE_MAX_AGE_MS;
    } catch {
      return true;
    }
  }

  private async writeCache(value: CachedHeroStats): Promise<void> {
    await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
    const temporaryPath = `${this.cachePath}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      await fs.rename(temporaryPath, this.cachePath);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

export function parseArenaHeroStats(value: unknown): CachedHeroStats {
  if (!isRecord(value) || typeof value.lastUpdated !== "string" || !Array.isArray(value.stats)) {
    throw new Error("Firestone 英雄胜率数据格式无效");
  }

  const totals = new Map<string, { wins: number; games: number }>();
  for (const entry of value.stats) {
    if (!isRecord(entry) || typeof entry.playerClass !== "string") continue;
    const classSlug = entry.playerClass.trim().toLowerCase();
    if (!CLASS_NAMES[classSlug]) continue;
    const wins = finiteNonNegative(entry.totalsWins);
    const games = finiteNonNegative(entry.totalGames);
    if (wins === undefined || games === undefined || games === 0 || wins > games) continue;
    const current = totals.get(classSlug) ?? { wins: 0, games: 0 };
    totals.set(classSlug, { wins: current.wins + wins, games: current.games + games });
  }

  const heroes = [...totals.entries()]
    .map(([classSlug, total]) => ({
      rank: 0,
      heroName: CLASS_NAMES[classSlug]!,
      heroClass: classSlug,
      wins: total.wins,
      games: total.games,
      winRate: Math.round((total.wins / total.games) * 10_000) / 100
    }))
    .sort((left, right) => right.winRate - left.winRate || right.games - left.games || left.heroClass.localeCompare(right.heroClass))
    .map((hero, index) => ({ ...hero, rank: index + 1 }));
  if (heroes.length === 0) throw new Error("Firestone 英雄胜率数据为空");
  const reportedSample = finiteNonNegative(value.dataPoints);
  const sample = reportedSample !== undefined && Number.isSafeInteger(reportedSample)
    ? reportedSample
    : heroes.reduce((total, hero) => total + hero.games, 0);
  return { source: "Firestone", sourceUrl: SOURCE_URL, lastUpdated: value.lastUpdated, fetchedAt: value.lastUpdated, sample, heroes };
}

function parseCachedHeroStats(value: unknown): CachedHeroStats | undefined {
  if (!isRecord(value) || value.source !== "Firestone" || typeof value.lastUpdated !== "string" || !Array.isArray(value.heroes)) {
    return undefined;
  }
  const heroes = value.heroes.filter(isArenaHeroStat);
  if (heroes.length === 0 || heroes.length !== value.heroes.length) return undefined;
  const cachedSample = finiteNonNegative(value.sample);
  const sample = cachedSample !== undefined && Number.isSafeInteger(cachedSample)
    ? cachedSample
    : heroes.reduce((total, hero) => total + hero.games, 0);
  const fetchedAt = typeof value.fetchedAt === "string" && Number.isFinite(Date.parse(value.fetchedAt))
    ? value.fetchedAt
    : value.lastUpdated;
  return { source: "Firestone", sourceUrl: SOURCE_URL, lastUpdated: value.lastUpdated, fetchedAt, sample, heroes };
}

function isArenaHeroStat(value: unknown): value is InternalHeroStat {
  return isRecord(value) &&
    Number.isSafeInteger(value.rank) && Number(value.rank) > 0 &&
    typeof value.heroName === "string" && typeof value.heroClass === "string" &&
    finiteNonNegative(value.wins) !== undefined && finiteNonNegative(value.games) !== undefined &&
    typeof value.winRate === "number" && Number.isFinite(value.winRate) && value.winRate >= 0 && value.winRate <= 100;
}

function toPublicResult(value: CachedHeroStats): Extract<ArenaHeroWinRateRankingResult, { status: "ok" }> {
  return {
    status: "ok",
    source: value.source,
    updatedAt: value.lastUpdated,
    fetchedAt: value.fetchedAt,
    sample: value.sample,
    entries: value.heroes.map(({ wins: _wins, ...entry }) => entry)
  };
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
