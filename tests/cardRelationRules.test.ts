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

  it("matches only eligible deck minions", () => {
    expect(areCardDetailsRelated(recruiter, twoCostMinion, "deck")).toBe(true);
    expect(areCardDetailsRelated(recruiter, threeCostMinion, "deck")).toBe(false);
    expect(areCardDetailsRelated(recruiter, twoCostSpell, "deck")).toBe(false);
    expect(areCardDetailsRelated(recruiter, twoCostMinion, "hand")).toBe(false);
  });
});
