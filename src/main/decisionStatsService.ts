import { decode } from "deckstrings";
import { toFirestoneClassSlug } from "../shared/arenaRatings.js";
import type { DecisionCardStats } from "../shared/decisionInsights.js";
import type { MatchMode } from "../shared/types.js";

export interface DecisionStatsInput {
  readonly mode: MatchMode;
  readonly kind: "mulligan" | "discover";
  readonly deckCode?: string;
  readonly playerClass?: string;
  readonly arenaMode?: "arena" | "underground";
  readonly opponentClass?: string;
  readonly initiative?: "first" | "second";
}

export interface DecisionStatsResult {
  readonly status: "ready" | "unavailable";
  readonly source: string;
  readonly updatedAt?: string;
  readonly note?: string;
  readonly stats: readonly DecisionCardStats[];
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_SOURCE_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const DECK_URL = "https://fs66gthwj9.execute-api.us-west-2.amazonaws.com/prod/constructed-meta-deck";

export class DecisionStatsService {
  private readonly cache = new Map<string, { value: unknown; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async getStats(input: DecisionStatsInput): Promise<DecisionStatsResult> {
    let source = "Firestone 公开统计";
    try {
      const playerClass = toFirestoneClassSlug(input.playerClass);
      let url: string;
      let deckCode: string | undefined;
      if (input.kind !== "mulligan" && input.kind !== "discover") throw new Error("不支持的辅助类型");
      if (input.mode === "arena") {
        if (!playerClass || (input.arenaMode !== "arena" && input.arenaMode !== "underground")) {
          throw new Error("尚未确认竞技场模式或职业，无法匹配统计");
        }
        const mode = input.arenaMode === "arena" ? "arena" : "arena-underground";
        url = `https://static.zerotoheroes.com/api/arena/stats/cards/${mode}/last-patch/${playerClass}.gz.json`;
        source = `Firestone ${input.arenaMode === "arena" ? "普通竞技场" : "地下竞技场"}·${playerClass}·当前补丁`;
      } else if (input.mode === "standard" || input.mode === "wild") {
        deckCode = input.deckCode?.trim();
        if (!deckCode || deckCode.length > 16000 || (input.playerClass !== undefined && !playerClass)) {
          throw new Error("尚未确认完整卡组或职业，无法匹配统计");
        }
        try {
          const deck = decode(deckCode);
          if (!deck.cards.length || deck.format !== (input.mode === "standard" ? 2 : 1)) throw new Error();
        } catch {
          throw new Error("卡组代码无效或与对局模式不符");
        }
        const params = new URLSearchParams({ format: input.mode, rank: "legend", timePeriod: "past-7", deckId: deckCode.replace("/", "-") });
        url = `${DECK_URL}?${params}`;
        source = `Firestone ${input.mode === "standard" ? "标准" : "狂野"}·准确套牌·传说分段·近7天`;
      } else {
        throw new Error("休闲或未知模式没有匹配的公开统计");
      }

      const payload = await this.load(url);
      if (!isRecord(payload)) throw new Error("统计响应格式无效");
      const arena = input.mode === "arena";
      if (arena) {
        if (payload.context !== playerClass || !Array.isArray(payload.stats)) throw new Error("竞技场统计职业不匹配或格式无效");
      } else if (
        payload.decklist !== deckCode || payload.format !== input.mode ||
        payload.rankBracket !== "legend" || payload.timePeriod !== "past-7" ||
        !toFirestoneClassSlug(typeof payload.playerClass === "string" ? payload.playerClass : undefined) ||
        (playerClass !== undefined && payload.playerClass !== playerClass) ||
        !counts(payload.totalWins, payload.totalGames) || payload.totalGames === 0
      ) {
        throw new Error("统计卡组、模式、职业、分段或样本不匹配");
      }
      const updatedAt = validUpdatedAt(arena ? payload.lastUpdated : payload.lastUpdate);
      if (!updatedAt) throw new Error("统计更新时间无效、超过14天或来自未来");
      const metric = input.kind === "mulligan" ? "mulligan" : arena ? "drawn" : "discovered";
      const rawRows = arena ? payload.stats : input.kind === "mulligan" ? payload.cardsData : payload.discoverData;
      if (!Array.isArray(rawRows)) throw new Error("统计缺少所需样本");
      const rows = arena
        ? rawRows.filter((row) => isRecord(row) && (row.context === undefined || row.context === playerClass))
          .map((row) => isRecord(row.stats) ? { ...row.stats, cardId: row.cardId } : {})
        : rawRows;
      const stats = parseStats(rows, metric);
      if (!stats.length) throw new Error("暂无有效单卡样本");
      // ponytail: aggregate cohorts only; add opponent/initiative slices when their coverage is verified end to end.
      const definition = metric === "mulligan"
        ? "样本为换牌后仍在手的记录；保留率为换牌前拿到后选择保留的比例"
        : metric === "discovered" ? "样本为发现该牌的记录，胜率为随后整局获胜比例"
          : "抽到后胜率参考：样本为抽到该牌的记录，不是发现后胜率";
      return { status: "ready", source, updatedAt, stats,
        note: `${definition}；未按对手及先后手细分；${arena ? "同职业汇总，并非本套牌专属" : "整副套牌汇总"}；统计相关性不代表本次选择的因果收益` };
    } catch (error) {
      return { status: "unavailable", source, stats: [], note: `统计不可用：${error instanceof Error ? error.message : "读取失败"}` };
    }
  }

  private async load(url: string): Promise<unknown> {
    const cached = this.cache.get(url);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    this.cache.delete(url);
    const running = this.inFlight.get(url);
    if (running) return running;
    const request = (async () => {
      try {
        const response = await this.fetcher(url, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const value: unknown = await response.json();
        this.cache.set(url, { value, expiresAt: Date.now() + CACHE_TTL_MS });
        // Bound memory while retaining several recently used decks and both arena modes.
        if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value!);
        return value;
      } catch (error) {
        throw new Error(`读取失败（${error instanceof Error ? error.message : "网络错误"}）`);
      }
    })();
    this.inFlight.set(url, request);
    try { return await request; } finally { this.inFlight.delete(url); }
  }
}

function parseStats(rows: readonly unknown[], metric: "mulligan" | "discovered" | "drawn"): DecisionCardStats[] {
  const totals = new Map<string, { wins: number; samples: number; kept: number; offered: number; keepComplete: boolean }>();
  const sampleKey = metric === "mulligan" ? "inHandAfterMulligan" : metric;
  const winKey = metric === "mulligan" ? "inHandAfterMulliganThenWin" : `${metric}ThenWin`;
  for (const row of rows) {
    if (!isRecord(row) || typeof row.cardId !== "string" || !/^[A-Za-z0-9_]+$/.test(row.cardId)) continue;
    const pair = counts(row[winKey], row[sampleKey]);
    if (!pair) continue;
    const cardId = row.cardId.toUpperCase();
    const keep = counts(row.keptInMulligan, row.drawnBeforeMulligan);
    const current = totals.get(cardId) ?? { wins: 0, samples: 0, kept: 0, offered: 0, keepComplete: true };
    totals.set(cardId, {
      wins: current.wins + pair.wins, samples: current.samples + pair.samples,
      kept: current.kept + (keep?.wins ?? 0), offered: current.offered + (keep?.samples ?? 0),
      keepComplete: current.keepComplete && keep !== undefined
    });
  }
  return [...totals].flatMap(([cardId, stat]) => {
    if (!counts(stat.wins, stat.samples) || !stat.samples) return [];
    const keep = stat.keepComplete && stat.offered > 0 && counts(stat.kept, stat.offered);
    return [{ cardId, metric, samples: stat.samples, winRate: percent(stat.wins, stat.samples),
      ...(metric === "mulligan" && keep ? { keepRate: percent(keep.wins, keep.samples), keepSamples: keep.samples } : {}) }];
  });
}

function counts(wins: unknown, samples: unknown): { wins: number; samples: number } | undefined {
  return typeof wins === "number" && typeof samples === "number" &&
    Number.isSafeInteger(wins) && Number.isSafeInteger(samples) && wins >= 0 && samples >= wins
    ? { wins, samples } : undefined;
}

function validUpdatedAt(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > Date.now() + FUTURE_TOLERANCE_MS || parsed < Date.now() - MAX_SOURCE_AGE_MS) return undefined;
  const normalized = new Date(parsed).toISOString();
  return normalized === value || normalized === value.replace(/Z$/, ".000Z") ? value : undefined;
}

function percent(wins: number, samples: number): number { return Math.round(wins / samples * 10000) / 100; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
