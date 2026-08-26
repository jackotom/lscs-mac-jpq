import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import sampleCardDb from "../fixtures/cards.sample.json";

vi.mock("electron", () => ({
  app: {
    getPath: () => os.tmpdir()
  }
}));

const tempDirs: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("CardDataService", () => {
  it("reads the old cache format and upgrades it after a successful refresh", async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "card-data-schema-upgrade-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "cards.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        source: "Blizzard 官方卡牌浏览器",
        version: "old-version",
        fetchedAt: "2020-01-01T00:00:00.000Z",
        cards: [{ dbfId: 1001, name: "旧格式卡", cardId: "TEST_001" }]
      }),
      "utf8"
    );
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://hs.blizzard.cn/cards/") {
        return responseText('<script src="https://hs.res.netease.com/pc/zt/version/js/cards/index_new.js"></script>');
      }
      if (url.includes("hs-cards-api-server")) {
        return responseJson({ code: 0, data: { total: 1, list: [{ id: 1001, name: "新格式卡" }] } });
      }
      return response([{ dbfId: 1001, id: "TEST_001", name: "旧编号卡" }]);
    });

    const result = await new CardDataService(cachePath, fetchMock as never).loadCardDatabase();

    expect(result.database?.["1001"]).toEqual(expect.objectContaining({ name: "新格式卡" }));
    expect(JSON.parse(await readFile(cachePath, "utf8"))).toMatchObject({ schemaVersion: 1, version: expect.stringContaining("index_new.js") });
    expect(JSON.parse(await readFile(`${cachePath}.backup`, "utf8"))).toMatchObject({ version: "old-version" });
  });

  it("falls back to the last valid cache with a warning when the primary is corrupt and the network fails", async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "card-data-cache-recovery-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "cards.json");
    await writeFile(cachePath, '{"schemaVersion":1,"cards":', "utf8");
    await writeFile(
      `${cachePath}.backup`,
      JSON.stringify({
        source: "Blizzard 官方卡牌浏览器",
        version: "backup-version",
        fetchedAt: "2020-01-01T00:00:00.000Z",
        cards: [{ dbfId: 1001, name: "备份卡", cardId: "TEST_001" }]
      }),
      "utf8"
    );
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });

    const result = await new CardDataService(cachePath, fetchMock as never).loadCardDatabase();

    expect(result.database?.["1001"]).toEqual(expect.objectContaining({ name: "备份卡" }));
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("正式缓存损坏"),
      expect.stringContaining("继续使用本地")
    ]));
    expect(fetchMock).toHaveBeenCalled();
  });

  it("refreshes an in-memory database when explicitly requested", { timeout: 15_000 }, async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "card-data-service-refresh-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "cards.json");
    await writeFile(cachePath, JSON.stringify({ fetchedAt: new Date().toISOString(), cards: [{ dbfId: 1001, name: "Old" }] }), "utf8");
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://hs.blizzard.cn/cards/") return responseText('<script src="https://hs.res.netease.com/pc/zt/version/js/cards/index_new.js"></script>');
      if (url.includes("hs-cards-api-server")) return responseJson({ code: 0, data: { total: 1, list: [{ id: 1001, name: "New" }] } });
      return response([{ dbfId: 1001, id: "TEST_001", name: "Legacy" }]);
    });
    const service = new CardDataService(cachePath, fetchMock as never);
    expect((await service.loadCardDatabase({ preferCache: true })).database?.["1001"]).toEqual(
      expect.objectContaining({ name: "Old" })
    );

    const refreshed = await service.loadCardDatabase({ forceRefresh: true });

    expect(refreshed.database?.["1001"]).toEqual(expect.objectContaining({ name: "New" }));
    expect(fetchMock).toHaveBeenCalled();
  });

  it("uses a fresh local card database cache without fetching", async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "card-data-service-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "cards.json");
    await writeFile(cachePath, JSON.stringify(Object.values(sampleCardDb)), "utf8");
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as never;

    const result = await new CardDataService(cachePath).loadCardDatabase({ preferCache: true });

    expect(result.database?.["1001"]).toEqual(expect.objectContaining({ name: "Sample Singleton" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a preferred official cache immediately when the foreign supplement is missing", async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "preferred-official-cache-service-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "official-cards.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        schemaVersion: 1,
        source: "Blizzard 官方卡牌浏览器",
        version: "cached-version",
        fetchedAt: new Date().toISOString(),
        cards: [{ id: 129888, dbfId: 129888, name: "通缉海报", collectible: 1 }]
      }),
      "utf8"
    );
    let rejectNetwork!: (reason?: unknown) => void;
    const blockedNetwork = new Promise<never>((_resolve, reject) => {
      rejectNetwork = reject;
    });
    const fetchMock = vi.fn(() => blockedNetwork);
    const load = new CardDataService(cachePath, fetchMock as never).loadCardDatabase({ preferCache: true });

    const outcome = await Promise.race([
      load.then(() => "loaded" as const),
      new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 50))
    ]);
    if (fetchMock.mock.calls.length > 0) {
      rejectNetwork(new Error("test cleanup"));
    }
    await load.catch(() => undefined);

    expect(outcome).toBe("loaded");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reloads a preferred cache after another service instance replaces the shared files", { timeout: 15_000 }, async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "cross-instance-preferred-cache-service-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "official-cards.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        schemaVersion: 1,
        source: "Blizzard 官方卡牌浏览器",
        version: "old-version",
        fetchedAt: new Date().toISOString(),
        cards: [{ id: 129888, dbfId: 129888, name: "旧官方卡", collectible: 1 }]
      }),
      "utf8"
    );
    const preferredFetch = vi.fn(async () => {
      throw new Error("preferred cache must not use the network");
    });
    const refreshFetch = vi.fn(async (url: string) => {
      if (url === "https://hs.blizzard.cn/cards/") {
        return responseText('<script src="https://hs.res.netease.com/pc/zt/version/js/cards/index_new.js"></script>');
      }
      if (url.includes("hs-cards-api-server")) {
        return responseJson({ code: 0, data: { total: 1, list: [{ id: 129888, name: "新官方卡", collectible: 1 }] } });
      }
      if (url.includes("api.hearthstonejson.com")) {
        return response([{ dbfId: 129888, id: "CAP_407", name: "Legacy" }]);
      }
      if (url.includes("static.zerotoheroes.com")) {
        return response(foreignFullSource([{ dbfId: 129888, id: "CAP_407", name: "Wanted Poster", type: "Spell" }]));
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    const preferredService = new CardDataService(cachePath, preferredFetch as never);
    const refreshService = new CardDataService(cachePath, refreshFetch as never);

    const beforeRefresh = await preferredService.loadCardDatabase({ preferCache: true });
    const refreshed = await refreshService.loadCardDatabase({ forceRefresh: true });
    const afterRefresh = await preferredService.loadCardDatabase({ preferCache: true });

    expect(beforeRefresh.database?.["129888"]).toEqual(expect.objectContaining({ name: "旧官方卡" }));
    expect(refreshed.database?.["129888"]).toEqual(expect.objectContaining({ name: "新官方卡", cardId: "CAP_407" }));
    expect(afterRefresh.database?.["129888"]).toEqual(expect.objectContaining({ name: "新官方卡", cardId: "CAP_407" }));
    expect(preferredFetch).not.toHaveBeenCalled();
  });

  it("imports the official card pages and keeps legacy card ids for log matching", async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "official-card-data-service-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "official-cards.json");
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("api.hearthstonejson.com")) {
        return response([
          { dbfId: 1001, id: "TEST_001", name: "旧编号卡" },
          { dbfId: 1002, id: "TEST_002", name: "旧第二张" },
          { dbfId: 1003, id: "TEST_003", name: "旧库额外卡" },
          { dbfId: 1004, id: "TEST_001t", name: "衍生法术", type: "SPELL", cost: 2, text: "造成 2 点伤害。" }
        ]);
      }

      if (url.includes("static.zerotoheroes.com") || url.includes("static.firestoneapp.com")) return response([]);

      if (url === "https://hs.blizzard.cn/cards/") {
        return responseText('<script src="https://hs.res.netease.com/pc/zt/version/js/cards/index_test.js"></script>');
      }

      return responseJson({
        code: 0,
        data: {
          total: 2,
          list: [
            { id: 1001, name: "官网新名字", collectible: 1, child_ids: [1004] },
            { id: 1002, name: "官网第二张", collectible: 1 }
          ]
        }
      });
    });

    const result = await new CardDataService(cachePath, fetchMock as never).loadCardDatabase();

    expect(result.source).toBe("Blizzard 官方卡牌浏览器");
    expect(result.cardCount).toBe(4);
    expect(result.database?.["1001"]).toEqual(expect.objectContaining({ name: "官网新名字", cardId: "TEST_001" }));
    expect(result.database?.["1003"]).toEqual(expect.objectContaining({ name: "旧库额外卡" }));
    expect(result.database?.["1004"]).toEqual(
      expect.objectContaining({ name: "衍生法术", cardId: "TEST_001t", cardType: "法术", manaCost: 2 })
    );
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("accepts a real 30,000-card foreign supplement and enriches newly released official cards", async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "foreign-card-supplement-service-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "official-cards.json");
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://hs.blizzard.cn/cards/") {
        return responseText('<script src="https://hs.res.netease.com/pc/zt/version/js/cards/index_cap.js"></script>');
      }
      if (url.includes("hs-cards-api-server")) {
        return responseJson({
          code: 0,
          data: {
            total: 1,
            list: [{ id: 129888, name: "通缉海报", description: "国服中文正文", collectible: 1 }]
          }
        });
      }
      if (url.includes("api.hearthstonejson.com")) {
        return response([]);
      }
      if (url.includes("static.zerotoheroes.com")) {
        return response(foreignFullSource([
          {
            dbfId: 129888,
            id: "CAP_407",
            name: "Wanted Poster",
            type: "Spell",
            cardClass: "NEUTRAL",
            rarity: "Epic",
            cost: 2,
            text: "Discover a minion that costs (5) or more. Give it Prepare."
          },
          {
            dbfId: 129889,
            id: "CAP_407e",
            name: "Prepared",
            type: "Enchantment"
          }
        ]));
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const result = await new CardDataService(cachePath, fetchMock as never).loadCardDatabase();

    expect(result.database?.["129888"]).toEqual(expect.objectContaining({
      name: "通缉海报",
      cardId: "CAP_407",
      collectible: true,
      cardType: "法术",
      rarity: "EPIC",
      manaCost: 2,
      text: "国服中文正文",
      imageUrl: "https://art.hearthstonejson.com/v1/render/latest/zhCN/256x/CAP_407.png",
      cropImageUrl: "https://art.hearthstonejson.com/v1/tiles/CAP_407.jpg"
    }));
    expect(result.database?.["129889"]).toEqual(expect.objectContaining({
      name: "Prepared",
      cardId: "CAP_407e"
    }));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("static.zerotoheroes.com"),
      expect.any(Object)
    );
  });

  it("uses the Firestone mirror when the primary foreign card source is unavailable", async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "foreign-card-mirror-service-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "official-cards.json");
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://hs.blizzard.cn/cards/") {
        return responseText('<script src="https://hs.res.netease.com/pc/zt/version/js/cards/index_cap.js"></script>');
      }
      if (url.includes("hs-cards-api-server")) {
        return responseJson({ code: 0, data: { total: 1, list: [{ id: 129888, name: "通缉海报", collectible: 1 }] } });
      }
      if (url.includes("api.hearthstonejson.com")) return response([]);
      if (url.includes("static.zerotoheroes.com")) throw new Error("primary offline");
      if (url.includes("static.firestoneapp.com")) {
        return response(foreignFullSource([{ dbfId: 129888, id: "CAP_407", name: "通缉海报", type: "Spell" }]));
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const result = await new CardDataService(cachePath, fetchMock as never).loadCardDatabase();

    expect(result.database?.["129888"]).toEqual(expect.objectContaining({ cardId: "CAP_407", name: "通缉海报" }));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("static.firestoneapp.com"), expect.any(Object));
  });

  it("coalesces concurrent card database refreshes into one download", { timeout: 15_000 }, async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "concurrent-card-refresh-service-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "official-cards.json");
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://hs.blizzard.cn/cards/") {
        return responseText('<script src="https://hs.res.netease.com/pc/zt/version/js/cards/index_cap.js"></script>');
      }
      if (url.includes("hs-cards-api-server")) {
        return responseJson({ code: 0, data: { total: 1, list: [{ id: 129888, name: "通缉海报", collectible: 1 }] } });
      }
      if (url.includes("api.hearthstonejson.com")) return response([]);
      if (url.includes("static.zerotoheroes.com") || url.includes("static.firestoneapp.com")) return response([]);
      throw new Error(`unexpected URL: ${url}`);
    });
    const service = new CardDataService(cachePath, fetchMock as never);

    const results = await Promise.all([
      service.loadCardDatabase(),
      service.loadCardDatabase(),
      service.loadCardDatabase()
    ]);

    expect(results.every((result) => result.database?.["129888"])).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("shares the complete load chain across service instances using the same cache path", { timeout: 15_000 }, async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "shared-foreign-refresh-service-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "official-cards.json");
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://hs.blizzard.cn/cards/") {
        return responseText('<script src="https://hs.res.netease.com/pc/zt/version/js/cards/index_cap.js"></script>');
      }
      if (url.includes("hs-cards-api-server")) {
        return responseJson({ code: 0, data: { total: 1, list: [{ id: 129888, name: "通缉海报", collectible: 1 }] } });
      }
      if (url.includes("api.hearthstonejson.com")) {
        return response([{ dbfId: 129888, id: "CAP_407", name: "Legacy" }]);
      }
      if (url.includes("static.zerotoheroes.com")) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return response(foreignFullSource([{ dbfId: 129888, id: "CAP_407", name: "通缉海报", type: "Spell" }]));
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    const firstService = new CardDataService(cachePath, fetchMock as never);
    const secondService = new CardDataService(cachePath, fetchMock as never);

    const [first, second] = await Promise.all([
      firstService.loadCardDatabase(),
      secondService.loadCardDatabase()
    ]);

    expect(first.database?.["129888"]).toEqual(expect.objectContaining({ cardId: "CAP_407" }));
    expect(second.database?.["129888"]).toEqual(expect.objectContaining({ cardId: "CAP_407" }));
    expect(fetchMock.mock.calls.filter(([url]) => url === "https://hs.blizzard.cn/cards/")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("hs-cards-api-server"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("api.hearthstonejson.com"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("static.zerotoheroes.com"))).toHaveLength(1);
    expect(JSON.parse(await readFile(path.join(root, "hearthstone-cards.foreign-supplement.json"), "utf8")))
      .toMatchObject({ schemaVersion: 1, cards: expect.any(Array) });
    expect(JSON.parse(await readFile(cachePath, "utf8")))
      .toMatchObject({ schemaVersion: 1, version: expect.stringContaining("index_cap.js") });
    await expect(readFile(`${cachePath}.backup`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("queues a cross-instance force refresh behind an ordinary shared load", { timeout: 20_000 }, async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "queued-force-card-refresh-service-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "official-cards.json");
    let releaseFirstPage!: () => void;
    const firstPageGate = new Promise<void>((resolve) => {
      releaseFirstPage = resolve;
    });
    let pageCalls = 0;
    let constructedCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://hs.blizzard.cn/cards/") {
        const call = ++pageCalls;
        if (call === 1) await firstPageGate;
        return responseText(`<script src="https://hs.res.netease.com/pc/zt/version/js/cards/index_${call}.js"></script>`);
      }
      if (url.includes("hs-cards-api-server")) {
        constructedCalls += 1;
        return responseJson({
          code: 0,
          data: { total: 1, list: [{ id: 129888, name: constructedCalls === 1 ? "Ordinary" : "Forced", collectible: 1 }] }
        });
      }
      if (url.includes("api.hearthstonejson.com")) return response([]);
      if (url.includes("static.zerotoheroes.com") || url.includes("static.firestoneapp.com")) return response([]);
      throw new Error(`unexpected URL: ${url}`);
    });
    const ordinaryService = new CardDataService(cachePath, fetchMock as never);
    const forceService = new CardDataService(cachePath, fetchMock as never);

    const ordinary = ordinaryService.loadCardDatabase();
    await vi.waitFor(() => expect(pageCalls).toBe(1));
    const forced = forceService.loadCardDatabase({ forceRefresh: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pageCallsBeforeOrdinaryCompletes = pageCalls;
    releaseFirstPage();
    const [, forcedResult] = await Promise.all([ordinary, forced]);

    expect(pageCallsBeforeOrdinaryCompletes).toBe(1);
    expect(pageCalls).toBe(2);
    expect(forcedResult.database?.["129888"]).toEqual(expect.objectContaining({ name: "Forced" }));
  });

  it("reuses the last foreign supplement when its website is temporarily unavailable", async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "cached-foreign-card-supplement-service-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "official-cards.json");
    await writeForeignSupplementCache(root, [
      { dbfId: 129888, id: "CAP_407", name: "Wanted Poster", type: "Spell" }
    ]);
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://hs.blizzard.cn/cards/") {
        return responseText('<script src="https://hs.res.netease.com/pc/zt/version/js/cards/index_cap.js"></script>');
      }
      if (url.includes("hs-cards-api-server")) {
        return responseJson({ code: 0, data: { total: 1, list: [{ id: 129888, name: "通缉海报", collectible: 1 }] } });
      }
      if (url.includes("api.hearthstonejson.com")) {
        return response([]);
      }
      if (url.includes("static.zerotoheroes.com") || url.includes("static.firestoneapp.com")) {
        throw new Error("foreign source offline");
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const result = await new CardDataService(cachePath, fetchMock as never).loadCardDatabase();

    expect(result.database?.["129888"]).toEqual(expect.objectContaining({
      name: "通缉海报",
      cardId: "CAP_407"
    }));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("static.zerotoheroes.com"), expect.any(Object));
  });

  it("warns clearly when every foreign supplement source fails", async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "foreign-refresh-warning-service-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "official-cards.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        schemaVersion: 1,
        source: "Blizzard 官方卡牌浏览器",
        version: "old-version",
        fetchedAt: "2020-01-01T00:00:00.000Z",
        cards: [{ id: 129888, dbfId: 129888, name: "通缉海报", collectible: 1 }]
      }),
      "utf8"
    );
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://hs.blizzard.cn/cards/") {
        return responseText('<script src="https://hs.res.netease.com/pc/zt/version/js/cards/index_new.js"></script>');
      }
      if (url.includes("hs-cards-api-server")) {
        return responseJson({ code: 0, data: { total: 1, list: [{ id: 129888, name: "通缉海报", collectible: 1 }] } });
      }
      if (url.includes("api.hearthstonejson.com")) return response([]);
      if (url.includes("static.zerotoheroes.com")) throw new Error("primary offline");
      if (url.includes("static.firestoneapp.com")) throw new Error("mirror offline");
      throw new Error(`unexpected URL: ${url}`);
    });

    const result = await new CardDataService(cachePath, fetchMock as never).loadCardDatabase({ forceRefresh: true });

    expect(result.database?.["129888"]).toEqual(expect.objectContaining({ name: "通缉海报" }));
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("Firestone"),
      expect.stringContaining("刷新失败")
    ]));
  });

  it("rejects a partial foreign response instead of replacing the last full supplement", async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "partial-foreign-card-supplement-service-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "official-cards.json");
    await writeForeignSupplementCache(root, [
      { dbfId: 129888, id: "CAP_407", name: "通缉海报", type: "Spell" }
    ]);
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://hs.blizzard.cn/cards/") {
        return responseText('<script src="https://hs.res.netease.com/pc/zt/version/js/cards/index_cap.js"></script>');
      }
      if (url.includes("hs-cards-api-server")) {
        return responseJson({ code: 0, data: { total: 1, list: [{ id: 129888, name: "通缉海报", collectible: 1 }] } });
      }
      if (url.includes("api.hearthstonejson.com")) return response([]);
      if (url.includes("static.zerotoheroes.com") || url.includes("static.firestoneapp.com")) {
        return response([
          { dbfId: 129888, id: "CAP_407", name: "错误的残缺响应", type: "Weapon" },
          ...foreignFullFiller
        ]);
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const result = await new CardDataService(cachePath, fetchMock as never).loadCardDatabase({ forceRefresh: true });

    expect(result.database?.["129888"]).toEqual(expect.objectContaining({
      cardId: "CAP_407",
      name: "通缉海报",
      cardType: "法术"
    }));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("static.zerotoheroes.com"), expect.any(Object));
  });

  it("force-refreshes an existing foreign supplement instead of pinning its first version", { timeout: 15_000 }, async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "force-foreign-card-supplement-service-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "official-cards.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        schemaVersion: 1,
        source: "Blizzard 官方卡牌浏览器",
        version: "old-version",
        fetchedAt: "2020-01-01T00:00:00.000Z",
        cards: [{ id: 129888, dbfId: 129888, name: "通缉海报", collectible: 1 }]
      }),
      "utf8"
    );
    await writeForeignSupplementCache(root, [
      { dbfId: 129888, id: "CAP_407", name: "通缉海报", type: "Weapon" }
    ]);
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://hs.blizzard.cn/cards/") {
        return responseText('<script src="https://hs.res.netease.com/pc/zt/version/js/cards/index_new.js"></script>');
      }
      if (url.includes("hs-cards-api-server")) {
        return responseJson({ code: 0, data: { total: 1, list: [{ id: 129888, name: "通缉海报", collectible: 1 }] } });
      }
      if (url.includes("api.hearthstonejson.com")) return response([]);
      if (url.includes("static.zerotoheroes.com")) {
        return response(foreignFullSource([{ dbfId: 129888, id: "CAP_407", name: "通缉海报", type: "Spell" }]));
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const result = await new CardDataService(cachePath, fetchMock as never).loadCardDatabase({ forceRefresh: true });

    expect(result.database?.["129888"]).toEqual(expect.objectContaining({ cardId: "CAP_407", cardType: "法术" }));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("static.zerotoheroes.com"), expect.any(Object));
  });

  it("refreshes a missing foreign supplement when explicitly requested", async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "missing-foreign-card-supplement-service-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "official-cards.json");
    const version = "https://hs.res.netease.com/pc/zt/version/js/cards/index_cap.js";
    await writeFile(
      cachePath,
      JSON.stringify({
        schemaVersion: 1,
        source: "Blizzard 官方卡牌浏览器",
        version,
        fetchedAt: new Date().toISOString(),
        cards: [{ id: 129888, dbfId: 129888, name: "通缉海报", collectible: 1 }]
      }),
      "utf8"
    );
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://hs.blizzard.cn/cards/") {
        return responseText(`<script src="${version}"></script>`);
      }
      if (url.includes("hs-cards-api-server")) {
        return responseJson({ code: 0, data: { total: 1, list: [{ id: 129888, name: "通缉海报", collectible: 1 }] } });
      }
      if (url.includes("api.hearthstonejson.com")) {
        return response([]);
      }
      if (url.includes("static.zerotoheroes.com")) {
        return response(foreignFullSource([{ dbfId: 129888, id: "CAP_407", name: "Wanted Poster", type: "Spell" }]));
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const result = await new CardDataService(cachePath, fetchMock as never).loadCardDatabase({ forceRefresh: true });

    expect(result.database?.["129888"]).toEqual(expect.objectContaining({ cardId: "CAP_407", name: "通缉海报" }));
    expect(fetchMock).toHaveBeenCalled();
  });

  it("supplements a cached official database even when the China card page is offline", async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "offline-official-online-foreign-service-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "official-cards.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        schemaVersion: 1,
        source: "Blizzard 官方卡牌浏览器",
        version: "cached-version",
        fetchedAt: new Date().toISOString(),
        cards: [{ id: 129888, dbfId: 129888, name: "通缉海报", collectible: 1 }]
      }),
      "utf8"
    );
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://hs.blizzard.cn/cards/") throw new Error("China page offline");
      if (url.includes("static.zerotoheroes.com")) {
        return response(foreignFullSource([{ dbfId: 129888, id: "CAP_407", name: "通缉海报", type: "Spell" }]));
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const result = await new CardDataService(cachePath, fetchMock as never).loadCardDatabase();

    expect(result.database?.["129888"]).toEqual(expect.objectContaining({ cardId: "CAP_407", name: "通缉海报" }));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("static.zerotoheroes.com"), expect.any(Object));
  });

  it("force-refreshes the missing foreign supplement after a preferred-cache startup", { timeout: 15_000 }, async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "retry-foreign-card-supplement-service-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "official-cards.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        schemaVersion: 1,
        source: "Blizzard 官方卡牌浏览器",
        version: "cached-version",
        fetchedAt: new Date().toISOString(),
        cards: [{ id: 129888, dbfId: 129888, name: "通缉海报", collectible: 1 }]
      }),
      "utf8"
    );
    let foreignOnline = false;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://hs.blizzard.cn/cards/") {
        return responseText('<script src="https://hs.res.netease.com/pc/zt/version/js/cards/index_cap.js"></script>');
      }
      if (url.includes("hs-cards-api-server")) {
        return responseJson({ code: 0, data: { total: 1, list: [{ id: 129888, name: "通缉海报", collectible: 1 }] } });
      }
      if (url.includes("api.hearthstonejson.com")) return response([]);
      if (url.includes("static.zerotoheroes.com") || url.includes("static.firestoneapp.com")) {
        if (!foreignOnline) throw new Error("foreign source offline");
        return response(foreignFullSource([{ dbfId: 129888, id: "CAP_407", name: "通缉海报", type: "Spell" }]));
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    const service = new CardDataService(cachePath, fetchMock as never);

    const first = await service.loadCardDatabase({ preferCache: true });
    foreignOnline = true;
    const second = await service.loadCardDatabase({ forceRefresh: true });

    expect(first.database?.["129888"]).not.toEqual(expect.objectContaining({ cardId: "CAP_407" }));
    expect(second.database?.["129888"]).toEqual(expect.objectContaining({ cardId: "CAP_407" }));
  });

  it("uses a fresh versioned cache without fetching", async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "official-card-version-service-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "official-cards.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        source: "Blizzard 官方卡牌浏览器",
        version: "https://hs.res.netease.com/pc/zt/version/js/cards/index_test.js",
        fetchedAt: new Date().toISOString(),
        cards: [{ dbfId: 1001, name: "缓存卡", cardId: "TEST_001" }]
      }),
      "utf8"
    );
    await writeForeignSupplementCache(root, [{
      dbfId: 1001,
      id: "TEST_001",
      name: "海外卡",
      type: "Spell",
      rarity: "Epic",
      cost: 1,
      text: "海外正文"
    }]);
    const fetchMock = vi.fn(async (url: string) =>
      responseText('<script src="https://hs.res.netease.com/pc/zt/version/js/cards/index_test.js"></script>')
    );

    const result = await new CardDataService(cachePath, fetchMock as never).loadCardDatabase();

    expect(result.database?.["1001"]).toEqual(expect.objectContaining({
      name: "缓存卡",
      cardType: "法术",
      rarity: "EPIC",
      manaCost: 1,
      text: "海外正文"
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-downloads official cards when a same-version cache is stale", async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "official-card-stale-version-service-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "official-cards.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        source: "Blizzard 官方卡牌浏览器",
        version: "https://hs.res.netease.com/pc/zt/version/js/cards/index_test.js",
        fetchedAt: "2020-01-01T00:00:00.000Z",
        cards: [{ dbfId: 1001, name: "缓存卡", cardId: "TEST_001" }]
      }),
      "utf8"
    );
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://hs.blizzard.cn/cards/") {
        return responseText('<script src="https://hs.res.netease.com/pc/zt/version/js/cards/index_test.js"></script>');
      }
      if (url.includes("hs-cards-api-server")) {
        return responseJson({ code: 0, data: { total: 1, list: [{ id: 1001, name: "官网最新卡" }] } });
      }
      if (url.includes("static.zerotoheroes.com") || url.includes("static.firestoneapp.com")) return response([]);
      return response([{ dbfId: 1001, id: "TEST_001", name: "旧编号卡" }]);
    });

    const result = await new CardDataService(cachePath, fetchMock as never).loadCardDatabase();

    expect(result.database?.["1001"]).toEqual(expect.objectContaining({ name: "官网最新卡" }));
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("force-refreshes official cards even when the source version is unchanged", async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "official-card-force-version-service-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "official-cards.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        source: "Blizzard 官方卡牌浏览器",
        version: "https://hs.res.netease.com/pc/zt/version/js/cards/index_test.js",
        fetchedAt: new Date().toISOString(),
        cards: [{ dbfId: 1001, name: "缓存卡", cardId: "TEST_001" }]
      }),
      "utf8"
    );
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://hs.blizzard.cn/cards/") {
        return responseText('<script src="https://hs.res.netease.com/pc/zt/version/js/cards/index_test.js"></script>');
      }
      if (url.includes("hs-cards-api-server")) {
        return responseJson({ code: 0, data: { total: 1, list: [{ id: 1001, name: "强制刷新卡" }] } });
      }
      if (url.includes("static.zerotoheroes.com") || url.includes("static.firestoneapp.com")) return response([]);
      return response([{ dbfId: 1001, id: "TEST_001", name: "旧编号卡" }]);
    });

    const result = await new CardDataService(cachePath, fetchMock as never).loadCardDatabase({ forceRefresh: true });

    expect(result.database?.["1001"]).toEqual(expect.objectContaining({ name: "强制刷新卡" }));
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("uses a stale local cache immediately during automatic startup", async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "startup-card-cache-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "cards.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        source: "Blizzard 官方卡牌浏览器",
        version: "old-version",
        fetchedAt: "2020-01-01T00:00:00.000Z",
        cards: [{ dbfId: 1001, name: "缓存卡", cardId: "TEST_001" }]
      }),
      "utf8"
    );
    const fetchMock = vi.fn();

    const result = await new CardDataService(cachePath, fetchMock as never).loadCardDatabase({ preferCache: true });

    expect(result.database?.["1001"]).toEqual(expect.objectContaining({ name: "缓存卡" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a stale cache when an official refresh returns no usable cards", async () => {
    const { CardDataService } = await import("../src/main/cardDataService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "official-card-empty-refresh-"));
    tempDirs.push(root);
    const cachePath = path.join(root, "official-cards.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        source: "Blizzard 官方卡牌浏览器",
        version: "old-version",
        fetchedAt: "2020-01-01T00:00:00.000Z",
        cards: [{ dbfId: 1001, name: "旧缓存卡", cardId: "TEST_001" }]
      }),
      "utf8"
    );
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://hs.blizzard.cn/cards/") {
        return responseText('<script src="https://hs.res.netease.com/pc/zt/version/js/cards/index_new.js"></script>');
      }
      if (url.includes("constructed")) {
        return responseJson({ code: 0, data: { total: 0, list: [] } });
      }
      throw new Error("legacy source unavailable");
    });

    const result = await new CardDataService(cachePath, fetchMock as never).loadCardDatabase();

    expect(result.database?.["1001"]).toEqual(expect.objectContaining({ name: "旧缓存卡" }));
    expect(result.warnings[0]).toContain("继续使用本地");
    expect(JSON.parse(await readFile(cachePath, "utf8"))).toMatchObject({ version: "old-version" });
  });
});

