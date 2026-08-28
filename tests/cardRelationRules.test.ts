import { describe, expect, it } from "vitest";
import type { CardDetails, CardInfo } from "../src/shared/cardDatabase";
import {
  areCardDetailsRelated,
  inferCardCandidateSelectors
} from "../src/shared/cardRelationRules";

function toDetails(card: CardInfo): CardDetails {
  const relationSelectors = inferCardCandidateSelectors(card);
  return {
    ...card,
    isSpell: card.cardType === "法术",
    relatedCards: [],
    ...(relationSelectors.length > 0 ? { relationSelectors } : {})
  };
}

const recruiter = toDetails({
  dbfId: 1,
  name: "血色招募者",
  text: "战吼：从你的牌库中召唤两个法力值消耗小于或等于（2）点的随从。",
  cardType: "随从",
  manaCost: 5
});
const zeroCostMinion = toDetails({ dbfId: 5, name: "零费随从", cardType: "随从", manaCost: 0 });
const twoCostMinion = toDetails({ dbfId: 2, name: "二费随从", cardType: "随从", manaCost: 2 });
const threeCostMinion = toDetails({ dbfId: 3, name: "三费随从", cardType: "随从", manaCost: 3 });
const twoCostSpell = toDetails({ dbfId: 4, name: "二费法术", cardType: "法术", manaCost: 2 });

