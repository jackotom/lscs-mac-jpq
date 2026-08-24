import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ArenaInsightsService } from "../src/main/arenaInsightsService";
import { ArenaRunStore } from "../src/main/arenaRunStore";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function service() {
  const root = await mkdtemp(path.join(tmpdir(), "arena-insights-"));
  roots.push(root);
  return new ArenaInsightsService(new ArenaRunStore(path.join(root, "runs.json")));
}

describe("ArenaInsightsService", () => {
  it("builds one immutable completed run from confirmed draft and result facts", async () => {
    const insights = await service();
    await insights.startRun({
      id: "run-1",
      startedAt: "2026-08-22T10:00:00.000Z",
      hero: "法师",
      deck: [
        { name: "A", cardId: "A", count: 2, score: 80 },
        { name: "B", cardId: "B", count: 1 },
        { name: "C", cardId: "C", count: 1, score: 60 }
      ]
    });
    await insights.recordResult("run-1", "win", "match-1");
    await insights.recordResult("run-1", "loss", "match-2");
    await insights.completeRun("run-1", "2026-08-22T11:00:00.000Z");
    await expect(insights.recordResult("run-1", "win", "match-3")).rejects.toThrow(/已结束/);

    const result = await insights.getInsights();
    expect(result).toMatchObject({
      status: "ok",
      source: "本机竞技场档案",
      runs: [{ id: "run-1", wins: 1, losses: 1, deckScore: 70 }],
      summary: { runCount: 1, totalWins: 1, totalLosses: 1, winRate: 50 }
    });
  });

  it("filters only local completed 10-win decks and aggregates real mulligan outcomes", async () => {
    const insights = await service();
    await insights.importRuns([{
      id: "ten",
      startedAt: "2026-08-20T10:00:00.000Z",
      endedAt: "2026-08-20T11:00:00.000Z",
      wins: 10,
      losses: 2,
      deck: [],
      rewards: [],
      mulligan: [
        { cardName: "火球术", drawnBeforeMulligan: true, keptInMulligan: true, inHandAfterMulligan: true, won: true },
        { cardName: "火球术", drawnBeforeMulligan: true, keptInMulligan: true, inHandAfterMulligan: true, won: false }
      ]
    }, {
      id: "nine",
      startedAt: "2026-08-21T10:00:00.000Z",
      endedAt: "2026-08-21T11:00:00.000Z",
      wins: 9,
      losses: 3,
      deck: [], rewards: [], mulligan: []
    }]);

    const result = await insights.getInsights();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.highWinDecks.map(({ id }) => id)).toEqual(["ten"]);
    expect(result.mulliganStats).toEqual([expect.objectContaining({
      cardName: "火球术",
      drawnBeforeMulligan: 2,
      kept: 2,
      inHandAfterMulligan: 2,
      wins: 1,
      winRate: 50
    })]);
  });

  it("keeps rewards empty until explicit local recording", async () => {
    const insights = await service();
    await insights.startRun({ id: "reward", startedAt: "2026-08-22T10:00:00.000Z", deck: [] });
    expect((await insights.getInsights()).runs?.[0]?.rewards).toEqual([]);
    await insights.recordRewards("reward", [{ type: "gold", amount: 150 }]);
    expect((await insights.getInsights()).runs?.[0]?.rewards).toEqual([{ type: "gold", amount: 150 }]);
  });

  it("serializes concurrent match results without losing either update", async () => {
    const insights = await service();
    await insights.startRun({ id: "concurrent", startedAt: "2026-08-22T10:00:00.000Z", deck: [] });
    await Promise.all([
      insights.recordResult("concurrent", "win", "match-1"),
      insights.recordResult("concurrent", "loss", "match-2")
    ]);
    expect((await insights.getInsights()).runs?.[0]).toMatchObject({ wins: 1, losses: 1 });
  });

  it("does not count the same match twice after the service restarts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "arena-insights-restart-"));
    roots.push(root);
    const storePath = path.join(root, "runs.json");
    const first = new ArenaInsightsService(new ArenaRunStore(storePath));
    await first.startRun({ id: "restart", startedAt: "2026-08-22T10:00:00.000Z", deck: [] });
    await first.recordResult("restart", "win", "match-1");
    await first.completeRun("restart", "2026-08-22T10:30:00.000Z");

    const restarted = new ArenaInsightsService(new ArenaRunStore(storePath));
    await restarted.recordResult("restart", "win", "match-1");

    expect((await restarted.getInsights()).runs?.[0]).toMatchObject({
      wins: 1,
      losses: 0,
      recordedMatchIds: ["match-1"]
    });
  });

  it("refreshes a live run from provisional evidence to the final 30-card deck without erasing results", async () => {
    const insights = await service();
    const cards = (count: number, score: number) => Array.from({ length: count }, (_value, index) => ({
      name: `Card ${index}`,
      cardId: `CARD_${index}`,
      count: 1,
      score
    }));
    await insights.startRun({ id: "live", startedAt: "2026-08-22T10:00:00.000Z", deck: cards(1, 10) });
    await insights.recordResult("live", "win", "match-1");
    await insights.startRun({ id: "live", startedAt: "2026-08-22T10:00:00.000Z", deck: cards(30, 20) });
    await insights.startRun({ id: "live", startedAt: "2026-08-22T10:00:00.000Z", deck: cards(31, 30) });
    await insights.startRun({ id: "live", startedAt: "2026-08-22T10:00:00.000Z", deck: cards(35, 40) });
    await insights.startRun({ id: "live", startedAt: "2026-08-22T10:00:00.000Z", deck: cards(30, 50) });

    expect((await insights.getInsights()).runs?.[0]).toMatchObject({ wins: 1, losses: 0, deckScore: 50 });
    expect((await insights.getInsights()).runs?.[0]?.deck).toHaveLength(30);
  });
});
