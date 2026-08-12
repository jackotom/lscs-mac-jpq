import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir() }
}));

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function hearthArenaHtml(cardId: string, score: number, classSlug = "hunter", dtClass = `${classSlug} commons`) {
  return `
    <section class="tab tierlist ${classSlug}" id="${classSlug}">
      <ul>
        <li>
          <dl class="card score_100">
            <dt class="${dtClass}" data-card-image="https://cdn.heartharena.com/images/renders/zhCN/${cardId}.webp">测试牌</dt>
            <dd class="score score_100">${score}↑</dd>
          </dl>
        </li>
      </ul>
    </section>
  `;
}

describe("ArenaRatingService", () => {
  it("falls back to the last valid rating cache with a warning when the primary is corrupt and the network fails", async () => {
    const { ArenaRatingService } = await import("../src/main/arenaRatingService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "arena-rating-cache-recovery-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "ratings.json");
    await writeFile(cachePath, '{"source":"broken",', "utf8");
    await writeFile(
      `${cachePath}.backup`,
      JSON.stringify({
        source: "cached-backup",
        version: 7,
        fetchedAt: "2020-01-01T00:00:00.000Z",
        ratings: { Mage: { TEST_001: 88 } }
      }),
      "utf8"
    );
    const fetcher = vi.fn(async () => {
      throw new Error("offline");
    });

    const result = await new ArenaRatingService(cachePath, fetcher).loadRatings();

    expect(result.table).toMatchObject({ source: "cached-backup", version: 7 });
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("正式缓存损坏"),
      expect.stringContaining("继续使用本地")
    ]));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("uses a fresh local rating cache without fetching", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arena-ratings-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "ratings.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        source: "cached",
        version: 3,
        fetchedAt: "2026-07-10T00:00:00.000Z",
        ratings: { Hunter: { TEST_001: 88 } },
        hearthArenaWeb: {
          source: "HearthArena Web",
          version: "zh-cn:web-v1",
          locales: {
            "zh-cn": {
              locale: "zh-cn",
              url: "https://www.heartharena.com/zh-cn/tierlist",
              version: "web-v1",
              fetchedAt: "2026-07-10T00:00:00.000Z",
              ratingCount: 1,
              ratings: { Hunter: { TEST_001: 89 } }
            }
          }
        },
        firestone: {
          source: "Firestone",
          version: "cards:card-v1|draft:draft-v1",
          lastUpdated: "2026-07-10T00:00:00.000Z",
          ratings: { TEST_001: { includedWinrate: 54.2, sampleSize: 2000, pickRate: 42.1, highWinPickRate: 49.5, highWinThreshold: 6 } }
        }
      }),
      "utf8"
    );
    const fetcher = vi.fn();

    const { ArenaRatingService } = await import("../src/main/arenaRatingService.js");
    const result = await new ArenaRatingService(cachePath, fetcher).loadRatings();

    expect(result.table).toMatchObject({ version: 3, source: "cached" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("loads deck and drawn impact for only the current Arena class", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arena-ratings-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "ratings.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        source: "cached",
        version: 3,
        fetchedAt: "2026-07-10T00:00:00.000Z",
        ratings: { Priest: { TEST_001: 88 } },
        hearthArenaWeb: {
          source: "HearthArena Web",
          version: "zh-cn:web-v1",
          locales: {
            "zh-cn": {
              locale: "zh-cn",
              url: "https://www.heartharena.com/zh-cn/tierlist",
              version: "web-v1",
              fetchedAt: "2026-07-10T00:00:00.000Z",
              ratingCount: 1,
              ratings: { Priest: { TEST_001: 89 } }
            }
          }
        },
        firestone: {
          source: "Firestone",
          version: "firestone-v1",
          lastUpdated: "2026-07-10T00:00:00.000Z",
          ratings: { TEST_001: { pickRate: 42.1, highWinPickRate: 49.5, highWinThreshold: 6 } }
        }
      }),
      "utf8"
    );
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/stats/classes/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            lastUpdated: "2026-07-22T00:00:00.000Z",
            stats: [
              { playerClass: "priest", playerHeroPower: "HERO_POWER_A", totalGames: 3, totalsWins: 1 },
              { playerClass: "priest", playerHeroPower: "HERO_POWER_B", totalGames: 1, totalsWins: 1 }
            ]
          })
        } as Response;
      }
      if (url.endsWith("/priest.gz.json?v=6")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            lastUpdated: "2026-07-22T00:30:00.000Z",
            stats: [
              {
                cardId: "TEST_001",
                stats: { decksWithCard: 3, decksWithCardThenWin: 2, drawn: 4, drawnThenWin: 3 }
              },
              { cardId: "TEST_NO_SAMPLE", stats: { decksWithCard: 0, decksWithCardThenWin: 0 } }
            ]
          })
        } as Response;
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const { ArenaRatingService } = await import("../src/main/arenaRatingService.js");
    const result = await new ArenaRatingService(cachePath, fetcher).loadRatings("Priest");

    expect(result.table?.firestoneClasses?.priest).toMatchObject({
      playerClass: "priest",
      overallWinrate: 50,
      ratings: {
        TEST_001: {
          includedWinrate: 66.67,
          sampleSize: 3,
          deckImpact: 16.67,
          drawnWinrate: 75,
          drawnWins: 3,
          drawnSampleSize: 4,
          drawnImpact: 25
        }
      }
    });
    expect(result.table?.firestoneClasses?.priest.ratings.TEST_NO_SAMPLE).toBeUndefined();
    const { getArenaCardRating } = await import("../src/shared/arenaRatings.js");
    expect(getArenaCardRating(result.table, "TEST_001", "Priest")).toMatchObject({
      deckImpact: 16.67,
      drawnImpact: 25
    });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining("/stats/classes/arena-underground/last-patch/overview.gz.json"),
      expect.stringContaining("/stats/cards/arena-underground/last-patch/priest.gz.json?v=6")
    ]);

    const classCachePath = path.join(root, "ratings-firestone-priest.json");
    expect(JSON.parse(await readFile(classCachePath, "utf8"))).toMatchObject({
      overallWins: 2,
      overallGames: 4,
      schemaVersion: 1,
      ratings: { TEST_001: { includedWins: 2, sampleSize: 3, drawnWins: 3, drawnSampleSize: 4 } }
    });
    const offlineFetcher = vi.fn(async () => { throw new Error("offline"); });
    const offlineService = new ArenaRatingService(cachePath, offlineFetcher);
    const offlineResult = await offlineService.loadRatings("Priest");
    expect(offlineResult.table?.firestoneClasses?.priest.ratings.TEST_001?.deckImpact).toBe(16.67);
    expect(offlineResult.table?.firestoneClasses?.priest.ratings.TEST_001?.drawnImpact).toBe(25);
    expect(offlineResult.firestoneClassCacheStatus).toBe("fresh");
    expect(offlineFetcher).not.toHaveBeenCalled();
  });

  it("treats class caches without the drawn-impact schema as stale", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arena-ratings-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "ratings.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        source: "cached",
        version: 3,
        fetchedAt: "2026-07-10T00:00:00.000Z",
        ratings: { Priest: { TEST_001: 88 } },
        hearthArenaWeb: {
          source: "HearthArena Web",
          version: "zh-cn:web-v1",
          locales: {
            "zh-cn": {
              locale: "zh-cn",
              url: "https://www.heartharena.com/zh-cn/tierlist",
              version: "web-v1",
              fetchedAt: "2026-07-10T00:00:00.000Z",
              ratingCount: 1,
              ratings: { Priest: { TEST_001: 89 } }
            }
          }
        },
        firestone: {
          source: "Firestone",
          version: "firestone-v1",
          lastUpdated: "2026-07-10T00:00:00.000Z",
          ratings: { TEST_001: { pickRate: 42.1, highWinPickRate: 49.5, highWinThreshold: 6 } }
        }
      }),
      "utf8"
    );
    await writeFile(
      path.join(root, "ratings-firestone-priest.json"),
      JSON.stringify({
        source: "Firestone",
        playerClass: "priest",
        version: "legacy-priest-cache",
        lastUpdated: "2026-07-10T00:00:00.000Z",
        overallWins: 2,
        overallGames: 4,
        ratings: { TEST_001: { includedWins: 3, sampleSize: 4 } }
      }),
      "utf8"
    );
    const offlineFetcher = vi.fn(async () => { throw new Error("offline"); });

    const { ArenaRatingService } = await import("../src/main/arenaRatingService.js");
    const result = await new ArenaRatingService(cachePath, offlineFetcher).loadRatings("Priest");

    expect(result.table?.firestoneClasses?.priest.ratings.TEST_001?.deckImpact).toBe(25);
    expect(result.firestoneClassCacheStatus).toBe("stale");
    await vi.waitFor(() => expect(offlineFetcher).toHaveBeenCalledTimes(2));
  });

  it("keeps class tables loaded by concurrent requests", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arena-ratings-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "ratings.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        source: "cached",
        version: 3,
        fetchedAt: "2026-07-22T00:00:00.000Z",
        ratings: {},
        hearthArenaWeb: {
          source: "HearthArena Web",
          version: "zh-cn:web-v1",
          locales: {
            "zh-cn": {
              locale: "zh-cn",
              url: "https://www.heartharena.com/zh-cn/tierlist",
              version: "web-v1",
              fetchedAt: "2026-07-22T00:00:00.000Z",
              ratingCount: 1,
              ratings: { Priest: { TEST_001: 90 } }
            }
          }
        },
        firestone: {
          source: "Firestone",
          version: "firestone-v1",
          lastUpdated: "2026-07-22T00:00:00.000Z",
          ratings: {
            TEST_001: {
              pickRate: 50,
              highWinPickRate: 55,
              highWinThreshold: 6,
              draftBuckets: { 0: { offered: 10, picked: 5, pickRate: 50 } }
            }
          }
        }
      }),
      "utf8"
    );

    let releasePriest!: () => void;
    let releaseDruid!: () => void;
    const priestGate = new Promise<void>((resolve) => { releasePriest = resolve; });
    const druidGate = new Promise<void>((resolve) => { releaseDruid = resolve; });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/stats/classes/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            lastUpdated: "2026-07-22T00:00:00.000Z",
            stats: [
              { playerClass: "priest", totalGames: 10, totalsWins: 5 },
              { playerClass: "druid", totalGames: 10, totalsWins: 4 }
            ]
          })
        } as Response;
      }
      if (url.endsWith("/priest.gz.json?v=6")) {
        await priestGate;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            lastUpdated: "2026-07-22T00:00:00.000Z",
            stats: [{ cardId: "PRIEST_CARD", stats: { decksWithCard: 10, decksWithCardThenWin: 6 } }]
          })
        } as Response;
      }
      if (url.endsWith("/druid.gz.json?v=6")) {
        await druidGate;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            lastUpdated: "2026-07-22T00:00:00.000Z",
            stats: [{ cardId: "DRUID_CARD", stats: { decksWithCard: 10, decksWithCardThenWin: 5 } }]
          })
        } as Response;
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const { ArenaRatingService } = await import("../src/main/arenaRatingService.js");
    const service = new ArenaRatingService(cachePath, fetcher);
    const priest = service.loadRatings("Priest");
    const druid = service.loadRatings("Druid");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    releaseDruid();
    await druid;
    releasePriest();
    await priest;

    expect((await service.loadRatings()).table?.firestoneClasses).toMatchObject({
      priest: { ratings: { PRIEST_CARD: { deckImpact: 10 } } },
      druid: { ratings: { DRUID_CARD: { deckImpact: 10 } } }
    });
  });

  it("keeps warning and retrying when a stale base cache cannot refresh", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arena-ratings-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "ratings.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        source: "cached",
        version: 3,
        fetchedAt: "2026-07-10T00:00:00.000Z",
        ratings: { Hunter: { TEST_001: 88 } }
      }),
      "utf8"
    );
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await utimes(cachePath, old, old);
    const fetcher = vi.fn(async () => { throw new Error("offline"); });

    const { ArenaRatingService } = await import("../src/main/arenaRatingService.js");
    const service = new ArenaRatingService(cachePath, fetcher);
    const first = await service.loadRatings();
    const second = await service.loadRatings();

    expect(first.warnings[0]).toContain("继续使用本地");
    expect(second.warnings[0]).toContain("继续使用本地");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });

  it("returns an expired base cache immediately while a stuck refresh runs in the background", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arena-ratings-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "ratings.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        source: "cached",
        version: 3,
        fetchedAt: "2026-07-10T00:00:00.000Z",
        ratings: { Hunter: { TEST_001: 88 } },
        hearthArenaWeb: {
          source: "HearthArena Web",
          version: "zh-cn:web-v1",
          locales: {
            "zh-cn": {
              locale: "zh-cn",
              url: "https://www.heartharena.com/zh-cn/tierlist",
              version: "web-v1",
              fetchedAt: "2026-07-10T00:00:00.000Z",
              ratingCount: 1,
              ratings: { Hunter: { TEST_001: 89 } }
            }
          }
        },
        firestone: {
          source: "Firestone",
          version: "cards:card-v1|draft:draft-v1",
          lastUpdated: "2026-07-10T00:00:00.000Z",
          ratings: {
            TEST_001: { includedWinrate: 54.2, sampleSize: 2000, pickRate: 42.1 }
          }
        }
      }),
      "utf8"
    );
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await utimes(cachePath, old, old);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetcher = vi.fn(async () => {
      await gate;
      throw new Error("offline");
    });

    const { ArenaRatingService } = await import("../src/main/arenaRatingService.js");
    const loading = new ArenaRatingService(cachePath, fetcher).loadRatings();
    const quickResult = await Promise.race([
      loading.then((result) => ({ quick: true, result })),
      new Promise<{ quick: false; result?: never }>((resolve) =>
        setTimeout(() => resolve({ quick: false }), 50)
      )
    ]);
    release();
    await loading;

    expect(quickResult.quick).toBe(true);
    expect(quickResult.result?.table?.firestone?.ratings.TEST_001).toMatchObject({
      pickRate: 42.1,
      includedWinrate: 54.2
    });
  });

  it("returns an expired class cache immediately while its refresh is stuck", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arena-ratings-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "ratings.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        source: "cached",
        version: 3,
        fetchedAt: "2026-07-22T00:00:00.000Z",
        ratings: { Priest: { TEST_001: 88 } },
        hearthArenaWeb: {
          source: "HearthArena Web",
          version: "zh-cn:web-v1",
          locales: {
            "zh-cn": {
              locale: "zh-cn",
              url: "https://www.heartharena.com/zh-cn/tierlist",
              version: "web-v1",
              fetchedAt: "2026-07-22T00:00:00.000Z",
              ratingCount: 1,
              ratings: { Priest: { TEST_001: 89 } }
            }
          }
        },
        firestone: {
          source: "Firestone",
          version: "firestone-v1",
          lastUpdated: "2026-07-22T00:00:00.000Z",
          ratings: { TEST_001: { pickRate: 42.1 } }
        }
      }),
      "utf8"
    );
    const classCachePath = path.join(root, "ratings-firestone-priest.json");
    await writeFile(
      classCachePath,
      JSON.stringify({
        source: "Firestone",
        playerClass: "priest",
        version: "priest-cache",
        lastUpdated: "2026-07-10T00:00:00.000Z",
        overallWins: 50,
        overallGames: 100,
        ratings: { TEST_001: { includedWins: 60, sampleSize: 100 } }
      }),
      "utf8"
    );
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await utimes(classCachePath, old, old);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetcher = vi.fn(async () => {
      await gate;
      throw new Error("offline");
    });

    const { ArenaRatingService } = await import("../src/main/arenaRatingService.js");
    const loading = new ArenaRatingService(cachePath, fetcher).loadRatings("Priest");
    const quickResult = await Promise.race([
      loading.then((result) => ({ quick: true, result })),
      new Promise<{ quick: false; result?: never }>((resolve) =>
        setTimeout(() => resolve({ quick: false }), 50)
      )
    ]);
    release();
    await loading;

    expect(quickResult.quick).toBe(true);
    expect(quickResult.result?.firestoneClassCacheStatus).toBe("stale");
    expect(quickResult.result?.table?.firestoneClasses?.priest.ratings.TEST_001).toMatchObject({
      includedWinrate: 60,
      deckImpact: 10
    });
  });

  it("retries a transient base refresh before falling back to the last successful cache", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arena-ratings-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "ratings.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        source: "cached",
        version: 3,
        fetchedAt: "2026-07-10T00:00:00.000Z",
        ratings: { Hunter: { TEST_001: 88 } },
        hearthArenaWeb: {
          source: "HearthArena Web",
          version: "zh-cn:web-v1",
          locales: {
            "zh-cn": {
              locale: "zh-cn",
              url: "https://www.heartharena.com/zh-cn/tierlist",
              version: "web-v1",
              fetchedAt: "2026-07-10T00:00:00.000Z",
              ratingCount: 1,
              ratings: { Hunter: { TEST_001: 89 } }
            }
          }
        },
        firestone: {
          source: "Firestone",
          version: "cards:card-v1|draft:draft-v1",
          lastUpdated: "2026-07-10T00:00:00.000Z",
          ratings: {
            TEST_001: {
              includedWinrate: 54.2,
              sampleSize: 2000,
              pickRate: 42.1,
              highWinPickRate: 49.5,
              highWinThreshold: 6
            }
          }
        }
      }),
      "utf8"
    );
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await utimes(cachePath, old, old);
    let versionAttempts = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("haVersion")) {
        versionAttempts += 1;
        if (versionAttempts === 1) {
          throw new Error("temporary offline");
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ haVersion: 3 })
        } as Response;
      }
      if (init?.method === "HEAD") {
        return {
          ok: true,
          status: 200,
          headers: new Headers({
            etag: url.includes("/draft/") ? "draft-v1" : "card-v1"
          })
        } as Response;
      }
      if (url.includes("heartharena.com/zh-cn/tierlist")) {
        return { ok: true, status: 200, text: async () => hearthArenaHtml("TEST_001", 89) } as Response;
      }
      if (url.includes("heartharena.com/zh-tw/tierlist")) {
        return { ok: true, status: 200, text: async () => hearthArenaHtml("TEST_001", 88) } as Response;
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const { ArenaRatingService } = await import("../src/main/arenaRatingService.js");
    const service = new ArenaRatingService(cachePath, fetcher);
    const stale = await service.loadRatings();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(7));
    let result = await service.loadRatings();
    await vi.waitFor(async () => {
      result = await service.loadRatings();
      expect(result.warnings).toEqual([]);
    });

    expect(stale.table?.firestone?.ratings.TEST_001.pickRate).toBe(42.1);
    expect(versionAttempts).toBe(2);
    expect(result.warnings).toEqual([]);
    expect(result.table?.firestone?.ratings.TEST_001).toMatchObject({
      pickRate: 42.1,
      includedWinrate: 54.2
    });
  });

  it("deduplicates concurrent class refreshes so a late duplicate cannot overwrite ratings", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arena-ratings-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "ratings.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        source: "cached",
        version: 3,
        fetchedAt: "2026-07-22T00:00:00.000Z",
        ratings: { Priest: { TEST_001: 88 } },
        hearthArenaWeb: {
          source: "HearthArena Web",
          version: "zh-cn:web-v1",
          locales: {
            "zh-cn": {
              locale: "zh-cn",
              url: "https://www.heartharena.com/zh-cn/tierlist",
              version: "web-v1",
              fetchedAt: "2026-07-22T00:00:00.000Z",
              ratingCount: 1,
              ratings: { Priest: { TEST_001: 89 } }
            }
          }
        },
        firestone: {
          source: "Firestone",
          version: "firestone-v1",
          lastUpdated: "2026-07-22T00:00:00.000Z",
          ratings: { TEST_001: { pickRate: 42.1, highWinPickRate: 49.5, highWinThreshold: 6 } }
        }
      }),
      "utf8"
    );

    let releaseOld!: () => void;
    const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
    let overviewCalls = 0;
    let cardCalls = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/stats/classes/")) {
        overviewCalls += 1;
        await oldGate;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            lastUpdated: "2026-07-22T00:00:00.000Z",
            stats: [{ playerClass: "priest", totalGames: 10, totalsWins: 5 }]
          })
        } as Response;
      }
      if (url.endsWith("/priest.gz.json?v=6")) {
        cardCalls += 1;
        await oldGate;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            lastUpdated: "2026-07-22T00:00:00.000Z",
            stats: [{
              cardId: "TEST_001",
              stats: {
                decksWithCard: 10,
                decksWithCardThenWin: 8
              }
            }]
          })
        } as Response;
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const { ArenaRatingService } = await import("../src/main/arenaRatingService.js");
    const service = new ArenaRatingService(cachePath, fetcher);
    const oldRequest = service.loadRatings("Priest");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const newRequest = service.loadRatings("Priest");
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(fetcher).toHaveBeenCalledTimes(2);
    releaseOld();
    await Promise.all([oldRequest, newRequest]);

    expect((await service.loadRatings()).table?.firestoneClasses?.priest.ratings.TEST_001).toMatchObject({
      includedWinrate: 80,
      deckImpact: 30
    });
  });

  it("fetches the full table only when the cached version changes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arena-ratings-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "ratings.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        source: "cached",
        version: 3,
        fetchedAt: "2026-07-10T00:00:00.000Z",
        ratings: { Hunter: { TEST_001: 88 } }
      }),
      "utf8"
    );
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await utimes(cachePath, old, old);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("haVersion")) {
        return { ok: true, status: 200, json: async () => ({ haVersion: 4 }) } as Response;
      }
      if (url.includes("heartharena.com/zh-cn/tierlist")) {
        return { ok: true, status: 200, text: async () => hearthArenaHtml("TEST_002", 97) } as Response;
      }
      if (url.includes("heartharena.com/zh-tw/tierlist")) {
        return { ok: true, status: 200, text: async () => hearthArenaHtml("TEST_002", 96) } as Response;
      }
      if (url.includes("static.zerotoheroes.com") && init?.method === "HEAD") {
        expect(init.signal).toBeInstanceOf(AbortSignal);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "last-modified": url.includes("/draft/arena-underground/") ? "firestone-underground-draft-v2" : url.includes("/draft/") ? "firestone-arena-draft-v2" : "firestone-card-v2" })
        } as Response;
      }
      if (url.includes("/stats/cards/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            lastUpdated: "2026-07-10T00:00:00.000Z",
            stats: [
              {
                cardId: "TEST_002",
                stats: { decksWithCard: 1000, decksWithCardThenWin: 550, played: 600, playedThenWin: 330 }
              }
            ]
          })
        } as Response;
      }
      if (url.includes("/stats/draft/arena-underground/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            lastUpdateDate: "2026-07-10T00:00:00.000Z",
            stats: [
              {
                cardId: "TEST_002",
                statsByWins: {
                  0: { offered: 1000, picked: 400 },
                  6: { offered: 250, picked: 125 },
                  8: { offered: 80, picked: 50 },
                  12: { offered: 40, picked: 24 }
                }
              }
            ]
          })
        } as Response;
      }
      if (url.includes("/stats/draft/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            lastUpdateDate: "2026-07-10T00:00:00.000Z",
            stats: [
              {
                cardId: "TEST_003",
                statsByWins: {
                  0: { offered: 900, picked: 300 },
                  4: { offered: 200, picked: 80 }
                }
              }
            ]
          })
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ Hunter: { TEST_002: 91 } }) } as Response;
    });

    const { ArenaRatingService } = await import("../src/main/arenaRatingService.js");
    const { getArenaScore, getArenaScoreSourceLabel } = await import("../src/shared/arenaRatings.js");
    const result = await new ArenaRatingService(cachePath, fetcher).loadRatings();

    expect(result.table).toMatchObject({
      version: 4,
      ratings: { Hunter: { TEST_002: 91 } },
      hearthArenaWeb: {
        source: "HearthArena Web",
        locales: {
          "zh-cn": {
            ratingCount: 1,
            ratings: { Hunter: { TEST_002: 97 } }
          },
          "zh-tw": {
            ratingCount: 1,
            ratings: { Hunter: { TEST_002: 96 } }
          }
        }
      },
      firestone: {
        version: "cards:firestone-card-v2|draft:firestone-arena-draft-v2,firestone-underground-draft-v2",
        ratings: {
          TEST_002: {
            includedWinrate: 55,
            playedWinrate: 55,
            sampleSize: 1000,
            pickRate: 40,
            pickRateSampleSize: 1000,
            highWinPickRate: 50,
            highWinPickRateSampleSize: 250,
            highWinThreshold: 6,
            highWinPickRateImpact: 10,
            twelveWinRate: 60,
            twelveWinRateSampleSize: 40,
            draftBuckets: {
              0: { offered: 1000, picked: 400, pickRate: 40 },
              6: { offered: 250, picked: 125, pickRate: 50 },
              8: { offered: 80, picked: 50, pickRate: 62.5 },
              12: { offered: 40, picked: 24, pickRate: 60 }
            }
          }
        }
      }
    });
    expect(getArenaScore(result.table, "TEST_002", "Hunter")).toBe(97);
    expect(getArenaScoreSourceLabel(result.table)).toContain("HearthArena官网");
    expect(fetcher).toHaveBeenCalledTimes(10);
  });

  it("refreshes fresh legacy Firestone caches that do not include draft buckets", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arena-ratings-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "ratings.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        source: "cached",
        version: 4,
        fetchedAt: "2026-07-10T00:00:00.000Z",
        ratings: { Hunter: { TEST_001: 88 } },
        firestone: {
          source: "Firestone",
          version: "legacy-firestone-v1",
          lastUpdated: "2026-07-10T00:00:00.000Z",
          ratings: { TEST_001: { includedWinrate: 54.2, sampleSize: 2000 } }
        }
      }),
      "utf8"
    );
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("haVersion")) {
        return { ok: true, status: 200, json: async () => ({ haVersion: 4 }) } as Response;
      }
      if (url.includes("heartharena.com")) {
        return { ok: true, status: 200, text: async () => hearthArenaHtml("TEST_001", 90) } as Response;
      }
      if (url.includes("static.zerotoheroes.com") && init?.method === "HEAD") {
        return { ok: true, status: 200, headers: new Headers({ etag: url }) } as Response;
      }
      if (url.includes("/stats/cards/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            lastUpdated: "2026-07-10T00:00:00.000Z",
            stats: [{ cardId: "TEST_001", stats: { decksWithCard: 100, decksWithCardThenWin: 54 } }]
          })
        } as Response;
      }
      if (url.includes("/stats/draft/arena-underground/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            lastUpdateDate: "2026-07-10T00:00:00.000Z",
            stats: [{ cardId: "TEST_001", statsByWins: { 0: { offered: 100, picked: 40 }, 6: { offered: 20, picked: 10 } } }]
          })
        } as Response;
      }
      if (url.includes("/stats/draft/")) {
        return { ok: true, status: 200, json: async () => ({ lastUpdateDate: "2026-07-10T00:00:00.000Z", stats: [] }) } as Response;
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const { ArenaRatingService } = await import("../src/main/arenaRatingService.js");
    const result = await new ArenaRatingService(cachePath, fetcher).loadRatings();

    expect(result.table?.firestone?.ratings.TEST_001).toMatchObject({
      includedWinrate: 54,
      pickRate: 40,
      highWinPickRate: 50,
      highWinThreshold: 6
    });
  });

  it("does not synthesize 12-win rate from underground high-win buckets", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arena-ratings-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "ratings.json");
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("haVersion")) {
        return { ok: true, status: 200, json: async () => ({ haVersion: 5 }) } as Response;
      }
      if (url.includes("heartharena.com")) {
        return { ok: true, status: 200, text: async () => hearthArenaHtml("TEST_004", 95) } as Response;
      }
      if (url.includes("static.zerotoheroes.com") && init?.method === "HEAD") {
        return { ok: true, status: 200, headers: new Headers({ etag: url }) } as Response;
      }
      if (url.includes("/stats/cards/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            lastUpdated: "2026-07-10T00:00:00.000Z",
            stats: [{ cardId: "TEST_004", stats: { decksWithCard: 100, decksWithCardThenWin: 55 } }]
          })
        } as Response;
      }
      if (url.includes("/stats/draft/arena-underground/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            lastUpdateDate: "2026-07-10T00:00:00.000Z",
            stats: [
              {
                cardId: "TEST_004",
                statsByWins: {
                  0: { offered: 1000, picked: 500 },
                  4: { offered: 600, picked: 360 },
                  6: { offered: 400, picked: 260 },
                  8: { offered: 200, picked: 150 }
                }
              }
            ]
          })
        } as Response;
      }
      if (url.includes("/stats/draft/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            lastUpdateDate: "2026-07-10T00:00:00.000Z",
            stats: [{
              cardId: "TEST_004",
              statsByWins: {
                0: { offered: 1000, picked: 500 },
                4: { offered: 300, picked: 180 }
              }
            }]
          })
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ Hunter: { TEST_004: 90 } }) } as Response;
    });

    const { ArenaRatingService } = await import("../src/main/arenaRatingService.js");
    const result = await new ArenaRatingService(cachePath, fetcher).loadRatings();

    expect(result.table?.firestone?.ratings.TEST_004).toMatchObject({
      pickRate: 50,
      highWinPickRate: 65,
      highWinThreshold: 6,
      highWinPickRateImpact: 15,
      draftBuckets: {
        8: { offered: 200, picked: 150, pickRate: 75 }
      }
    });
    expect(result.table?.firestone?.ratings.TEST_004.twelveWinRate).toBeUndefined();
  });

  it("keeps cached HearthArena web locale data when one official page fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arena-ratings-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "ratings.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        source: "cached",
        version: 4,
        fetchedAt: "2026-07-10T00:00:00.000Z",
        ratings: { Warrior: { TEST_005: 80 } },
        hearthArenaWeb: {
          source: "HearthArena Web",
          version: "zh-tw:cached-web-v1",
          locales: {
            "zh-tw": {
              locale: "zh-tw",
              url: "https://www.heartharena.com/zh-tw/tierlist",
              version: "cached-web-v1",
              fetchedAt: "2026-07-10T00:00:00.000Z",
              ratingCount: 1,
              ratings: { Warrior: { TEST_006: 88 } }
            }
          }
        },
        firestone: {
          source: "Firestone",
          version: "cards:card-v1|draft:draft-a,draft-b",
          lastUpdated: "2026-07-10T00:00:00.000Z",
          ratings: { TEST_005: { pickRate: 42, highWinPickRate: 50, highWinThreshold: 6 } }
        }
      }),
      "utf8"
    );
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await utimes(cachePath, old, old);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("haVersion")) {
        return { ok: true, status: 200, json: async () => ({ haVersion: 4 }) } as Response;
      }
      if (url.includes("heartharena.com/zh-cn/tierlist")) {
        return { ok: true, status: 200, text: async () => hearthArenaHtml("TEST_005", 99, "warrior", "hunter commons") } as Response;
      }
      if (url.includes("heartharena.com/zh-tw/tierlist")) {
        return { ok: false, status: 503, text: async () => "" } as Response;
      }
      if (url.includes("static.zerotoheroes.com") && init?.method === "HEAD") {
        const version = url.includes("/draft/arena-underground/") ? "draft-b" : url.includes("/draft/") ? "draft-a" : "card-v1";
        return { ok: true, status: 200, headers: new Headers({ etag: version }) } as Response;
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const { ArenaRatingService } = await import("../src/main/arenaRatingService.js");
    const { getArenaScore } = await import("../src/shared/arenaRatings.js");
    const service = new ArenaRatingService(cachePath, fetcher);
    await service.loadRatings();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(7));
    let result = await service.loadRatings();
    await vi.waitFor(async () => {
      result = await service.loadRatings();
      expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining("zh-tw")]));
    });

    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining("zh-tw")]));
    const repeatedResult = await service.loadRatings();
    expect(repeatedResult.warnings).toEqual(expect.arrayContaining([expect.stringContaining("zh-tw")]));
    expect(getArenaScore(result.table, "TEST_005", "Warrior")).toBe(99);
    expect(getArenaScore(result.table, "TEST_006", "Warrior")).toBe(88);
    expect(fetcher).toHaveBeenCalledTimes(7);
  });
});
