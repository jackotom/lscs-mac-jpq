import { afterEach, describe, expect, it, vi } from "vitest";
import { DecisionStatsService } from "../src/main/decisionStatsService.js";

const NOW = Date.parse("2026-10-05T12:00:00.000Z");
const deckCode = "AAECAZICCqn1BqGBB5KDB6+HB6yIB4KYB+DAB+LAB+XEB6PaBwqunwSqrwesrwfosQe+sgfXwAeR2gfH5ge85wfK5wcAAA==";
const input = { mode: "standard" as const, kind: "mulligan" as const, deckCode, playerClass: "Druid" };
const card = { cardId: "CATA_131", drawnBeforeMulligan: 10, keptInMulligan: 8,
  inHandAfterMulligan: 20, inHandAfterMulliganThenWin: 12, drawn: 30, drawnThenWin: 15 };
const feed = (overrides: Record<string, unknown> = {}) => ({
  decklist: deckCode, format: "standard", playerClass: "druid", rankBracket: "legend", timePeriod: "past-7",
  lastUpdate: "2026-10-05T00:00:00.000Z", totalGames: 100, totalWins: 55,
  cardsData: [card], discoverData: [{ cardId: "CORE_EX1_169", discovered: 40, discoveredThenWin: 24 }],
  ...overrides
});
const response = (value: unknown) => new Response(JSON.stringify(value));
const fetchFeed = (value: unknown) => vi.fn<typeof fetch>(async () => response(value));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("DecisionStatsService", () => {
  it("binds constructed statistics to the exact deck and labels each sample definition", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const fetcher = fetchFeed(feed());
    const service = new DecisionStatsService(fetcher);
    const result = await service.getStats({ ...input, opponentClass: "Mage", initiative: "second" });
    expect(result).toMatchObject({ status: "ready", updatedAt: "2026-10-05T00:00:00.000Z",
      stats: [{ cardId: "CATA_131", metric: "mulligan", samples: 20, winRate: 60, keepRate: 80, keepSamples: 10 }] });
    expect(result.source).toMatch(/传说.*近7天/);
    expect(result.note).toContain("换牌后");
    expect(result.note).toContain("未按对手及先后手细分");
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.searchParams.get("deckId")).toBe(deckCode.replace("/", "-"));
    const discover = await service.getStats({ ...input, kind: "discover" });
    expect(discover.stats).toEqual([{ cardId: "CORE_EX1_169", metric: "discovered", samples: 40, winRate: 60 }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { decklist: "different" }, { format: "wild" }, { playerClass: "mage" },
    { rankBracket: "bronze" }, { timePeriod: "past-20" }, { totalWins: 101 },
    { lastUpdate: "2026-09-20T00:00:00Z" }, { lastUpdate: "2026-10-05T12:06:00Z" },
    { lastUpdate: "invalid" }
  ])("rejects mismatched or stale source metadata: %j", async (override) => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    expect(await new DecisionStatsService(fetchFeed(feed(override))).getStats(input))
      .toMatchObject({ status: "unavailable", stats: [], note: expect.any(String) });
  });

  it("does not borrow ranked or arena modes when identity is unknown", async () => {
    const fetcher = fetchFeed(feed());
    const service = new DecisionStatsService(fetcher);
    for (const mode of ["casual", "unknown"] as const) {
      expect((await service.getStats({ ...input, mode })).status).toBe("unavailable");
    }
    expect((await service.getStats({ mode: "arena", kind: "mulligan", playerClass: "Mage" })).status).toBe("unavailable");
    expect((await service.getStats({ mode: "arena", kind: "mulligan", arenaMode: "arena", playerClass: "unknown" })).status).toBe("unavailable");
    expect((await service.getStats({ ...input, deckCode: "not-a-deck" })).status).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("aggregates repeated card rows without accepting invalid sample counts", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const rows = [card, { ...card, inHandAfterMulligan: 10, inHandAfterMulliganThenWin: 3 },
      ...[-1, 1.5, 21].map((wins, i) => ({ ...card, cardId: `BAD_${i}`, inHandAfterMulliganThenWin: wins })),
      { ...card, cardId: "ZERO", inHandAfterMulligan: 0, inHandAfterMulliganThenWin: 0 }];
    const result = await new DecisionStatsService(fetchFeed(feed({ cardsData: rows }))).getStats(input);
    expect(result.stats).toEqual([{ cardId: "CATA_131", metric: "mulligan", samples: 30, winRate: 50, keepRate: 80, keepSamples: 20 }]);
  });

  it.each(["arena", "underground"] as const)("uses exact %s mode and labels drawn-only discover guidance", async (arenaMode) => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const fetcher = fetchFeed({ lastUpdated: "2026-10-05T00:00:00Z", context: "mage", stats: [{ cardId: card.cardId, context: "mage", stats: card }] });
    const service = new DecisionStatsService(fetcher);
    const result = await service.getStats({ mode: "arena", arenaMode, playerClass: "Mage", kind: "discover" });
    expect(result).toMatchObject({ status: "ready", stats: [{ cardId: "CATA_131", metric: "drawn", samples: 30, winRate: 50 }] });
    expect(result.note).toContain("抽到后胜率参考");
    expect(result.note).toContain("不是发现后胜率");
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(`/cards/${arenaMode === "arena" ? "arena" : "arena-underground"}/last-patch/mage.gz.json`);
    expect((await service.getStats({ mode: "arena", arenaMode, playerClass: "Mage", kind: "mulligan" })).stats[0])
      .toMatchObject({ metric: "mulligan", samples: 20, winRate: 60 });
  });

  it("rejects another arena class and never substitutes drawn stats for constructed discovers", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const arena = new DecisionStatsService(fetchFeed({ lastUpdated: "2026-10-05T00:00:00Z", context: "priest", stats: [{ cardId: card.cardId, stats: card }] }));
    expect((await arena.getStats({ mode: "arena", arenaMode: "arena", playerClass: "Mage", kind: "mulligan" })).status).toBe("unavailable");
    expect((await new DecisionStatsService(fetchFeed(feed({ discoverData: [] }))).getStats({ ...input, kind: "discover" })).status).toBe("unavailable");
  });

  it("deduplicates in-flight requests and refuses expired cache after a fetch failure", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(NOW);
    let resolve: (response: Response) => void = () => {};
    const fetcher = vi.fn< typeof fetch >().mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }))
      .mockRejectedValue(new Error("offline"));
    const service = new DecisionStatsService(fetcher);
    const first = service.getStats(input);
    const second = service.getStats(input);
    resolve(response(feed()));
    expect((await first).status).toBe("ready");
    expect(await second).toEqual(await first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now.mockReturnValue(NOW + 16 * 60 * 1000);
    expect(await service.getStats(input)).toMatchObject({ status: "unavailable", stats: [], note: expect.stringContaining("失败") });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
