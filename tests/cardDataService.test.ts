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

  it("refreshes an in-memory database when explicitly requested", async () => {
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

    const result = await new CardDataService(cachePath).loadCardDatabase();

    expect(result.database?.["1001"]).toEqual(expect.objectContaining({ name: "Sample Singleton" }));
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
    const fetchMock = vi.fn(async (url: string) =>
      responseText('<script src="https://hs.res.netease.com/pc/zt/version/js/cards/index_test.js"></script>')
    );

    const result = await new CardDataService(cachePath, fetchMock as never).loadCardDatabase();

    expect(result.database?.["1001"]).toEqual(expect.objectContaining({ name: "缓存卡" }));
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
      return response([{ dbfId: 1001, id: "TEST_001", name: "旧编号卡" }]);
    });

    const result = await new CardDataService(cachePath, fetchMock as never).loadCardDatabase();

    expect(result.database?.["1001"]).toEqual(expect.objectContaining({ name: "官网最新卡" }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
      return response([{ dbfId: 1001, id: "TEST_001", name: "旧编号卡" }]);
    });

    const result = await new CardDataService(cachePath, fetchMock as never).loadCardDatabase({ forceRefresh: true });

    expect(result.database?.["1001"]).toEqual(expect.objectContaining({ name: "强制刷新卡" }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
