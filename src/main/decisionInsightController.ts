import type { DecisionInsight } from "../shared/decisionInsights.js";
import type { MatchMode, PublicTrackerState } from "../shared/types.js";
import type { DecisionStatsService } from "./decisionStatsService.js";

/** Keeps asynchronous public statistics attached to the exact visible choice. */
export class DecisionInsightController {
  private key: string | undefined;
  private value: DecisionInsight | undefined;
  private retryAt = 0;

  constructor(
    private readonly onChange: () => void,
    private readonly provider?: Pick<DecisionStatsService, "getStats">
  ) {}

  update(state: PublicTrackerState, mode: MatchMode, arenaMode?: "arena" | "underground"): DecisionInsight | undefined {
    const offer = state.decisionOffer;
    if (!state.gameActive || state.status !== "watching" || !offer) {
      this.key = undefined;
      this.value = undefined;
      return undefined;
    }
    const deckCode = state.deckIdentity && state.deckIdentity.status !== "confirmed" && !state.manualDeck
      ? undefined : state.deckCode;
    const input = {
      mode, kind: offer.kind, deckCode,
      playerClass: state.matchDetails?.friendlyClass,
      arenaMode
    };
    const key = JSON.stringify([state.cardTracking.gameKey, offer, input]);
    if (this.key === key && (this.value?.status !== "unavailable" || Date.now() < this.retryAt)) return this.value;
    this.key = key;
    this.retryAt = Date.now() + 30_000;
    this.value = {
      ...offer, mode, status: this.provider ? "loading" : "unavailable",
      source: "Firestone 公开统计", stats: [],
      ...(this.provider ? {} : { note: "当前运行环境未启用在线选牌统计。" })
    };
    if (this.provider) {
      const requestValue = this.value;
      void this.provider.getStats(input).then((result) => {
        if (this.key !== key || this.value !== requestValue) return;
        const cards = new Set(offer.cards.map((card) => card.cardId));
        this.value = { ...offer, mode, ...result, stats: result.stats.filter((row) => cards.has(row.cardId)) };
        this.onChange();
      }).catch(() => {
        if (this.key !== key || this.value !== requestValue) return;
        this.value = { ...offer, mode, status: "unavailable", source: "Firestone 公开统计", stats: [], note: "统计暂时无法读取，稍后自动重试。" };
        this.onChange();
      });
    }
    return this.value;
  }

  dispose(): void {
    this.key = undefined;
    this.value = undefined;
  }
}
