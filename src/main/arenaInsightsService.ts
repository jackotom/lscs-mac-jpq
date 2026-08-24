import type {
  ArenaDeckCard,
  ArenaInsightsResult,
  ArenaMulliganStat,
  ArenaRunRecord
} from "../shared/arenaInsights.js";
import { parseArenaRunRecord, parseArenaRuns } from "../shared/arenaInsights.js";
import { ArenaRunStore, type ArenaRetentionDays } from "./arenaRunStore.js";

const SOURCE = "本机竞技场档案" as const;

export class ArenaInsightsService {
  private mutationChain: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly store: ArenaRunStore,
    private readonly now: () => Date = () => new Date()
  ) {}

  async getInsights(retentionDays: ArenaRetentionDays = 180): Promise<ArenaInsightsResult> {
    try {
      await this.mutationChain.catch(() => undefined);
      const runs = await this.store.read(retentionDays);
      const completed = runs.filter((run) => run.endedAt);
      return {
        status: "ok",
        source: SOURCE,
        updatedAt: this.now().toISOString(),
        runs,
        ...(runs.length ? { summary: summarize(completed) } : {}),
        highWinDecks: completed.filter((run) => run.wins >= 10),
        mulliganStats: aggregateMulligans(completed)
      };
    } catch (error) {
      return { status: "error", source: SOURCE, updatedAt: this.now().toISOString(), error: formatError(error) };
    }
  }

  async startRun(input: { id: string; startedAt: string; hero?: string; deck: readonly ArenaDeckCard[] }) {
    return this.mutate(async () => {
      const existing = (await this.store.read()).find((run) => run.id === input.id);
      const scored = input.deck.flatMap((card) => card.score === undefined ? [] : [card.score]);
      const deckScore = scored.length ? round(scored.reduce((sum, score) => sum + score, 0) / scored.length) : undefined;
      if (existing) {
        if (existing.endedAt) return existing;
        return this.store.upsert(parseArenaRunRecord({
          ...existing,
          ...(input.hero ? { hero: input.hero } : {}),
          deck: input.deck,
          deckScore
        }));
      }
      return this.store.upsert(parseArenaRunRecord({
        ...input,
        ...(deckScore !== undefined ? { deckScore } : {}),
        wins: 0,
        losses: 0,
        rewards: [],
        mulligan: [],
        recordedMatchIds: []
      }));
    });
  }

  async recordResult(runId: string, result: "win" | "loss", matchId: string, mulligan: ArenaRunRecord["mulligan"] = []) {
    return this.mutate(async () => {
      const run = await this.requireRun(runId);
      if (run.recordedMatchIds.includes(matchId)) return run;
      if (run.endedAt) throw new Error("竞技场轮次已结束");
      return this.store.upsert({
        ...run,
        wins: run.wins + (result === "win" ? 1 : 0),
        losses: run.losses + (result === "loss" ? 1 : 0),
        mulligan: [...run.mulligan, ...mulligan],
        recordedMatchIds: [...run.recordedMatchIds, matchId]
      });
    });
  }

  async completeRun(runId: string, endedAt: string) {
    return this.mutate(async () => {
      const run = await this.requireRun(runId);
      if (run.endedAt) return run;
      return this.store.upsert(parseArenaRunRecord({ ...run, endedAt }));
    });
  }

  async recordRewards(runId: string, rewards: unknown) {
    return this.mutate(async () => {
      const run = await this.requireRun(runId);
      return this.store.upsert(parseArenaRunRecord({ ...run, rewards }));
    });
  }

  async importRuns(value: unknown) {
    return this.mutate(async () => {
      const imported = parseArenaRuns(value);
      const current = await this.store.read();
      const merged = parseArenaRuns([...current, ...imported]);
      await this.store.replace(merged);
      return merged;
    });
  }

  async exportRuns() {
    await this.mutationChain.catch(() => undefined);
    return this.store.read();
  }

  private async requireRun(id: string) {
    const run = (await this.store.read()).find((entry) => entry.id === id);
    if (!run) throw new Error("竞技场轮次不存在");
    return run;
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationChain.catch(() => undefined).then(operation);
    this.mutationChain = result;
    return result;
  }
}

function summarize(runs: readonly ArenaRunRecord[]) {
  const totalWins = runs.reduce((sum, run) => sum + run.wins, 0);
  const totalLosses = runs.reduce((sum, run) => sum + run.losses, 0);
  const games = totalWins + totalLosses;
  return { runCount: runs.length, totalWins, totalLosses, winRate: games ? round(totalWins / games * 100) : 0 };
}

function aggregateMulligans(runs: readonly ArenaRunRecord[]): ArenaMulliganStat[] {
  interface MutableMulliganStat {
    cardName: string;
    cardId?: string;
    drawnBeforeMulligan: number;
    kept: number;
    inHandAfterMulligan: number;
    wins: number;
  }
  const rows = new Map<string, MutableMulliganStat>();
  for (const record of runs.flatMap((run) => run.mulligan)) {
    const key = record.cardId ? `id:${record.cardId}` : `name:${record.cardName}`;
    const row = rows.get(key) ?? { cardName: record.cardName, ...(record.cardId ? { cardId: record.cardId } : {}), drawnBeforeMulligan: 0, kept: 0, inHandAfterMulligan: 0, wins: 0 };
    if (record.drawnBeforeMulligan) row.drawnBeforeMulligan += 1;
    if (record.keptInMulligan) row.kept += 1;
    if (record.inHandAfterMulligan) {
      row.inHandAfterMulligan += 1;
      if (record.won) row.wins += 1;
    }
    rows.set(key, row);
  }
  return [...rows.values()].map((row) => ({ ...row, winRate: row.inHandAfterMulligan ? round(row.wins / row.inHandAfterMulligan * 100) : 0 }))
    .sort((a, b) => b.inHandAfterMulligan - a.inHandAfterMulligan || a.cardName.localeCompare(b.cardName));
}

function round(value: number) { return Math.round(value * 10) / 10; }
function formatError(error: unknown) { return error instanceof Error ? error.message : String(error); }
