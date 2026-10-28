import { describe, expect, it } from "vitest";
import { MatchTelemetry } from "../src/shared/matchTelemetry.js";

const power = (text: string, at = "10:00:00.000") => `D ${at} GameState.DebugPrintPower() - ${text}`;
const entity = (id: number, cardId: string, player = 2, zone = "HAND") => `[entityName=${cardId} id=${id} zone=${zone} zonePos=1 cardId=${cardId} player=${player}]`;
const apply = (telemetry: MatchTelemetry, lines: string[], controller?: number) => lines.forEach(line => telemetry.applyLine(line, controller));

function setup(telemetry: MatchTelemetry, controller?: number) {
  apply(telemetry, [
    power("CREATE_GAME GameType=GT_RANKED"),
    power("GameEntity EntityID=1"),
    power("Player EntityID=2 PlayerID=1 GameAccountId=[hi=1 lo=2]"),
    power("Player EntityID=3 PlayerID=2 GameAccountId=[hi=3 lo=4]"),
    power("FULL_ENTITY - Creating ID=10 CardID=HERO_08"),
    power("    tag=CARDTYPE value=HERO"),
    power("    tag=CONTROLLER value=1"),
    power("    tag=CLASS value=MAGE"),
    power("FULL_ENTITY - Creating ID=11 CardID=HERO_01"),
    power("    tag=CARDTYPE value=HERO"),
    power("    tag=CONTROLLER value=2"),
    power("    tag=CLASS value=WARRIOR"),
    power("TAG_CHANGE Entity=2 tag=FIRST_PLAYER value=1"),
    power("TAG_CHANGE Entity=3 tag=MULLIGAN_STATE value=INPUT")
  ], controller);
}

