import { describe, expect, it } from "vitest";
import { createCardDatabase } from "../src/shared/cardDatabase";
import { SecretTracker } from "../src/shared/secretTracker";

const database = createCardDatabase([
  { id: 1, cardId: "EX1_287", name: "法术反制", collectible: true, type: "SPELL", playerClass: "MAGE", mechanics: ["SECRET"] },
  { id: 2, cardId: "UNKNOWN_SECRET", name: "未知规则奥秘", collectible: true, type: "SPELL", playerClass: "MAGE", mechanics: ["SECRET"] },
  { id: 3, cardId: "PAL_SECRET", name: "圣骑士奥秘", collectible: true, type: "SPELL", playerClass: "PALADIN", mechanics: ["SECRET"] }
  ,{ id: 4, cardId: "DMF_236", name: "古神在上", collectible: true, type: "SPELL", playerClass: "PALADIN", mechanics: ["SECRET"] }
  ,{ id: 5, cardId: "EX1_294", name: "镜像实体", collectible: true, type: "SPELL", playerClass: "MAGE", mechanics: ["SECRET"] }
  ,{ id: 6, cardId: "LOOT_101", name: "爆炸符文", collectible: true, type: "SPELL", playerClass: "MAGE", mechanics: ["SECRET"] }
  ,{ id: 7, cardId: "REV_828", name: "绑架", collectible: true, type: "SPELL", playerClass: "ROGUE", mechanics: ["SECRET"] }
  ,{ id: 8, cardId: "MAW_006", name: "异议", collectible: true, type: "SPELL", playerClass: "MAGE", mechanics: ["SECRET"] }
]);

