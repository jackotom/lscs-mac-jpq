import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArenaRunStore } from "../src/main/arenaRunStore";
import type { ArenaRunRecord } from "../src/shared/arenaInsights";
import { TrackerEngine } from "../src/shared/trackerEngine";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function archivePath() {
  const root = await mkdtemp(path.join(tmpdir(), "insight-realtime-isolation-"));
  roots.push(root);
  return path.join(root, "arena-runs.json");
}

function completedRun(id: string): ArenaRunRecord {
  return {
    id,
    startedAt: "2026-08-22T10:00:00.000Z",
    endedAt: "2026-08-22T10:30:00.000Z",
    wins: 10,
    losses: 2,
    deck: [],
    rewards: [],
    mulligan: [],
    recordedMatchIds: []
  };
}

function observeHiddenOpponentHand(engine: TrackerEngine) {
  engine.setFriendlyController(1);
  engine.applyText([
    "D 10:00:00.000 GameState.DebugPrintPower() - CREATE_GAME",
    "D 10:00:01.000 GameState.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY id=901 zone=HAND cardId= player=2] CardID="
  ].join("\n"));
}

describe("long-term insight archive and real-time tracker isolation", () => {
  it("recovers a damaged archive without blocking a new live match", async () => {
    const file = await archivePath();
    await writeFile(file, "{damaged", "utf8");
    const store = new ArenaRunStore(file);
    const engine = new TrackerEngine({});

    expect(await store.read()).toEqual([]);
    observeHiddenOpponentHand(engine);
    expect(engine.getState().opponentHand).toEqual([
      expect.objectContaining({ entityId: "901", created: false, forged: false })
    ]);
  });

  it("clears real-time opponent hand on a new game without touching completed local archive", async () => {
    const store = new ArenaRunStore(await archivePath());
    await store.upsert(completedRun("ten-win"));
    const engine = new TrackerEngine({});
    observeHiddenOpponentHand(engine);
    expect(engine.getState().opponentHand).toHaveLength(1);

    engine.resetForGame();

    expect(engine.getState().opponentHand).toEqual([]);
    expect(await store.read()).toEqual([expect.objectContaining({ id: "ten-win", wins: 10 })]);
  });
});
