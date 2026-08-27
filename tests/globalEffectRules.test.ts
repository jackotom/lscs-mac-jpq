import { describe, expect, it } from "vitest";
import auditedCardData from "../fixtures/card-data/global-effects-zhCN.json";
import type { CardInfo } from "../src/shared/cardDatabase";
import {
  canonicalGlobalEffectCardId,
  inferGlobalEffectRule
} from "../src/shared/globalEffectRules";

const fixtures = {
  GIL_692: { dbfId: 1, cardId: "GIL_692", name: "吉恩·格雷迈恩", text: "对战开始时：如果你的套牌中只有法力值消耗为偶数的牌，你的初始英雄技能的法力值消耗为（1）点。", mechanics: ["START_OF_GAME_KEYWORD"] },
  CAP_406: { dbfId: 2, cardId: "CAP_406", name: "暗金教主谋", text: "战吼：在本局对战中，每当你召唤一个卧底小鬼，使其获得+2/+2。", mechanics: ["BATTLECRY"] },
  MEND_800: { dbfId: 3, cardId: "MEND_800", name: "莽撞的战场军官", text: "突袭。亡语：在本局对战中，使你的白银之手新兵获得+1攻击力。", mechanics: ["DEATHRATTLE"] },
  RLK_591: { dbfId: 4, cardId: "RLK_591", name: "白骨领主霜语", text: "亡语：在本局对战的剩余时间内，每回合中你的第一张牌法力值消耗为（0）点。", mechanics: ["DEATHRATTLE"] },
  BAR_539: { dbfId: 5, cardId: "BAR_539", name: "超凡之盟", text: "将你的法力水晶重置为零个。将你手牌和牌库中的牌的法力值消耗变为（1）点。", cardType: "法术" },
  AV_145: { dbfId: 6, cardId: "AV_145", name: "加尔范上尉", text: "战吼：在本局对战中，如果你获得的护甲值大于或等于15点，便获得+3/+3和冲锋。", mechanics: ["BATTLECRY"] },
  CAP_806: { dbfId: 7, cardId: "CAP_806", name: "雷斯·范盖斯特", text: "战吼：复活在本局对战中你的复生过的随从，并使其攻击随机敌方随从。", mechanics: ["BATTLECRY"] },
  NORMAL_AURA: { dbfId: 8, cardId: "NORMAL_AURA", name: "普通光环", text: "你的其他随从获得+1攻击力。", mechanics: ["AURA"] },
  MEND_801: { dbfId: 9, cardId: "MEND_801", name: "坚定的救援者", text: "圣盾。在本随从失去圣盾后，在本局对战中，使你的白银之手新兵获得+1生命值。", mechanics: ["DIVINE_SHIELD", "TRIGGER_VISUAL"] },
  ETC_382: { dbfId: 10, cardId: "ETC_382", name: "自由之魂", text: "战吼，亡语：在本局对战中，你的英雄技能多获得1点护甲值。", mechanics: ["BATTLECRY", "DEATHRATTLE"] },
  MEND_501: { dbfId: 11, cardId: "MEND_501", name: "魔力行者", text: "战吼：在本局对战中，你的魔网牌法力值消耗减少（1）点。亡语：随机获取一张魔网牌。", mechanics: ["BATTLECRY", "DEATHRATTLE"] }
} satisfies Record<string, CardInfo>;

function cardFixture(cardId: keyof typeof fixtures, mechanic?: string): CardInfo {
  const card = fixtures[cardId];
  return mechanic ? { ...card, mechanics: [mechanic] } : card;
}

const EXPECTED_GLOBAL_EFFECT_IDS = [
  "BAR_546", "BOT_238", "BT_020", "BT_026", "CAP_406", "CATA_216", "CATA_553", "CFM_020",
  "CS3_035", "DEEP_020", "DEEP_036", "DINO_421", "DMF_254", "DRG_319", "EDR_000", "EDR_845",
  "EDR_895", "ETC_330", "ETC_371", "ETC_382", "ETC_385", "GDB_121", "GDB_234", "GDB_434",
  "GDB_721", "GDB_726", "GIL_692", "GIL_826", "ICC_833", "JAIL_122", "JAIL_384", "JAIL_397",
  "JAIL_430", "JAIL_504", "JAIL_509", "JAIL_800", "JAIL_860", "KAR_096", "MAW_024", "MEND_304",
  "MEND_501", "MEND_503", "MEND_506", "MEND_800", "MEND_801", "MEND_803", "REV_314", "REV_921",
  "RLK_214", "RLK_591", "RLK_706", "SC_002", "SC_753", "SC_754", "SC_764", "SW_448",
  "TIME_020", "TLC_257", "TTN_811", "TTN_842", "TTN_850", "ULD_168", "VAC_426", "WW_367",
  "YOG_530"
].sort();

describe("global effect rules", () => {
  it.each([
    ["GIL_692", "START_OF_GAME_KEYWORD", "start-of-game"],
    ["CAP_406", "BATTLECRY", "play"],
    ["MEND_800", "DEATHRATTLE", "deathrattle"],
    ["RLK_591", "DEATHRATTLE", "deathrattle"],
    ["BAR_539", "", "play"]
  ] as const)("classifies %s", (cardId, mechanic, activation) => {
    const card = cardFixture(cardId, mechanic);
    expect(inferGlobalEffectRule(card)?.activations).toContain(activation);
  });

  it.each(["AV_145", "CAP_806", "NORMAL_AURA"] as const)("rejects non-persistent %s", (cardId) => {
    expect(inferGlobalEffectRule(cardFixture(cardId))).toBeUndefined();
  });

  it("classifies audited conditional aliases as triggered source effects", () => {
    expect(inferGlobalEffectRule(cardFixture("MEND_801"))?.activations).toEqual(["triggered"]);
    expect(canonicalGlobalEffectCardId("EDR_895E")).toBe("EDR_895");
    expect(canonicalGlobalEffectCardId("MEND_801E")).toBe("MEND_801");
    expect(canonicalGlobalEffectCardId("SC_755E")).toBe("SC_753");
  });

  it("uses both activations only when the persistent clause belongs to battlecry and deathrattle", () => {
    expect(inferGlobalEffectRule(cardFixture("ETC_382"))?.activations).toEqual(["play", "deathrattle"]);
    expect(inferGlobalEffectRule(cardFixture("MEND_501"))?.activations).toEqual(["play"]);
  });

  it("preserves legacy structural effects as structural", () => {
    expect(inferGlobalEffectRule(cardFixture("BAR_539"))?.category).toBe("structural");
  });

  it("recognizes the audited 65-card strict global-effect corpus", () => {
    const auditedCards = auditedCardData as readonly CardInfo[];
    const actual = auditedCards
      .filter((card) => inferGlobalEffectRule(card)?.category === "persistent")
      .map((card) => canonicalGlobalEffectCardId(card.cardId ?? card.id ?? ""))
      .sort();
    expect(actual).toEqual(EXPECTED_GLOBAL_EFFECT_IDS);
  });
});
