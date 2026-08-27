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

  it("does not combine a deck action and cost/type conditions from different sentences", () => {
    expect(inferCardCandidateSelectors({
      dbfId: 5,
      name: "跨句反例",
      text: "从你的牌库中抽一张牌。你的随从法力值消耗小于或等于（2）点。"
    })).toEqual([]);
  });

  it("requires an action, cost, and card type in the same deck sentence", () => {
    expect(inferCardCandidateSelectors({
      dbfId: 6,
      name: "缺费用",
      text: "从你的牌库中召唤一个随从。"
    })).toEqual([]);
    expect(inferCardCandidateSelectors({
      dbfId: 7,
      name: "缺类型",
      text: "从你的牌库中召唤一个法力值消耗为（2）点的卡牌。"
    })).toEqual([]);
    expect(inferCardCandidateSelectors({
      dbfId: 8,
      name: "缺动作",
      text: "从你的牌库中，法力值消耗为（2）点的随从。"
    })).toEqual([]);
  });

  it("matches only eligible deck minions", () => {
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
