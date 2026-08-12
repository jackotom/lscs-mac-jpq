import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectHearthstoneInstallation, type HearthstoneInstallationResult } from "./hearthstoneInstallation.js";
import { parseFirestoneConstructedDecks } from "./firestoneConstructedDeckSource.js";
import { parseLadderDeckRecommendations, selectTopLadderDeck, type LadderDeckRecommendation, type LadderDeckRecommendationResult, type LadderMode } from "../shared/ladderDeckRecommendation.js";

const DEFAULT_MIN_GAMES = 800;
const DEFAULT_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_STALE_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_FIRESTONE_BASE_URL = "https://static.zerotoheroes.com/api/constructed/stats/decks";

interface ServiceOptions {
  readonly sourceUrl?: string; readonly cachePath?: string; readonly fetcher?: typeof fetch; readonly minGames?: number;
  readonly cacheMaxAgeMs?: number; readonly staleMaxAgeMs?: number; readonly timeoutMs?: number; readonly now?: () => number;
  readonly installationDetector?: () => Promise<HearthstoneInstallationResult>;
  readonly firestoneBaseUrl?: string | null;
  /** @deprecated Kept only so older callers can explicitly disable the former fallback. */
  readonly hsguruBaseUrl?: string | null;
}
interface CachePayload {
  readonly schemaVersion: 1; readonly patch: string; readonly mode: LadderMode; readonly fetchedAt: string;
  readonly recommendations: readonly LadderDeckRecommendation[];
}
interface CacheFile { readonly schemaVersion: 1; readonly entries: readonly CachePayload[] }

export class LadderDeckRecommendationService {
  private readonly sourceUrl: string | undefined; private readonly firestoneBaseUrl: string | undefined; private readonly cachePath: string; private readonly fetcher: typeof fetch;
  private readonly minGames: number; private readonly cacheMaxAgeMs: number; private readonly staleMaxAgeMs: number;
  private readonly timeoutMs: number; private readonly now: () => number; private readonly installationDetector: () => Promise<HearthstoneInstallationResult>;
  private writeChain: Promise<void> = Promise.resolve();
  constructor(options: ServiceOptions = {}) {
    this.sourceUrl = options.sourceUrl ?? process.env.HEARTHSTONE_CN_LADDER_DECK_SOURCE_URL;
    this.firestoneBaseUrl = options.firestoneBaseUrl === null || options.hsguruBaseUrl === null
      ? undefined
      : options.firestoneBaseUrl ?? DEFAULT_FIRESTONE_BASE_URL;
    this.cachePath = options.cachePath ?? path.join(os.homedir(), "Library", "Application Support", "hearthstone-mac-tracker", "ladder-decks.json");
    this.fetcher = options.fetcher ?? fetch; this.minGames = options.minGames ?? DEFAULT_MIN_GAMES;
    this.cacheMaxAgeMs = options.cacheMaxAgeMs ?? DEFAULT_CACHE_MAX_AGE_MS; this.staleMaxAgeMs = options.staleMaxAgeMs ?? DEFAULT_STALE_MAX_AGE_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS; this.now = options.now ?? Date.now;
    this.installationDetector = options.installationDetector ?? detectHearthstoneInstallation;
  }

