import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArenaHeroStatsService, parseArenaHeroStats } from "../src/main/arenaHeroStatsService.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ArenaHeroStatsService", () => {
  it("aggregates hero-power rows and ranks classes by win rate", () => {
    const result = parseArenaHeroStats({
      lastUpdated: "2026-07-23T00:00:00Z",
      dataPoints: 300,
      stats: [
        { playerClass: "mage", totalGames: 100, totalsWins: 55 },
        { playerClass: "mage", totalGames: 100, totalsWins: 45 },
        { playerClass: "priest", totalGames: 100, totalsWins: 51 },
        { playerClass: "unknown", totalGames: 100, totalsWins: 99 }
      ]
    });
    expect(result.heroes).toEqual([
      expect.objectContaining({ rank: 1, heroClass: "priest", heroName: "牧师", games: 100, wins: 51, winRate: 51 }),
      expect.objectContaining({ rank: 2, heroClass: "mage", heroName: "法师", games: 200, wins: 100, winRate: 50 })
    ]);
    expect(result.sample).toBe(300);
  });

  it("uses a fresh cache without network access", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arena-hero-stats-"));
    tempDirs.push(root);
    await writeFile(path.join(root, "arena-hero-stats.json"), JSON.stringify({
      source: "Firestone",
      lastUpdated: "2026-07-23T00:00:00Z",
      fetchedAt: "2026-07-23T01:00:00Z",
      sample: 100,
      heroes: [{ rank: 1, heroClass: "mage", heroName: "法师", wins: 55, games: 100, winRate: 55 }]
    }));
    const fetcher = vi.fn();
    const result = await new ArenaHeroStatsService(root, fetcher).load();
    expect(result.status).toBe("ok");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns stale cache when refresh fails and writes successful refresh atomically", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arena-hero-stats-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "arena-hero-stats.json");
    await writeFile(cachePath, JSON.stringify({
      source: "Firestone",
      lastUpdated: "2026-07-20T00:00:00Z",
      fetchedAt: "2026-07-20T01:00:00Z",
      sample: 100,
      heroes: [{ rank: 1, heroClass: "mage", heroName: "法师", wins: 50, games: 100, winRate: 50 }]
    }));
    const old = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await utimes(cachePath, old, old);
    const failing = vi.fn(async () => { throw new Error("offline"); });
    await expect(new ArenaHeroStatsService(root, failing as typeof fetch).load()).resolves.toMatchObject({
      status: "ok",
      warning: expect.stringContaining("offline")
    });

    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        lastUpdated: "2026-07-23T00:00:00Z",
        stats: [{ playerClass: "warrior", totalGames: 200, totalsWins: 104 }]
      })
    } as Response));
    const refreshed = await new ArenaHeroStatsService(root, fetcher as typeof fetch).load({ forceRefresh: true });
    expect(refreshed).toMatchObject({ status: "ok", sample: 200, entries: [{ heroClass: "warrior", winRate: 52 }] });
    expect(JSON.parse(await readFile(cachePath, "utf8"))).toMatchObject({ heroes: [{ heroClass: "warrior" }] });
  });
});