describe("SecretTracker", () => {
  it("keeps independent slots and conservatively filters candidates by class", () => {
    const tracker = new SecretTracker(database);
    tracker.setOpponentClass("法师");
    tracker.enterSecret("10");
    tracker.enterSecret("11");

    expect(tracker.getSlots()).toHaveLength(2);
    expect(tracker.getSlots()[0].candidates.map((candidate) => candidate.cardId)).toEqual(expect.arrayContaining(["EX1_287", "UNKNOWN_SECRET"]));
  });

  it("only excludes a supported secret after a matching action completes without a trigger", () => {
    const tracker = new SecretTracker(database);
    tracker.setOpponentClass("法师");
    tracker.enterSecret("10");
    tracker.beginAction("friendly-spell");
    tracker.endAction();

    expect(tracker.getSlots()[0].candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: "EX1_287", status: "excluded" }),
      expect.objectContaining({ cardId: "UNKNOWN_SECRET", status: "possible" })
    ]));
  });

  it("reveals and removes the matching entity and resets all slots", () => {
    const tracker = new SecretTracker(database);
    tracker.enterSecret("10");
    tracker.revealSecret("10", "EX1_287");
    expect(tracker.getSlots()[0]).toMatchObject({ revealedCardId: "EX1_287" });
    tracker.leaveSecret("10");
    expect(tracker.getSlots()).toEqual([]);
    tracker.enterSecret("11");
    tracker.reset();
    expect(tracker.getSlots()).toEqual([]);
  });

  it("rebuilds existing slot candidates when the opponent class becomes known", () => {
    const tracker = new SecretTracker(database);
    tracker.enterSecret("10");
    expect(tracker.getSlots()[0].candidates.some((candidate) => candidate.cardId === "PAL_SECRET")).toBe(true);
    tracker.setOpponentClass("法师");
    expect(tracker.getSlots()[0].candidates.some((candidate) => candidate.cardId === "PAL_SECRET")).toBe(false);
  });

  it("keeps explicit classes isolated across simultaneous secret slots", () => {
    const tracker = new SecretTracker(database);
    tracker.setOpponentClass("法师");
    tracker.enterSecret("mage-slot", "MAGE");
    tracker.enterSecret("paladin-slot", "PALADIN");

    const slots = new Map(tracker.getSlots().map((slot) => [slot.entityId, slot]));
    expect(slots.get("mage-slot")?.candidates.map((candidate) => candidate.cardId)).toContain("EX1_287");
    expect(slots.get("mage-slot")?.candidates.map((candidate) => candidate.cardId)).not.toContain("PAL_SECRET");
    expect(slots.get("paladin-slot")?.candidates.map((candidate) => candidate.cardId)).toContain("PAL_SECRET");
    expect(slots.get("paladin-slot")?.candidates.map((candidate) => candidate.cardId)).not.toContain("EX1_287");
  });

  it("preserves exclusions only for intersecting candidates when a slot gains an explicit class", () => {
    const classSwitchDatabase = createCardDatabase([
      { id: 101, cardId: "MAGE_ONLY", name: "法师专属", collectible: true, type: "SPELL", playerClass: "MAGE", mechanics: ["SECRET"] },
      { id: 102, cardId: "PAL_ONLY", name: "圣骑士专属", collectible: true, type: "SPELL", playerClass: "PALADIN", mechanics: ["SECRET"] },
      { id: 103, cardId: "EX1_287", name: "共享法术反制", collectible: true, type: "SPELL", classes: ["MAGE", "PALADIN"], mechanics: ["SECRET"] }
    ]);
    const tracker = new SecretTracker(classSwitchDatabase);
    tracker.setOpponentClass("MAGE");
    tracker.enterSecret("10");
    tracker.beginAction("friendly-spell");
    tracker.endAction();

    tracker.setSecretClass("10", "PALADIN");

    expect(tracker.getSlots()[0].candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: "EX1_287", status: "excluded" }),
      expect.objectContaining({ cardId: "PAL_ONLY", status: "possible" })
    ]));
    expect(tracker.getSlots()[0].candidates.map((candidate) => candidate.cardId)).not.toContain("MAGE_ONLY");
  });

  it("falls back to the opponent hero class when a secret has no explicit class", () => {
    const tracker = new SecretTracker(database);
    tracker.setOpponentClass("MAGE");
    tracker.enterSecret("10");

    expect(tracker.getSlots()[0].candidates.map((candidate) => candidate.cardId)).toContain("EX1_287");
    expect(tracker.getSlots()[0].candidates.map((candidate) => candidate.cardId)).not.toContain("PAL_SECRET");
  });

  it("does not retain removed slot class or exclusion state when entities enter again", () => {
    const tracker = new SecretTracker(database);
    tracker.setOpponentClass("MAGE");
    tracker.enterSecret("same-entity", "PALADIN");
    tracker.beginAction("friendly-spell");
    tracker.endAction();
    tracker.leaveSecret("same-entity");

    tracker.enterSecret("same-entity");
    tracker.enterSecret("new-entity");

    for (const slot of tracker.getSlots()) {
      expect(slot.candidates.map((candidate) => candidate.cardId)).toContain("EX1_287");
      expect(slot.candidates.map((candidate) => candidate.cardId)).not.toContain("PAL_SECRET");
      expect(slot.candidates.every((candidate) => candidate.status === "possible")).toBe(true);
    }
  });

  it("excludes only supported spell-trigger secrets after a friendly spell", () => {
    const tracker = new SecretTracker(database);
    tracker.enterSecret("10");
    tracker.beginAction("friendly-spell");
    tracker.endAction();
    const excluded = tracker.getSlots()[0].candidates.filter((candidate) => candidate.status === "excluded").map((candidate) => candidate.cardId);
    expect(excluded).toEqual(expect.arrayContaining(["EX1_287", "DMF_236"]));
    expect(excluded).not.toContain("UNKNOWN_SECRET");
  });

  it("excludes only supported minion-trigger secrets after a friendly minion", () => {
    const tracker = new SecretTracker(database);
    tracker.enterSecret("10");
    tracker.beginAction({ kind: "friendly-minion", opponentBoardHasSpace: true });
    tracker.endAction();
    const excluded = tracker.getSlots()[0].candidates.filter((candidate) => candidate.status === "excluded").map((candidate) => candidate.cardId);
    expect(excluded).toEqual(expect.arrayContaining(["EX1_294", "LOOT_101", "MAW_006"]));
    expect(excluded).not.toContain("UNKNOWN_SECRET");
  });

  it("deduplicates CORE and VAN variants and applies rules to real card ids", () => {
    const realDatabase = createCardDatabase([
      { id: 101, cardId: "EX1_287", name: "法术反制", collectible: true, type: "SPELL", playerClass: "MAGE", mechanics: ["SECRET"] },
      { id: 102, cardId: "CORE_EX1_287", name: "法术反制", collectible: true, type: "SPELL", playerClass: "MAGE", mechanics: ["SECRET"] },
      { id: 103, cardId: "VAN_EX1_287", name: "法术反制", collectible: true, type: "SPELL", playerClass: "MAGE", mechanics: ["SECRET"] },
      { id: 104, cardId: "CORE_MAW_006", name: "异议", collectible: true, type: "SPELL", playerClass: "MAGE", mechanics: ["SECRET"] }
    ]);
    const tracker = new SecretTracker(realDatabase);
    tracker.setOpponentClass("法师");
    tracker.enterSecret("10");

    expect(tracker.getSlots()[0].candidates.filter((candidate) => candidate.name === "法术反制")).toHaveLength(1);

    tracker.beginAction("friendly-spell");
    tracker.endAction();
    expect(tracker.getSlots()[0].candidates).toContainEqual(expect.objectContaining({
      cardId: "CORE_EX1_287",
      status: "excluded",
      exclusionReason: "spell-played-without-trigger"
    }));

    tracker.beginAction("friendly-minion");
    tracker.endAction();
    expect(tracker.getSlots()[0].candidates).toContainEqual(expect.objectContaining({
      cardId: "CORE_MAW_006",
      status: "excluded",
      exclusionReason: "minion-played-without-trigger"
    }));
  });

  it("excludes hero-attack secrets only after an attack on the opponent hero", () => {
    const attackDatabase = createCardDatabase([
      { id: 201, cardId: "VAN_EX1_289", name: "寒冰护体", collectible: true, type: "SPELL", playerClass: "MAGE", mechanics: ["SECRET"] },
      { id: 202, cardId: "VAN_EX1_610", name: "爆炸陷阱", collectible: true, type: "SPELL", playerClass: "HUNTER", mechanics: ["SECRET"] }
    ]);
    const tracker = new SecretTracker(attackDatabase);
    tracker.enterSecret("10");
    tracker.beginAction("friendly-attack-opponent-hero");
    tracker.endAction();

    expect(tracker.getSlots()[0].candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        cardId: "VAN_EX1_289",
        status: "excluded",
        exclusionReason: "hero-attacked-without-trigger"
      }),
      expect.objectContaining({
        cardId: "VAN_EX1_610",
        status: "excluded",
        exclusionReason: "hero-attacked-without-trigger"
      })
    ]));
  });

  it("does not exclude other candidates when any existing secret triggers during the action", () => {
    const tracker = new SecretTracker(database);
    tracker.setOpponentClass("法师");
    tracker.enterSecret("10");
    tracker.enterSecret("11");
    tracker.beginAction("friendly-spell");
    tracker.leaveSecret("10");
    tracker.endAction();

    expect(tracker.getSlots()[0].candidates).toContainEqual(expect.objectContaining({
      cardId: "EX1_287",
      status: "possible"
    }));
  });
});