  async get(mode: LadderMode): Promise<LadderDeckRecommendationResult> {
    const installation = await this.installationDetector();
    if (installation.status !== "detected") return installationFailure(installation);
    const cached = await this.readCache(installation.patch, mode);
    if (cached && this.age(cached) <= this.cacheMaxAgeMs) {
      const recommendation = this.select(cached.recommendations, installation.patch, mode);
      if (recommendation) return readyResult(recommendation, false, installation.fullVersion, cached.fetchedAt);
    }
    if (!this.sourceUrl && !this.firestoneBaseUrl) {
      const stale = cached && this.age(cached) <= this.staleMaxAgeMs && this.select(cached.recommendations, installation.patch, mode);
      if (stale) return readyResult(stale, true, installation.fullVersion, cached!.fetchedAt, "暂无可用的实时来源，显示本地缓存");
      return { status: "unavailable", errorCode: "source-unconfigured", gameVersion: installation.fullVersion, message: "暂无已配置的天梯排行来源" };
    }
    try {
      const recommendations = await this.fetchRecommendations(installation.patch, mode);
      const recommendation = this.select(recommendations, installation.patch, mode);
      if (!recommendation) return { status: "unavailable", errorCode: "patch-unavailable", gameVersion: installation.fullVersion, message: `${mode === "standard" ? "标准" : "狂野"}数据中没有当前版本且达到最低场次的卡组` };
      const fetchedAt = new Date(this.now()).toISOString();
      await this.writeCache({ schemaVersion: 1, patch: installation.patch, mode, fetchedAt, recommendations });
      return readyResult(recommendation, false, installation.fullVersion, fetchedAt);
    } catch (error) {
      const recommendation = cached && this.age(cached) <= this.staleMaxAgeMs && this.select(cached.recommendations, installation.patch, mode);
      if (recommendation) return readyResult(recommendation, true, installation.fullVersion, cached!.fetchedAt, `天梯数据更新失败，显示本地缓存：${formatError(error)}`);
      return { status: "unavailable", errorCode: error instanceof FeedError ? "feed-invalid" : "network-failed", gameVersion: installation.fullVersion, message: `卡组排行读取失败：${formatError(error)}` };
    }
  }
  private select(items: readonly LadderDeckRecommendation[], patch: string, mode: LadderMode) { return selectTopLadderDeck(items.filter((item) => item.patch === patch), mode, this.minGames); }
  private age(cache: CachePayload) { return this.now() - Date.parse(cache.fetchedAt); }
  private async fetchRecommendations(expectedPatch: string, mode: LadderMode): Promise<LadderDeckRecommendation[]> {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      if (!this.sourceUrl) {
        const sourceUrl = this.firestoneUrl(mode);
        const response = await this.fetcher(sourceUrl, {
          signal: controller.signal,
          headers: { accept: "application/json", "user-agent": "HearthstoneMacTracker/0.3" }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        try {
          return parseFirestoneConstructedDecks(await response.json(), {
            mode,
            expectedPatch,
            sourceUrl
          });
        } catch (error) { throw new FeedError(formatError(error)); }
      }
      const response = await this.fetcher(this.sourceUrl, { signal: controller.signal, headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!isRecord(payload) || payload.patch !== expectedPatch) throw new FeedError("数据版本与炉石当前版本不一致");
      try { return parseLadderDeckRecommendations(payload, { now: this.now }); } catch (error) { throw new FeedError(formatError(error)); }
    } finally { clearTimeout(timeout); }
  }
  private firestoneUrl(mode: LadderMode): string {
    return `${this.firestoneBaseUrl}/${mode}/legend/past-7/overview-from-hourly.gz.json`;
  }
  private async readCache(patch: string, mode: LadderMode): Promise<CachePayload | undefined> {
    try {
      const value = JSON.parse(await fs.readFile(this.cachePath, "utf8")) as unknown;
      if (!isRecord(value) || value.schemaVersion !== 1) return undefined;
      const candidates = Array.isArray(value.entries) ? value.entries : [value];
      const entry = candidates.find((item) => isRecord(item) && item.patch === patch && item.mode === mode);
      if (!isRecord(entry) || typeof entry.fetchedAt !== "string" || !Number.isFinite(Date.parse(entry.fetchedAt)) || !Array.isArray(entry.recommendations)) return undefined;
      return { schemaVersion: 1, patch, mode, fetchedAt: entry.fetchedAt, recommendations: entry.recommendations as LadderDeckRecommendation[] };
    } catch { return undefined; }
  }
  private async writeCache(payload: CachePayload): Promise<void> {
    const operation = this.writeChain.then(async () => {
      await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
      const existing = await this.readCacheFile();
      const entries = existing.entries.filter((entry) => entry.patch !== payload.patch || entry.mode !== payload.mode);
      entries.push(payload);
      const temp = `${this.cachePath}.${process.pid}.${Date.now()}.tmp`;
      try { await fs.writeFile(temp, JSON.stringify({ schemaVersion: 1, entries } satisfies CacheFile), "utf8"); await fs.rename(temp, this.cachePath); }
      finally { await fs.rm(temp, { force: true }).catch(() => undefined); }
    });
    this.writeChain = operation.catch(() => undefined);
    await operation;
  }
  private async readCacheFile(): Promise<CacheFile> {
    try {
      const value = JSON.parse(await fs.readFile(this.cachePath, "utf8")) as unknown;
      if (!isRecord(value) || value.schemaVersion !== 1) return { schemaVersion: 1, entries: [] };
      if (Array.isArray(value.entries)) return { schemaVersion: 1, entries: value.entries.filter(isCachePayload) };
      return isCachePayload(value) ? { schemaVersion: 1, entries: [value] } : { schemaVersion: 1, entries: [] };
    } catch { return { schemaVersion: 1, entries: [] }; }
  }
}
class FeedError extends Error {}
function installationFailure(value: Exclude<HearthstoneInstallationResult, { status: "detected" }>): LadderDeckRecommendationResult {
  const code = value.status === "not-found" ? "installation-not-found" : value.status;
  const message = value.status === "version-unreadable" ? `暂时无法确认炉石当前版本：${value.message}` : value.message;
  return { status: "unavailable", errorCode: code, message };
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isCachePayload(value: unknown): value is CachePayload {
  return isRecord(value) && value.schemaVersion === 1 && typeof value.patch === "string" && (value.mode === "standard" || value.mode === "wild") &&
    typeof value.fetchedAt === "string" && Number.isFinite(Date.parse(value.fetchedAt)) && Array.isArray(value.recommendations);
}
function formatError(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function readyResult(
  recommendation: LadderDeckRecommendation,
  stale: boolean,
  gameVersion: string,
  fetchedAt: string,
  message?: string
): Extract<LadderDeckRecommendationResult, { status: "ready" }> {
  return {
    status: "ready",
    recommendation,
    stale,
    source: recommendation.source,
    fetchedAt,
    sample: recommendation.games,
    gameVersion,
    ...(message ? { message } : {})
  };
}
