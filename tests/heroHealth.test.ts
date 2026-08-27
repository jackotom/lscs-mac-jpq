import { describe, expect, it } from "vitest";
import { parseLogLine } from "../src/shared/powerLogParser";
import { TrackerEngine } from "../src/shared/trackerEngine";

const start = "D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME";

function heroTag(
  entityId: number,
  controller: number | undefined,
  tag: "HEALTH" | "DAMAGE" | "ARMOR",
  value: number,
  cardType = "HERO"
) {
  const player = controller === undefined ? "" : ` player=${controller}`;
  return `D 12:00:01.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Hero ${entityId} id=${entityId} zone=PLAY cardId=HERO_${entityId}${player} cardType=${cardType}] tag=${tag} value=${value}`;
}

describe("hero health-limit log parsing", () => {
  it("parses HEALTH as the only authoritative limit tag", () => {
    expect(parseLogLine(heroTag(4, 1, "HEALTH", 40))).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "hero-health-limit-change",
        value: 40,
        entity: expect.objectContaining({ id: "4", controller: 1, cardType: "HERO" })
      })
    ]));
    expect(parseLogLine(heroTag(4, 1, "DAMAGE", 9)))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "hero-health-limit-change" })]));
    expect(parseLogLine(heroTag(4, 1, "ARMOR", 6)))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "hero-health-limit-change" })]));
  });
});

describe("TrackerEngine hero health limit", () => {
  it("publishes friendly and opponent total health limits without mixing sides", () => {
    const engine = new TrackerEngine();
    engine.setFriendlyController(1);
    engine.applyText([
      start,
      heroTag(4, 1, "HEALTH", 40),
      heroTag(4, 1, "DAMAGE", 13),
      heroTag(4, 1, "ARMOR", 6),
      heroTag(7, 2, "HEALTH", 30),
      heroTag(7, 2, "DAMAGE", 8),
      heroTag(7, 2, "ARMOR", 10)
    ].join("\n"));

    expect(engine.getState().heroHealthLimit).toEqual({ friendly: 40, opponent: 30 });
  });

  it("starts at 30, Amara raises HEALTH to 40, damage/healing/armor do not change it, and a HEALTH loss lowers it to 39", () => {
    const engine = new TrackerEngine();
    engine.setFriendlyController(1);
    engine.applyText([
      start,
      heroTag(4, 1, "HEALTH", 30)
    ].join("\n"));
    expect(engine.getState().heroHealthLimit).toEqual({ friendly: 30 });

    engine.applyLine(heroTag(4, 1, "HEALTH", 40));
    expect(engine.getState().heroHealthLimit).toEqual({ friendly: 40 });

    engine.applyText([
      heroTag(4, 1, "DAMAGE", 8),
      heroTag(4, 1, "DAMAGE", 3),
      heroTag(4, 1, "ARMOR", 10),
      heroTag(4, 1, "ARMOR", 0)
    ].join("\n"));
    expect(engine.getState().heroHealthLimit).toEqual({ friendly: 40 });

    engine.applyLine(heroTag(4, 1, "HEALTH", 39));
    expect(engine.getState().heroHealthLimit).toEqual({ friendly: 39 });
  });

  it("backfills sides when local-player identity arrives after hero stats", () => {
    const engine = new TrackerEngine();
    engine.applyText([
      start,
      heroTag(4, 1, "HEALTH", 30),
      heroTag(4, 1, "DAMAGE", 2),
      heroTag(7, 2, "HEALTH", 40),
      heroTag(7, 2, "ARMOR", 5)
    ].join("\n"));

    expect(engine.getState().heroHealthLimit).toBeUndefined();
    engine.setFriendlyController(2);
    expect(engine.getState().heroHealthLimit).toEqual({ friendly: 40, opponent: 30 });
  });

  it("backfills controller and hero type revealed after health tags", () => {
    const engine = new TrackerEngine();
    engine.setFriendlyController(1);
    engine.applyText([
      start,
      heroTag(4, undefined, "HEALTH", 30, "INVALID"),
      heroTag(4, undefined, "DAMAGE", 4, "INVALID"),
      "D 12:00:02.000 PowerTaskList.DebugPrintPower() - SHOW_ENTITY - Updating Entity=[entityName=Friendly Hero id=4 zone=PLAY cardId=HERO_4 player=1 cardType=HERO] CardID=HERO_4"
    ].join("\n"));

    expect(engine.getState().heroHealthLimit).toEqual({ friendly: 30 });
  });

  it("accepts health tags from multi-line hero entities", () => {
    const engine = new TrackerEngine();
    engine.setFriendlyController(1);
    engine.applyText([
      start,
      "D 12:00:01.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Creating ID=4 CardID=HERO_4",
      "D 12:00:01.010 PowerTaskList.DebugPrintPower() -     tag=CONTROLLER value=1",
      "D 12:00:01.020 PowerTaskList.DebugPrintPower() -     tag=CARDTYPE value=HERO",
      "D 12:00:01.030 PowerTaskList.DebugPrintPower() -     tag=ZONE value=PLAY",
      "D 12:00:01.040 PowerTaskList.DebugPrintPower() -     tag=HEALTH value=35",
      "D 12:00:01.050 PowerTaskList.DebugPrintPower() -     tag=DAMAGE value=5",
      "D 12:00:01.060 PowerTaskList.DebugPrintPower() -     tag=ARMOR value=7"
    ].join("\n"));

    expect(engine.getState().heroHealthLimit).toEqual({ friendly: 35 });
  });

  it("ignores non-heroes and clears health at game boundaries", () => {
    const engine = new TrackerEngine();
    engine.setFriendlyController(1);
    engine.applyText([
      start,
      heroTag(9, 1, "HEALTH", 12, "MINION"),
      heroTag(4, 1, "ARMOR", 9)
    ].join("\n"));
    expect(engine.getState().heroHealthLimit).toBeUndefined();

    engine.applyLine(heroTag(4, 1, "HEALTH", 30));
    expect(engine.getState().heroHealthLimit).toEqual({ friendly: 30 });

    engine.applyLine("D 12:10:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=FINAL_GAMEOVER");
    expect(engine.getState().heroHealthLimit).toBeUndefined();

    engine.applyLine("D 12:11:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME");
    expect(engine.getState().heroHealthLimit).toBeUndefined();
  });
});