describe("MatchTelemetry real Power log structure", () => {
  it("resolves player 2 using player entity mapping, and does not invent local identity", () => {
    const unknown = new MatchTelemetry();
    setup(unknown);
    expect(unknown.getDetails()).not.toHaveProperty("friendlyClass");
    expect(unknown.getDetails()).not.toHaveProperty("initiative");
    unknown.applyLine(power("TAG_CHANGE Entity=GameEntity tag=TURN value=1"), 2);
    expect(unknown.getDetails()).toMatchObject({ friendlyClass: "WARRIOR", opponentClass: "MAGE", initiative: "second" });
    const first = new MatchTelemetry();
    setup(first, 1);
    expect(first.getDetails()).toMatchObject({ friendlyClass: "MAGE", opponentClass: "WARRIOR", initiative: "first" });
  });

  it("keeps original, replaced and replacement cards separate across incremental entity blocks", () => {
    const telemetry = new MatchTelemetry();
    setup(telemetry, 2);
    apply(telemetry, [
      power("FULL_ENTITY - Creating ID=20 CardID=CS2_029"),
      power("    tag=ZONE value=HAND"),
      power("    tag=CONTROLLER value=2"),
      power("FULL_ENTITY - Creating ID=21 CardID=CS2_024"),
      power("    tag=ZONE value=HAND"),
      power("    tag=CONTROLLER value=2"),
      "D 10:00:01.000 GameState.DebugPrintEntityChoices() - id=7 Player=2 TaskList= ChoiceType=MULLIGAN CountMin=0 CountMax=2",
      `D 10:00:01.000 GameState.DebugPrintEntityChoices() - Entities[0]=${entity(20, "CS2_029")}`,
      `D 10:00:01.000 GameState.DebugPrintEntityChoices() - Entities[1]=${entity(21, "CS2_024")}`
    ], 2);
    expect(telemetry.getOffer()?.cards.map(card => card.cardId)).toEqual(["CS2_029", "CS2_024"]);
    apply(telemetry, [
      "D 10:00:02.000 GameState.SendChoices() - id=7 ChoiceType=MULLIGAN",
      `D 10:00:02.000 GameState.SendChoices() - m_chosenEntities[0]=${entity(21, "CS2_024")}`,
      power("TAG_CHANGE Entity=3 tag=MULLIGAN_STATE value=DONE")
    ], 2);
    expect(telemetry.getOffer()).toBeUndefined();
    expect(telemetry.getDetails().mulligan).toBeUndefined();
    apply(telemetry, [
      power(`TAG_CHANGE Entity=${entity(21, "CS2_024")} tag=ZONE value=DECK`),
      power(`TAG_CHANGE Entity=${entity(22, "CS2_023", 2, "DECK")} tag=ZONE value=HAND`),
      power("TAG_CHANGE Entity=GameEntity tag=STEP value=MAIN_READY"),
      power("TAG_CHANGE Entity=GameEntity tag=TURN value=8", "10:01:00.000"),
      power("TAG_CHANGE Entity=3 tag=PLAYSTATE value=WON", "10:02:00.000")
    ], 2);
    expect(telemetry.getOffer()).toBeUndefined();
    expect(telemetry.getDetails()).toMatchObject({ turns: 8, durationSeconds: 120, mulligan: [
      { cardId: "CS2_029", drawnBeforeMulligan: true, keptInMulligan: true, inHandAfterMulligan: true },
      { cardId: "CS2_024", drawnBeforeMulligan: true, keptInMulligan: false, inHandAfterMulligan: false },
      { cardId: "CS2_023", drawnBeforeMulligan: false, keptInMulligan: false, inHandAfterMulligan: true }
    ] });
  });

  it("ignores duplicate CREATE_GAME, clears answered discoveries, and resets on a different game", () => {
    const telemetry = new MatchTelemetry();
    setup(telemetry, 2);
    telemetry.applyLine("D 10:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED", 2);
    expect(telemetry.getDetails().friendlyClass).toBe("WARRIOR");
    apply(telemetry, [
      power("TAG_CHANGE Entity=GameEntity tag=STEP value=MAIN_ACTION"),
      "D 10:01:00.000 GameState.DebugPrintEntityChoices() - id=8 Player=2 TaskList= ChoiceType=GENERAL CountMin=1 CountMax=1",
      `D 10:01:00.000 GameState.DebugPrintEntityChoices() - Entities[0]=${entity(30, "CS2_029", 2, "SETASIDE")}`,
      `D 10:01:00.000 GameState.DebugPrintEntityChoices() - Entities[1]=${entity(31, "CS2_024", 2, "SETASIDE")}`
    ], 2);
    expect(telemetry.getOffer()).toMatchObject({ kind: "discover", cards: [{ cardId: "CS2_029" }, { cardId: "CS2_024" }] });
    telemetry.applyLine("D 10:01:02.000 GameState.SendChoices() - id=8 ChoiceType=GENERAL", 2);
    expect(telemetry.getOffer()).toBeUndefined();
    telemetry.applyLine(power("CREATE_GAME GameType=GT_RANKED", "11:00:00.000"), 1);
    expect(telemetry.getDetails()).toEqual({});
    expect(telemetry.getOffer()).toBeUndefined();
    telemetry.reset();
    telemetry.applyLine(power("TAG_CHANGE Entity=GameEntity tag=STEP value=MAIN_ACTION"), 1);
    telemetry.applyLine(power(`TAG_CHANGE Entity=${entity(45, "CS2_029", 1, "DECK")} tag=ZONE value=HAND`), 1);
    expect(telemetry.getDetails().mulligan).toBeUndefined();
  });

  it("normalizes database hero classes and rejects unknown classes", () => {
    const telemetry = new MatchTelemetry();
    telemetry.setCardDatabase({
      "1": { dbfId: 1, cardId: "HERO_08", name: "吉安娜", heroClass: "法师", type: "HERO" },
      "2": { dbfId: 2, cardId: "HERO_01", name: "加尔鲁什", heroClass: "not-a-class", type: "HERO" }
    });
    apply(telemetry, [power("CREATE_GAME"), power(`FULL_ENTITY - Updating ${entity(10, "HERO_08", 2, "PLAY")} CardID=HERO_08`), power(`FULL_ENTITY - Updating ${entity(11, "HERO_01", 1, "PLAY")} CardID=HERO_01`)], 2);
    expect(telemetry.getDetails()).toEqual({ friendlyClass: "MAGE" });
  });
});