describe("card relation rules", () => {
  it("parses Blood Recruiter's deck minion maximum-cost selector", () => {
    expect(inferCardCandidateSelectors({
      dbfId: 1,
      name: "血色招募者",
      text: "战吼：从你的牌库中召唤两个法力值消耗小于或等于（2）点的随从。"
    })).toEqual([{ source: "deck", cardTypes: ["随从"], manaCost: { max: 2 } }]);
  });

  it("parses an explicit friendly deck action with only a card-type restriction", () => {
    expect(inferCardCandidateSelectors({
      dbfId: 11,
      name: "元素盟军",
      text: "奖励：从你的牌库中抽三张法术牌。"
    })).toEqual([{ source: "deck", cardTypes: ["法术"] }]);
  });

  it("parses static attack and health restrictions on friendly deck cards", () => {
    expect(inferCardCandidateSelectors({
      dbfId: 12,
      name: "水晶学",
      text: "从你的牌库中抽两张攻击力为1的随从牌。"
    })).toEqual([{ source: "deck", cardTypes: ["随从"], attack: { exact: 1 } }]);
    expect(inferCardCandidateSelectors({
      dbfId: 13,
      name: "萨赫特的傲狮",
      text: "亡语：从你的牌库中抽两张生命值为1的随从牌。"
    })).toEqual([{ source: "deck", cardTypes: ["随从"], health: { exact: 1 } }]);
  });

  it("parses tribe and keyword restrictions on explicit friendly deck actions", () => {
    expect(inferCardCandidateSelectors({
      dbfId: 14,
      name: "船长的鹦鹉",
      text: "战吼：从你的牌库中抽一张海盗牌。"
    })).toEqual([{ source: "deck", racesAny: ["PIRATE"] }]);
    expect(inferCardCandidateSelectors({
      dbfId: 15,
      name: "城镇公告员",
      text: "战吼：从你的牌库中抽一张具有突袭的随从牌。"
    })).toEqual([{ source: "deck", cardTypes: ["随从"], mechanicsAll: ["RUSH"] }]);
  });

  it("parses multi-cost, spell-school, rarity, and keyword-OR restrictions", () => {
    expect(inferCardCandidateSelectors({
      dbfId: 16,
      name: "香甜的灵力瓜",
      text: "从你的牌库中抽取法力值消耗为（7），（8），（9）和（10）的随从牌各一张。"
    })).toEqual([{ source: "deck", cardTypes: ["随从"], manaCost: { oneOf: [7, 8, 9, 10] } }]);
    expect(inferCardCandidateSelectors({
      dbfId: 17,
      name: "派系检索",
      text: "从你的牌库中抽一张冰霜法术牌。"
    })).toEqual([{ source: "deck", cardTypes: ["法术"], spellSchoolsAny: ["冰霜"] }]);
    expect(inferCardCandidateSelectors({
      dbfId: 18,
      name: "传说检索",
      text: "从你的牌库中抽一张传说随从牌。"
    })).toEqual([{ source: "deck", cardTypes: ["随从"], raritiesAny: ["LEGENDARY"] }]);
    expect(inferCardCandidateSelectors({
      dbfId: 19,
      name: "女伯爵阿莎摩尔",
      text: "战吼：从你的牌库中抽一张突袭牌、吸血牌和亡语牌。"
    })).toEqual([{ source: "deck", mechanicsAny: ["DEATHRATTLE", "RUSH", "LIFESTEAL"] }]);
  });

  it("recognizes explicit friendly hand, play-trigger, next-card, and category-buff contexts", () => {
    const cases = [
      ["如果你的手牌中有龙牌，便获得+2生命值。", { source: "deck", racesAny: ["DRAGON"] }],
      ["每当你使用一张海盗牌后，抽一张牌。", { source: "deck", racesAny: ["PIRATE"] }],
      ["你的下一张战吼随从牌的法力值消耗减少（1）点。", { source: "deck", cardTypes: ["随从"], mechanicsAll: ["BATTLECRY"] }],
      ["使你手牌中的所有随从牌获得+1/+1。", { source: "deck", cardTypes: ["随从"] }],
      ["使你的冰霜法术牌获得法术伤害+1。", { source: "deck", cardTypes: ["法术"], spellSchoolsAny: ["冰霜"] }]
    ] as const;

    for (const [index, [text, selector]] of cases.entries()) {
      expect(inferCardCandidateSelectors({ dbfId: 30 + index, name: `友方上下文 ${index}`, text }))
        .toEqual([selector]);
    }
  });

  it("parses explicit deck-wide buffs and keeps multiple distinct selectors", () => {
    expect(inferCardCandidateSelectors({
      dbfId: 40,
      name: "哈杜伦·明翼",
      text: "战吼：使你手牌和牌库中所有奥术法术牌获得法术伤害+1。"
    })).toEqual([{ source: "deck", cardTypes: ["法术"], spellSchoolsAny: ["奥术"] }]);
    expect(inferCardCandidateSelectors({
      dbfId: 41,
      name: "双重检索",
      text: "从你的牌库中抽一张海盗牌。从你的牌库中抽一张武器牌。"
    })).toEqual([
      { source: "deck", racesAny: ["PIRATE"] },
      { source: "deck", cardTypes: ["武器"] }
    ]);
  });

  it("splits explicit same-sentence deck targets into OR selectors", () => {
    expect(inferCardCandidateSelectors({
      dbfId: 42,
      name: "团伙劫掠",
      text: "从你的牌库中抽一张海盗牌和一张武器牌。"
    })).toEqual([
      { source: "deck", racesAny: ["PIRATE"] },
      { source: "deck", cardTypes: ["武器"] }
    ]);
  });

  it("inherits an explicit friendly deck draw into an immediate keyword continuation", () => {
    expect(inferCardCandidateSelectors({
      dbfId: 49,
      name: "团伙劫掠",
      text: "从你的牌库中抽两张海盗牌。 <b>连击：</b>并抽一张 武器牌。"
    })).toEqual([
      { source: "deck", racesAny: ["PIRATE"] },
      { source: "deck", cardTypes: ["武器"] }
    ]);
  });

  it("does not inherit a deck draw rejected by the unsafe construction gate", () => {
    expect(inferCardCandidateSelectors({
      dbfId: 50,
      name: "危险续句",
      text: "如果你的牌库中没有随从牌，从你的牌库中抽一张牌。连击：并抽一张武器牌。"
    })).toEqual([]);
  });

  it("fails closed when a stated numeric restriction is not fully static and supported", () => {
    const texts = [
      "从你的牌库中抽一张法力值消耗等于你的护甲值的随从牌。",
      "从你的牌库中召唤一个攻击力小于5的随从。",
      "从你的牌库中抽一张生命值高于本回合受伤次数的随从牌。"
    ];
    for (const [index, text] of texts.entries()) {
      expect(inferCardCandidateSelectors({ dbfId: 43 + index, name: `未支持数值 ${index}`, text })).toEqual([]);
    }
  });

  it("distinguishes explicit keyword OR from keyword ALL", () => {
    expect(inferCardCandidateSelectors({
      dbfId: 47,
      name: "关键词任一",
      text: "从你的牌库中抽一张具有突袭或吸血的随从牌。"
    })).toEqual([{ source: "deck", cardTypes: ["随从"], mechanicsAny: ["RUSH", "LIFESTEAL"] }]);
    expect(inferCardCandidateSelectors({
      dbfId: 48,
      name: "关键词全部",
      text: "从你的牌库中抽一张同时具有突袭且吸血的随从牌。"
    })).toEqual([{ source: "deck", cardTypes: ["随从"], mechanicsAll: ["RUSH", "LIFESTEAL"] }]);
  });

  it("rejects broader negative and conditional deck-building clauses", () => {
    const texts = [
      "如果你的牌库中不含随从牌，则使你牌库中的所有法术牌法力值消耗减少（1）点。",
      "如果你的牌库中不存在法术牌，则使你的所有随从获得+1/+1。",
      "如果你的套牌仅包含偶数牌，则使你牌库中的所有随从牌获得+1/+1。",
      "如果你的牌库已空，使你的随从获得+2/+2。"
    ];
    for (const [index, text] of texts.entries()) {
      expect(inferCardCandidateSelectors({ dbfId: 49 + index, name: `负面构筑 ${index}`, text })).toEqual([]);
    }
  });

  it("rejects unsafe or uninformative relation text", () => {
    const texts = [
      "从你对手的牌库中抽一张随从牌。",
      "揭示双方牌库里的一张随从牌。",
      "随机获取一张野兽牌。",
      "将一张野兽牌洗入你的牌库。",
      "在本回合中，使你的英雄获得+3攻击力。",
      "从你的牌库中抽一张牌。",
      "如果你的牌库里没有法力值消耗为（2）的牌，则使你牌库里所有随从牌获得+1/+1。",
      "从你的牌库中抽取法力值消耗最低的随从牌。",
      "从你的牌库中召唤一个攻击力小于本随从攻击力的随从。"
    ];
    for (const [index, text] of texts.entries()) {
      expect(inferCardCandidateSelectors({ dbfId: 50 + index, name: `拒绝 ${index}`, text })).toEqual([]);
    }
    expect(inferCardCandidateSelectors({
      dbfId: 59,
      name: "玛克希玛·雷管",
      text: "战吼：从你的牌库中召唤一个随从，使其攻击敌方英雄，然后死亡。"
    })).toEqual([{ source: "deck", cardTypes: ["随从"] }]);
  });

  it("matches all supported selector fields, all-tribe cards, reverse deck relations, and excludes canonical self", () => {
    const source = toDetails({
      dbfId: 60,
      name: "综合检索",
      cardId: "SOURCE",
      text: "从你的牌库中抽一张法力值消耗为（2），（4）的冰霜法术牌。",
      cardType: "法术"
    });
    const target = toDetails({
      dbfId: 61,
      name: "四费冰霜法术",
      cardId: "TARGET",
      cardType: "法术",
      manaCost: 4,
      spellSchool: "冰霜"
    });
    expect(areCardDetailsRelated(source, target, "deck")).toBe(true);
    expect(areCardDetailsRelated(source, { ...target, spellSchool: "火焰" }, "deck")).toBe(false);

    const tribeSource = toDetails({ dbfId: 62, name: "野兽检索", text: "从你的牌库中抽一张野兽牌。" });
    expect(areCardDetailsRelated(tribeSource, { ...target, dbfId: 63, races: ["ALL"] }, "deck")).toBe(true);

    const buffSource = toDetails({ dbfId: 64, name: "随从增益", text: "使你牌库中的所有随从牌获得+1/+1。" });
    const minionTarget = toDetails({ dbfId: 65, name: "被增益随从", cardType: "随从" });
    expect(areCardDetailsRelated(minionTarget, buffSource, "deck")).toBe(true);

    const canonical: CardDetails = {
      ...source,
      dbfId: 66,
      cardId: "CORE_SAME",
      relatedCards: [{ dbfId: 67, name: "同一张牌", cardId: "SAME" }]
    };
    expect(areCardDetailsRelated(canonical, { ...target, dbfId: 67, cardId: "SAME" }, "deck")).toBe(false);
    expect(areCardDetailsRelated(
      { ...canonical, dbfId: 68, cardId: "CORE_VAN_SAME" },
      { ...target, dbfId: 69, cardId: "SAME" },
      "deck"
    )).toBe(false);
  });

  it("does not combine a deck action and cost/type conditions from different sentences", () => {
    expect(inferCardCandidateSelectors({
      dbfId: 5,
      name: "跨句反例",
      text: "从你的牌库中抽一张牌。你的随从法力值消耗小于或等于（2）点。"
    })).toEqual([]);
  });

  it("does not cross markup, line, or follow-up action boundaries", () => {
    const inputs = [
      "从你的牌库中抽一张牌<br>法力值消耗小于或等于（2）点的随从。",
      "从你的牌库中抽一张牌\n法力值消耗小于或等于（2）点的随从。",
      "从你的牌库中抽一张牌并使法力值消耗小于或等于（2）点的随从获得+1/+1。"
    ];

    for (const [index, text] of inputs.entries()) {
      expect(inferCardCandidateSelectors({ dbfId: 20 + index, name: `分段反例 ${index}`, text })).toEqual([]);
    }
  });

  it("requires an action and at least one deck-card restriction in the same sentence", () => {
    expect(inferCardCandidateSelectors({
      dbfId: 6,
      name: "缺费用",
      text: "从你的牌库中召唤一个随从。"
    })).toEqual([{ source: "deck", cardTypes: ["随从"] }]);
    expect(inferCardCandidateSelectors({
      dbfId: 7,
      name: "缺类型",
      text: "从你的牌库中召唤一个法力值消耗为（2）点的卡牌。"
    })).toEqual([{ source: "deck", manaCost: { exact: 2 } }]);
    expect(inferCardCandidateSelectors({
      dbfId: 8,
      name: "缺动作",
      text: "从你的牌库中，法力值消耗为（2）点的随从。"
    })).toEqual([]);
  });

  it("matches only eligible deck minions", () => {
    expect(areCardDetailsRelated(recruiter, zeroCostMinion, "deck")).toBe(true);
    expect(areCardDetailsRelated(recruiter, twoCostMinion, "deck")).toBe(true);
    expect(areCardDetailsRelated(recruiter, threeCostMinion, "deck")).toBe(false);
    expect(areCardDetailsRelated(recruiter, twoCostSpell, "deck")).toBe(false);
    expect(areCardDetailsRelated(recruiter, twoCostMinion, "hand")).toBe(false);
    expect(areCardDetailsRelated(recruiter, twoCostMinion, "board")).toBe(false);
    expect(areCardDetailsRelated(recruiter, twoCostMinion, "other")).toBe(false);
    expect(areCardDetailsRelated(recruiter, { ...twoCostMinion, manaCost: undefined }, "deck")).toBe(false);
    expect(areCardDetailsRelated(recruiter, { ...twoCostMinion, cardType: undefined }, "deck")).toBe(false);
  });

  it("keeps fixed related-card matching for non-deck groups", () => {
    const active = toDetails({
      dbfId: 9,
      name: "固定关联来源",
      cardType: "随从"
    });
    const target = toDetails({
      dbfId: 10,
      name: "固定关联目标",
      cardType: "随从"
    });
    const fixedActive: CardDetails = {
      ...active,
      relatedCards: [{ dbfId: target.dbfId, name: target.name }]
    };

    expect(areCardDetailsRelated(fixedActive, target, "board")).toBe(true);
    expect(areCardDetailsRelated(fixedActive, target, "other")).toBe(true);
  });
});
