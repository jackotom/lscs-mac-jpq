import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ArenaRunStore } from "../src/main/arenaRunStore";
import type { ArenaRunRecord } from "../src/shared/arenaInsights";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixturePath() {
  const root = await mkdtemp(path.join(tmpdir(), "arena-run-store-"));
  roots.push(root);
  return path.join(root, "arena-runs.json");
}

function run(id: string, startedAt: string, wins = 0): ArenaRunRecord {
  return { id, startedAt, wins, losses: 0, deck: [], rewards: [], mulligan: [], recordedMatchIds: [] };
}

describe("ArenaRunStore", () => {
  it("writes atomically and deduplicates a replayed run id", async () => {
    const file = await fixturePath();
    const store = new ArenaRunStore(file);
    await store.upsert(run("same", "2026-08-22T00:00:00.000Z", 2));
    await store.upsert(run("same", "2026-08-22T00:00:00.000Z", 7));

    expect(await store.read()).toEqual([expect.objectContaining({ id: "same", wins: 7 })]);
    expect(JSON.parse(await readFile(file, "utf8")).runs).toHaveLength(1);
    expect((await readdir(path.dirname(file))).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("quarantines corrupt data and recovers with an empty archive", async () => {
    const file = await fixturePath();
    await writeFile(file, "{broken", "utf8");
    const store = new ArenaRunStore(file);

    expect(await store.read()).toEqual([]);
    expect((await readdir(path.dirname(file))).some((name) => name.includes(".corrupt-"))).toBe(true);
    await store.upsert(run("fresh", "2026-08-22T00:00:00.000Z"));
    expect(await store.read()).toHaveLength(1);
  });

  it("filters completed runs by 30, 90, and 180 day windows", async () => {
    const file = await fixturePath();
    const now = Date.parse("2026-08-22T00:00:00.000Z");
    const store = new ArenaRunStore(file, () => new Date(now));
    await store.replace([
      run("recent", "2026-08-12T00:00:00.000Z"),
      run("middle", "2026-07-03T00:00:00.000Z"),
      run("old", "2026-04-04T00:00:00.000Z")
    ]);

    expect((await store.read(30)).map(({ id }) => id)).toEqual(["recent"]);
    expect((await store.read(90)).map(({ id }) => id)).toEqual(["recent", "middle"]);
    expect((await store.read(180)).map(({ id }) => id)).toEqual(["recent", "middle", "old"]);
  });
});
