import { describe, expect, it } from "vitest";
import { parsePublicTrackerState } from "../src/renderer/runtimeValidation";
import {
  projectTrackerState,
  type TrackerStateCapability
} from "../src/main/trackerStateProjection";
import { createPublicTrackerState } from "./fixtures/publicTrackerState";

function createStateWithEveryLargeBranch() {
  const state = createPublicTrackerState({
    status: "watching",
    gameActive: true,
    deck: [{ name: "火球术", count: 2, remaining: 1, drawn: 1, played: 0 }],
    opponentPlayed: [{ name: "寒冰箭", count: 1, remaining: 0, drawn: 0, played: 1 }],
    events: [{ id: "event-1", at: "2026-10-04T00:00:00.000Z", kind: "draw", player: "friendly" }],
    summary: { totalCards: 2, remainingCards: 1, drawnCards: 1, opponentPlayedCount: 1 },
    boardAttack: { friendly: 6, opponent: 9 },
    heroHealthLimit: { friendly: 35, opponent: 42 },
    smartCounters: [
      { id: "dragon-count", side: "friendly", label: "龙牌", value: 3, target: 5 },
      { id: "spell-count", side: "opponent", label: "法术", value: 2 }
    ],
    arena: {
      status: "drafting",
      currentChoices: [{ name: "烈焰风暴", count: 1, score: 91 }],
      picks: [{
        slot: 1,
        chosen: { name: "火球术", count: 1 },
        offered: [{ name: "火球术", count: 1 }],
        at: "2026-10-04T00:00:00.000Z"
      }],
      deck: Array.from({ length: 29 }, (_, index) => ({ name: `牌${index + 1}`, count: 1 })),
      draftCount: 29,
      unresolvedCount: 1,
      pendingRedraftChoices: [{ name: "奥术飞弹", count: 1 }]
    }
  });
  return {
    ...state,
    cardTracking: {
      ...state.cardTracking,
      opponent: {
        ...state.cardTracking.opponent,
        current: {
          ...state.cardTracking.opponent.current,
          secret: {
            status: "known" as const,
            knownCount: 1,
            totalCount: 1,
            cards: [{ cardKey: "id:secret", cardId: "SECRET_01", name: "爆炸陷阱", count: 1 }]
          }
        },
        used: {
          totalCount: 1,
          truncated: false,
          items: [{
            id: "used-1", sequence: 1, entityId: "used-entity", confidence: "confirmed" as const
          }]
        }
      },
      opponentSecretSlots: [{
        entityId: "secret-entity",
        candidates: [{ cardId: "SECRET_01", name: "爆炸陷阱", status: "possible" as const }]
      }],
      detailsByCardKey: {
        "id:secret": { dbfId: 1, name: "爆炸陷阱", isSpell: true, relatedCards: [] },
        "id:unrelated": { dbfId: 2, name: "不应给小窗", isSpell: true, relatedCards: [] }
      },
      contextDetailsBySideAndCardKey: {
        friendly: { "id:unrelated": { playedSpellsThisGameCount: 1 } },
        opponent: { "id:secret": { playedSpellsThisGameCount: 1 } }
      }
    }
  };
}

describe("audit regression: auxiliary state projection", () => {
  it.each<[TrackerStateCapability, readonly string[]]>([
    ["board-attack", ["boardAttack"]],
    ["friendly-attack", ["boardAttack"]],
    ["opponent-attack", ["boardAttack"]],
    ["friendly-health", ["heroHealthLimit"]],
    ["opponent-health", ["heroHealthLimit"]],
    ["smart-counter", ["smartCounters"]],
    ["arena-choice", ["arena"]],
    ["secret", ["cardTracking"]]
  ])("keeps only %s data while preserving the validated state shell", (capability, expectedFields) => {
    const state = createStateWithEveryLargeBranch();
    expect(parsePublicTrackerState(state)).toEqual(state);
    const projected = projectTrackerState(capability, state);

    expect(parsePublicTrackerState(projected)).toEqual(projected);
    expect(projected.gameActive).toBe(true);
    expect(Object.keys(projected)).toEqual(expect.arrayContaining(["status", "gameActive", ...expectedFields]));
    expect(projected.deck).toEqual([]);
    expect(projected.opponentPlayed).toEqual([]);
    expect(projected.events).toEqual([]);
    expect(projected).not.toHaveProperty("opponentHand");
    expect(projected).not.toHaveProperty("matchFlow");
    expect(projected).not.toHaveProperty("globalEffects");
    expect(projected).not.toHaveProperty("deckIdentity");
    expect(projected.cardTracking.friendly.used.items).toEqual([]);
    expect(projected.cardTracking.opponent.used.items).toEqual([]);
  });

  it("audit regression: secret projection keeps candidates but drops unrelated lifecycle and context trees", () => {
    const projected = projectTrackerState("secret", createStateWithEveryLargeBranch());

    expect(projected.cardTracking.opponentSecretSlots).toHaveLength(1);
    expect(projected.cardTracking.opponent.current.secret.cards).toEqual([
      { cardKey: "id:secret", cardId: "SECRET_01", name: "爆炸陷阱", count: 1 }
    ]);
    expect(projected.cardTracking.detailsByCardKey).toEqual({
      "id:secret": { dbfId: 1, name: "爆炸陷阱", isSpell: true, relatedCards: [] }
    });
    expect(projected.cardTracking.contextDetailsBySideAndCardKey).toEqual({
      friendly: {}, opponent: { "id:secret": { playedSpellsThisGameCount: 1 } }
    });
  });

  it("audit regression: arena projection keeps the real deck count while dropping picks and redraft history", () => {
    const projected = projectTrackerState("arena-choice", createStateWithEveryLargeBranch());

    expect(projected.arena).toMatchObject({
      status: "drafting",
      currentChoices: [{ name: "烈焰风暴", count: 1, score: 91 }],
      draftCount: 29,
      unresolvedCount: 1
    });
    expect(projected.arena?.deck).toHaveLength(29);
    expect(projected.arena?.deck[0]).toEqual({ name: "牌1", count: 1 });
    expect(projected.arena?.picks).toEqual([]);
    expect(projected.arena?.pendingRedraftChoices).toBeUndefined();
  });

  it("audit regression: a smart-counter window receives only its own counter", () => {
    const projected = projectTrackerState("smart-counter:dragon-count", createStateWithEveryLargeBranch());

    expect(parsePublicTrackerState(projected)).toEqual(projected);
    expect(projected.smartCounters).toEqual([
      { id: "dragon-count", side: "friendly", label: "龙牌", value: 3, target: 5 }
    ]);
  });

  it("leaves full, friendly, and opponent routes untouched until their renderers have dedicated projections", () => {
    const state = createStateWithEveryLargeBranch();

    for (const capability of ["full", "friendly", "opponent"] as const) {
      expect(projectTrackerState(capability, state)).toBe(state);
    }
  });
});
