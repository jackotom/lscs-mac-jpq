import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { CollectionInsightsStore } from "../src/main/collectionInsightsStore";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixturePath() {
  const root = await mkdtemp(path.join(tmpdir(), "collection-insights-"));
  roots.push(root);
  return path.join(root, "collection-insights.json");
}

describe("CollectionInsightsStore", () => {
  it("normalizes card and cosmetic duplicates and writes atomically", async () => {
    const file = await fixturePath();
    const store = new CollectionInsightsStore(file);
    const saved = await store.replace({
      cards: [
        { cardId: "A", name: "A", normal: 1, golden: 0 },
        { cardId: "A", name: "A", normal: 2, golden: 1 }
      ],
      packs: [], pity: [],
      cardBacks: [{ id: "back", name: "卡背" }, { id: "back", name: "卡背" }],
      heroSkins: [], coins: [],
      updatedAt: "2026-08-22T12:00:00.000Z",
      source: "import"
    });

    expect(saved.cards).toEqual([{ cardId: "A", name: "A", normal: 3, golden: 1 }]);
    expect(saved.cardBacks).toEqual([{ id: "back", name: "卡背" }]);
    expect((await readdir(path.dirname(file))).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("rejects negative counts without replacing the last valid snapshot", async () => {
    const file = await fixturePath();
    const store = new CollectionInsightsStore(file);
    await store.replace({ cards: [], packs: [], pity: [], cardBacks: [], heroSkins: [], coins: [], updatedAt: "2026-08-22T12:00:00.000Z", source: "manual" });
    await expect(store.replace({ cards: [{ cardId: "A", normal: -1, golden: 0 }], packs: [], pity: [], cardBacks: [], heroSkins: [], coins: [], updatedAt: "2026-08-22T13:00:00.000Z", source: "import" })).rejects.toThrow(/数量/);
    expect((await store.read())?.source).toBe("manual");
  });

  it("quarantines a damaged file and returns no invented snapshot", async () => {
    const file = await fixturePath();
    await writeFile(file, "not json", "utf8");
    const store = new CollectionInsightsStore(file);
    expect(await store.read()).toBeUndefined();
    expect((await readdir(path.dirname(file))).some((name) => name.includes(".corrupt-"))).toBe(true);
  });
});
