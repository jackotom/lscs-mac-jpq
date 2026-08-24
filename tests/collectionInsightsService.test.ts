import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { CollectionInsightsService, parseCollectionCsvIpcInput } from "../src/main/collectionInsightsService";
import { CollectionInsightsStore } from "../src/main/collectionInsightsStore";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function service() {
  const root = await mkdtemp(path.join(tmpdir(), "collection-service-"));
  roots.push(root);
  return new CollectionInsightsService(new CollectionInsightsStore(path.join(root, "collection.json")), () => new Date("2026-08-22T12:00:00.000Z"));
}

describe("CollectionInsightsService", () => {
  it("rejects non-text and oversized CSV at the IPC boundary", () => {
    expect(() => parseCollectionCsvIpcInput(42)).toThrow();
    expect(() => parseCollectionCsvIpcInput("x".repeat(5 * 1024 * 1024 + 1))).toThrow(/5 MB/);
    expect(parseCollectionCsvIpcInput("type,id")).toBe("type,id");
  });

  it("counts pity independently by set, resets on rarity, and stays partial", async () => {
    const insights = await service();
    await insights.recordPackOpening({ id: "a-1", set: "A", openedAt: "2026-08-22T10:00:00.000Z", cards: [{ rarity: "common" }] });
    await insights.recordPackOpening({ id: "b-1", set: "B", openedAt: "2026-08-22T10:01:00.000Z", cards: [{ rarity: "common" }] });
    await insights.recordPackOpening({ id: "a-2", set: "A", openedAt: "2026-08-22T10:02:00.000Z", cards: [{ rarity: "legendary" }] });

    const result = await insights.getInsights();
    expect(result.source).toBe("manual");
    expect(result.pity).toEqual(expect.arrayContaining([
      expect.objectContaining({ set: "A", packsSinceLegendary: 0, packsSinceEpic: 0, partial: true, legendaryLimit: 40, epicLimit: 10 }),
      expect.objectContaining({ set: "B", packsSinceLegendary: 1, packsSinceEpic: 1, partial: true })
    ]));
  });

  it("deduplicates replayed packs and never mixes series counters", async () => {
    const insights = await service();
    const pack = { id: "same", set: "A", openedAt: "2026-08-22T10:00:00.000Z", cards: [{ rarity: "rare" as const }] };
    await insights.recordPackOpening(pack);
    await insights.recordPackOpening(pack);
    const result = await insights.getInsights();
    expect(result.packs).toHaveLength(1);
    expect(result.pity).toEqual([expect.objectContaining({ set: "A", packsSinceLegendary: 1 })]);
  });

  it("rejects invalid imports and preserves the last valid snapshot", async () => {
    const insights = await service();
    await insights.importSnapshot({ cards: [{ cardId: "A", normal: 2, golden: 1 }], packs: [], pity: [], cardBacks: [], heroSkins: [], coins: [], updatedAt: "2026-08-22T11:00:00.000Z", source: "import" });
    await expect(insights.importSnapshot({ cards: [{ cardId: "A", normal: -2, golden: 0 }], packs: [], pity: [], cardBacks: [], heroSkins: [], coins: [], updatedAt: "2026-08-22T12:00:00.000Z", source: "import" })).rejects.toThrow();
    expect((await insights.getInsights()).cards).toEqual([{ cardId: "A", normal: 2, golden: 1 }]);
  });

  it("recomputes imported pity from confirmed packs and forces partial history", async () => {
    const insights = await service();
    await insights.importSnapshot({
      cards: [],
      packs: [{ id: "known", set: "A", openedAt: "2026-08-22T10:00:00.000Z", cards: [{ rarity: "common" }] }],
      pity: [{ set: "A", packsSinceLegendary: 39, partial: false }],
      cardBacks: [], heroSkins: [], coins: [],
      updatedAt: "2026-08-22T11:00:00.000Z",
      source: "import"
    });
    expect((await insights.getInsights()).pity).toEqual([
      expect.objectContaining({ set: "A", packsSinceLegendary: 1, partial: true })
    ]);
  });

  it("serializes concurrent pack records without dropping a pack", async () => {
    const insights = await service();
    await Promise.all(Array.from({ length: 12 }, (_value, index) => insights.recordPackOpening({
      id: `pack-${index}`,
      set: "A",
      openedAt: `2026-08-22T10:${String(index).padStart(2, "0")}:00.000Z`,
      cards: [{ rarity: "common" }]
    })));
    const result = await insights.getInsights();
    expect(result.packs).toHaveLength(12);
    expect(result.pity).toEqual([expect.objectContaining({ packsSinceLegendary: 12, partial: true })]);
  });

  it("imports CSV and recomputes partial pity only from its confirmed pack rows", async () => {
    const insights = await service();
    const result = await insights.importCollectionCsv([
      "type,id,name,normal,golden,set,openedAt,rarity,packId",
      "pack_card,A,Card,,false,SET_A,2026-08-22T10:00:00.000Z,common,PACK_1"
    ].join("\n"));
    expect(result).toMatchObject({
      source: "import",
      pity: [{ set: "SET_A", packsSinceLegendary: 1, partial: true }]
    });
  });
});
