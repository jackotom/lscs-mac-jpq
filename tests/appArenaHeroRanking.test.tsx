import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArenaHeroWinRateRankingResult } from "../src/shared/arenaHeroStats";

afterEach(() => {
  window.history.replaceState({}, "", "/");
  delete window.hearthstoneTracker;
});

describe("arena hero ranking window", () => {
  it("audit regression: reads the latest main-process snapshot after subscribing so a startup push cannot be lost", async () => {
    let publish!: (result: ArenaHeroWinRateRankingResult) => void;
    const snapshot: ArenaHeroWinRateRankingResult = {
      status: "ok",
      source: "公开统计",
      updatedAt: "2026-07-23T08:00:00.000Z",
      entries: [{ rank: 1, heroName: "萨满祭司", heroClass: "SHAMAN", winRate: 53.9, games: 36_740 }]
    };
    const getArenaHeroWinRateRanking = vi.fn(async (): Promise<ArenaHeroWinRateRankingResult> => snapshot);
    window.history.replaceState({}, "", "/?arena-hero-ranking-overlay=1");
    window.hearthstoneTracker = {
      getArenaHeroWinRateRanking,
      onArenaHeroWinRateRankingUpdate: vi.fn((callback: (result: ArenaHeroWinRateRankingResult) => void) => {
        publish = callback;
        return () => undefined;
      }),
      closeArenaHeroWinRateRanking: vi.fn(async () => undefined)
    } as unknown as typeof window.hearthstoneTracker;
    const { default: App } = await import("../src/renderer/App.js");

    render(<App />);

    expect(screen.getByRole("status")).toHaveTextContent("正在读取排行");
    expect(await screen.findByText("萨满祭司")).toBeInTheDocument();
    expect(getArenaHeroWinRateRanking).toHaveBeenCalledTimes(1);

    act(() => publish({
      status: "ok",
      source: "公开统计",
      updatedAt: "2026-07-23T08:00:00.000Z",
      entries: [{ rank: 1, heroName: "萨满祭司", heroClass: "SHAMAN", winRate: 53.9, games: 36_740 }]
    }));

    expect(screen.getByText("53.9%")).toBeInTheDocument();
    expect(getArenaHeroWinRateRanking).toHaveBeenCalledTimes(1);
  });
});