function responseJson(value: unknown) {
  return { ok: true, status: 200, json: async () => value, text: async () => JSON.stringify(value) };
}

function responseText(value: string) {
  return { ok: true, status: 200, json: async () => JSON.parse(value), text: async () => value };
}

function response(value: unknown[]) {
  return responseJson(value);
}

async function writeForeignSupplementCache(root: string, cards: readonly unknown[]) {
  await writeFile(
    path.join(root, "hearthstone-cards.foreign-supplement.json"),
    JSON.stringify({
      schemaVersion: 1,
      source: "Firestone 海外卡牌补充库",
      fetchedAt: "2026-08-25T17:34:05.000Z",
      cards: foreignFullSource(cards)
    }),
    "utf8"
  );
}

const foreignFullFiller = Array.from({ length: 30_000 }, (_, index) => ({
  dbfId: 500_000 + index,
  id: `QA_FOREIGN_${index}`,
  name: "Q"
}));

const requiredForeignCapCardIds = [
  "CAP_000", "CAP_001", "CAP_002", "CAP_003", "CAP_004", "CAP_005", "CAP_006",
  "CAP_101", "CAP_102", "CAP_103", "CAP_104", "CAP_105", "CAP_106", "CAP_107",
  "CAP_400", "CAP_401", "CAP_402", "CAP_403", "CAP_404", "CAP_405", "CAP_406", "CAP_407",
  "CAP_800", "CAP_801", "CAP_802", "CAP_803", "CAP_804", "CAP_805", "CAP_806"
];

function foreignFullSource(cards: readonly unknown[]) {
  const provided = cards.filter((card) => typeof card === "object" && card !== null) as Array<Record<string, unknown>>;
  const providedIds = new Set(provided.map((card) => card.id));
  const requiredCards = requiredForeignCapCardIds
    .filter((cardId) => !providedIds.has(cardId))
    .map((cardId, index) => ({
      dbfId: 800_000 + index,
      id: cardId,
      name: `竞技场新卡 ${cardId}`,
      collectible: true
    }));
  return [
    ...requiredCards,
    ...provided,
    ...foreignFullFiller
  ];
}
