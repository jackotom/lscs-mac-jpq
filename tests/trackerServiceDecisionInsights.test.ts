import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => os.tmpdir() }, BrowserWindow: class {} }));
vi.mock("../src/main/cardDataService.js", () => ({ CardDataService: class {
  async loadCardDatabase() { return { warnings: [], database: { "1": { dbfId: 1, cardId: "CS2_029", name: "火球术", type: "SPELL" } } }; }
} }));
vi.mock("../src/main/arenaRatingService.js", () => ({ ArenaRatingService: class {
  async loadRatings() { return { warnings: [] }; }
} }));
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe("TrackerService decision telemetry persistence", () => {
  it("keeps the complete imported deck key stable when generated cards enter its runtime deck", async () => {
    const { TrackerService } = await import("../src/main/trackerService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "tracker-deck-key-"));
    roots.push(root);
    const powerLog = path.join(root, "Power.log");
    await writeFile(powerLog, [
      "D 10:00:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=本地玩家#1234",
      "D 10:00:00.000 GameState.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED",
      "D 10:00:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=MAIN_ACTION"
    ].join("\n") + "\n");
    const history = { add: vi.fn(async (_match: unknown) => undefined), getHistory: vi.fn(), setRetentionDays: vi.fn() };
    const service = new TrackerService(undefined, { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) }, history as never);
    try {
      await service.start({ logPath: powerLog, deckText: "30x 火球术" });
      const deckKey = service.getState().matchDetails?.deckKey;
      expect(deckKey).toMatch(/^[a-f0-9]{64}$/);
      await appendFile(powerLog, [
        "D 10:01:00.000 GameState.DebugPrintPower() - FULL_ENTITY - Creating ID=234 CardID=",
        "D 10:01:00.000 GameState.DebugPrintPower() -     tag=ZONE value=DECK",
        "D 10:01:00.000 GameState.DebugPrintPower() -     tag=CONTROLLER value=1",
        "D 10:01:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=234 tag=DISPLAYED_CREATOR value=219",
        "D 10:01:00.000 GameState.DebugPrintPower() - SHOW_ENTITY - Updating Entity=234 CardID=CS2_029",
        "D 10:01:00.000 GameState.DebugPrintPower() -     tag=CONTROLLER value=1",
        "D 10:01:00.000 GameState.DebugPrintPower() -     tag=ZONE value=DECK"
      ].join("\n") + "\n");
      await vi.waitFor(() => expect(service.getState().summary.totalCards).toBe(31));
      expect(service.getState().matchDetails?.deckKey).toBe(deckKey);
      await appendFile(powerLog, "D 10:02:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=本地玩家 id=2 zone=PLAY player=1] tag=PLAYSTATE value=WON\n");
      await vi.waitFor(() => expect(history.add).toHaveBeenCalledTimes(1));
      expect(history.add.mock.calls[0]![0]).toHaveProperty("details.deckKey", deckKey);
    } finally { await service.dispose(); }
  });

  it("collects actual incremental Power lines, preserves completed mulligan in history and Arena results", async () => {
    const { TrackerService } = await import("../src/main/trackerService.js");
    const root = await mkdtemp(path.join(os.tmpdir(), "tracker-decision-insights-"));
    roots.push(root);
    const powerLog = path.join(root, "Power.log");
    await writeFile(path.join(root, "Arena.log"), [
      "D 10:00:00.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 77, Hero Card = HERO_08",
      "D 10:00:00.100 DraftManager.OnChoicesAndContents - Draft deck contains card CS2_029",
      "D 10:00:01.000 SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n") + "\n");
    await writeFile(powerLog, [
      "D 10:01:00.000 GameState.DebugPrintGame() - PlayerID=2, PlayerName=本地玩家#1234",
      "D 10:01:00.000 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER",
      "D 10:01:01.000 GameState.DebugPrintPower() - CREATE_GAME GameType=GT_ARENA",
      "D 10:01:01.000 GameState.DebugPrintPower() - Player EntityID=2 PlayerID=1 GameAccountId=[hi=1 lo=2]",
      "D 10:01:01.000 GameState.DebugPrintPower() - Player EntityID=3 PlayerID=2 GameAccountId=[hi=3 lo=4]",
      "D 10:01:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=本地玩家#1234 tag=MULLIGAN_STATE value=INPUT",
      "D 10:01:02.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=火球术 id=20 zone=DECK cardId=CS2_029 player=2] tag=ZONE value=HAND",
      "D 10:01:02.000 GameState.DebugPrintEntityChoices() - id=1 Player=本地玩家#1234 TaskList= ChoiceType=MULLIGAN CountMin=0 CountMax=1",
      "D 10:01:02.000 GameState.DebugPrintEntityChoices() - Entities[0]=[entityName=火球术 id=20 zone=HAND cardId=CS2_029 player=2]"
    ].join("\n") + "\n");
    const history = { add: vi.fn(async (_match: unknown) => undefined), getHistory: vi.fn(), setRetentionDays: vi.fn() };
    const insights = { startRun: vi.fn(async () => undefined), recordResult: vi.fn(async (..._args: unknown[]) => undefined), completeRun: vi.fn(async () => undefined) };
    const service = new TrackerService(undefined, { recognize: vi.fn(async () => ({ status: "ok" as const, texts: [] })) }, history as never, insights);
    try {
      await service.start({ logPath: powerLog });
      expect(service.getState().decisionOffer).toMatchObject({ kind: "mulligan", cards: [{ cardId: "CS2_029" }] });
      await appendFile(powerLog, "D 10:01:03.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=3 tag=MULLIGAN_STATE value=");
      await appendFile(powerLog, [
        "DONE",
        "D 10:01:03.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=MAIN_READY",
        "D 10:03:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=本地玩家 id=3 zone=PLAY player=2] tag=PLAYSTATE value=WON",
        "D 10:03:01.100 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=FINAL_GAMEOVER"
      ].join("\n") + "\n");
      await vi.waitFor(() => expect(history.add).toHaveBeenCalledTimes(1));
      const match = history.add.mock.calls[0]![0];
      expect(match).toMatchObject({ mode: "arena", result: "win", details: { durationSeconds: 120, mulligan: [
        { cardId: "CS2_029", drawnBeforeMulligan: true, keptInMulligan: true, inHandAfterMulligan: true }
      ] } });
      expect(match).not.toHaveProperty("details.deckKey"); // A one-card partial Arena list is not a deck identity.
      await vi.waitFor(() => expect(insights.recordResult).toHaveBeenCalledWith("arena:77", "win", expect.any(String), [
        expect.objectContaining({ cardId: "CS2_029", drawnBeforeMulligan: true, keptInMulligan: true, won: true })
      ]));
      expect(service.getState().decisionOffer).toBeUndefined();
      expect(service.getState().matchDetails).toBeUndefined();
    } finally { await service.dispose(); }
  });
});
