import { describe, expect, it } from "vitest";
import { parseArenaInsightsResult, parseCollectionInsightsResult, parsePublicTrackerState } from "../src/renderer/runtimeValidation";
import {
  createEmptyCardTracking,
  createPublicTrackerState
} from "./fixtures/publicTrackerState";

type CompleteTrackerState = ReturnType<typeof createPublicTrackerState>;

function overwriteZone(
  state: CompleteTrackerState,
  player: "friendly" | "opponent",
  zone: string,
  value: unknown
): void {
  const current = state.cardTracking[player].current as unknown as Record<string, unknown>;
  current[zone] = value;
}

function overwriteHistory(
  state: CompleteTrackerState,
  player: "friendly" | "opponent",
  group: "burned" | "used",
  value: unknown
): void {
  const tracking = state.cardTracking[player] as unknown as Record<string, unknown>;
  tracking[group] = value;
}

function overwriteSecretSlots(state: CompleteTrackerState, value: unknown): void {
  const tracking = state.cardTracking as unknown as Record<string, unknown>;
  tracking.opponentSecretSlots = value;
}

function overwriteDetailsByCardKey(state: CompleteTrackerState, value: unknown): void {
  const tracking = state.cardTracking as unknown as Record<string, unknown>;
  tracking.detailsByCardKey = value;
}

function overwriteContextDetails(state: CompleteTrackerState, value: unknown): void {
  const tracking = state.cardTracking as unknown as Record<string, unknown>;
  tracking.contextDetailsBySideAndCardKey = value;
}

function createDetailsWithOutcomeSections() {
  return {
    dbfId: 315,
    name: "火球术",
    isSpell: true,
    relatedCards: [],
    cardOutcomeSections: [{
      key: "actual",
      title: "本次实际施放",
      emptyText: "无结果",
      cards: [{
        key: "result-1",
        card: { dbfId: 1001, name: "奥术飞弹" }
      }]
    }]
  };
}

describe("card tracking runtime validation", () => {
  it("accepts a Casual constructed-screen mode", () => {
    const state = createPublicTrackerState({ constructedScreenMode: "casual" });

    expect(parsePublicTrackerState(state).constructedScreenMode).toBe("casual");
  });

  it("rejects an unknown constructed-screen mode", () => {
    const state = createPublicTrackerState() as unknown as Record<string, unknown>;
    state.constructedScreenMode = "practice";

    expect(() => parsePublicTrackerState(state)).toThrow(/状态数据无效/);
  });

  it("accepts structured local insight snapshots and rejects invalid counters", () => {
    const arena = {
      status: "ok", source: "本机竞技场档案", updatedAt: "2026-08-22T12:00:00.000Z", runs: [], highWinDecks: [], mulliganStats: []
    };
    expect(parseArenaInsightsResult(arena)).toEqual(arena);
    expect(() => parseArenaInsightsResult({ ...arena, runs: [{ id: "bad", wins: -1 }] })).toThrow(/竞技场档案数据无效/);

    const collection = {
      status: "ok", source: "import", updatedAt: "2026-08-22T12:00:00.000Z", cards: [], packs: [], pity: [], cardBacks: [], heroSkins: [], coins: []
    };
    expect(parseCollectionInsightsResult(collection)).toEqual(collection);
    expect(() => parseCollectionInsightsResult({ ...collection, pity: [{ set: "标准包", packsSinceLegendary: -1, partial: true }] })).toThrow(/收藏数据无效/);
  });

  it("rejects untrusted insight sources and inconsistent derived arena facts", () => {
    const run = { id: "run", startedAt: "2026-08-22T12:00:00.000Z", wins: 10, losses: 1, deck: [], rewards: [], mulligan: [], recordedMatchIds: [] };
    const arena = { status: "ok", source: "本机竞技场档案", updatedAt: "2026-08-22T12:00:00.000Z", runs: [run], highWinDecks: [run], mulliganStats: [{ cardName: "火球术", drawnBeforeMulligan: 1, kept: 1, inHandAfterMulligan: 1, wins: 1, winRate: 100 }] };
    expect(() => parseArenaInsightsResult({ ...arena, source: "公开数据" })).toThrow(/竞技场档案数据无效/);
    expect(() => parseArenaInsightsResult({ ...arena, highWinDecks: [{ ...run, wins: 9 }] })).toThrow(/竞技场档案数据无效/);
    expect(() => parseArenaInsightsResult({ ...arena, mulliganStats: [{ cardName: "火球术", kept: 1, wins: 1, winRate: 100 }] })).toThrow(/竞技场档案数据无效/);
    const collection = { status: "ok", source: "manual", updatedAt: "2026-08-22T12:00:00.000Z", cards: [{ cardId: "A", normal: 1, golden: 0 }], packs: [], pity: [], cardBacks: [], heroSkins: [], coins: [] };
    expect(() => parseCollectionInsightsResult(collection)).not.toThrow();
  });

  it("accepts confirmed opponent hand details but rejects malformed timer data", () => {
    const valid = createPublicTrackerState() as unknown as Record<string, unknown>;
    valid.opponentHand = [{
      entityId: "64",
      name: "火球术",
      drawnTurn: 3,
      created: false,
      forged: true,
      buffs: ["+1 法术伤害"]
    }];
    valid.turnTimer = {
      turn: 4,
      activeSide: "opponent",
      startedAt: "2026-08-22T12:00:00.000Z",
      durationSeconds: 75
    };
    expect(() => parsePublicTrackerState(valid)).not.toThrow();

    const invalid = structuredClone(valid);
    (invalid.turnTimer as Record<string, unknown>).durationSeconds = -1;
    expect(() => parsePublicTrackerState(invalid)).toThrow(/对手手牌或回合计时数据无效/);

    const invalidBuff = structuredClone(valid);
    ((invalidBuff.opponentHand as Array<Record<string, unknown>>)[0]!.buffs as unknown[]) = [42];
    expect(() => parsePublicTrackerState(invalidBuff)).toThrow(/对手手牌或回合计时数据无效/);
  });

  it("accepts numeric drawn and deck impacts but rejects non-numeric values", () => {
    const valid = createPublicTrackerState() as unknown as Record<string, unknown>;
    valid.arena = {
      status: "drafting",
      draftCount: 0,
      unresolvedCount: 30,
      currentChoices: [{
        name: "测试牌",
        count: 1,
        rating: {
          drawnImpact: 25,
          deckImpact: 16.67,
          firestone: { drawnWinrate: 75, drawnWins: 3, drawnSampleSize: 4, drawnImpact: 25 }
        }
      }],
      picks: [],
      deck: []
    };
    expect(() => parsePublicTrackerState(valid)).not.toThrow();

    const invalidTopLevel = structuredClone(valid);
    ((invalidTopLevel.arena as { currentChoices: Array<{ rating: Record<string, unknown> }> })
      .currentChoices[0]!.rating.drawnImpact) = "25";
    expect(() => parsePublicTrackerState(invalidTopLevel)).toThrow(/状态数据无效/);

    const invalidFirestone = structuredClone(valid);
    ((invalidFirestone.arena as { currentChoices: Array<{ rating: { firestone: Record<string, unknown> } }> })
      .currentChoices[0]!.rating.firestone.drawnWins) = "3";
    expect(() => parsePublicTrackerState(invalidFirestone)).toThrow(/状态数据无效/);
  });

  it("rejects malformed deck and event rows", () => {
    const malformedDeck = createPublicTrackerState() as unknown as Record<string, unknown>;
    malformedDeck.deck = [null];
    expect(() => parsePublicTrackerState(malformedDeck)).toThrow(/状态数据无效/);

    const malformedEvent = createPublicTrackerState() as unknown as Record<string, unknown>;
    malformedEvent.events = [null];
    expect(() => parsePublicTrackerState(malformedEvent)).toThrow(/状态数据无效/);
  });

  it("rejects negative summary counts", () => {
    const state = createPublicTrackerState();
    (state.summary as unknown as Record<string, unknown>).drawnCards = -1;

    expect(() => parsePublicTrackerState(state)).toThrow(/状态数据无效/);
  });

  it("allows future top-level fields while validating known fields", () => {
    const state = createPublicTrackerState() as unknown as Record<string, unknown>;
    state.futureField = { enabled: true };

    expect(() => parsePublicTrackerState(state)).not.toThrow();
  });

  it("accepts the published deck identity and keeps legacy states compatible", () => {
    const published = createPublicTrackerState({
      deckIdentity: {
        status: "confirmed",
        source: "decks-log",
        deckId: "deck-1",
        observedDistinctCards: 0,
        candidateCount: 1,
        bestScore: 0,
        scoreLead: 0
      }
    });

    expect(parsePublicTrackerState(published).deckIdentity).toEqual(published.deckIdentity);

    const legacy = createPublicTrackerState() as unknown as Record<string, unknown>;
    delete legacy.deckIdentity;
    expect(() => parsePublicTrackerState(legacy)).not.toThrow();
  });

  it.each([
    ["unknown status", { status: "done" }],
    ["unknown source", { source: "manual" }],
    ["negative candidate count", { candidateCount: -1 }],
    ["fractional observation count", { observedDistinctCards: 1.5 }],
    ["non-finite score", { bestScore: Number.NaN }],
    ["empty deck id", { deckId: " " }]
  ])("rejects a malformed deck identity: %s", (_label, override) => {
    const state = createPublicTrackerState() as unknown as Record<string, unknown>;
    state.deckIdentity = {
      status: "waiting",
      source: "inferred",
      observedDistinctCards: 0,
      candidateCount: 0,
      bestScore: 0,
      scoreLead: 0,
      ...override
    };

    expect(() => parsePublicTrackerState(state)).toThrow(/套牌识别状态数据无效/);
  });

  it("rejects states without required card tracking", () => {
    const state = createPublicTrackerState() as unknown as Record<string, unknown>;
    delete state.cardTracking;

    expect(() => parsePublicTrackerState(state)).toThrow(/卡牌生命周期数据无效/);
  });

  it("rejects an explicit undefined card tracking override at compile time and runtime", () => {
    expect(() => {
      // @ts-expect-error 正常工厂禁止显式传入 undefined。
      createPublicTrackerState({ cardTracking: undefined });
    }).toThrow(/cardTracking/);
  });

  it("rejects empty game keys and invalid card tracking overrides in the normal factory", () => {
    expect(() => createPublicTrackerState({
      cardTracking: createEmptyCardTracking(" ")
    })).toThrow(/cardTracking/);

    const invalidTracking = structuredClone(createEmptyCardTracking("game-1"));
    const friendlyCurrent = invalidTracking.friendly.current as unknown as Record<string, unknown>;
    friendlyCurrent.hand = {
      status: "known",
      knownCount: 0,
      totalCount: 1,
      cards: []
    };
    expect(() => createPublicTrackerState({ cardTracking: invalidTracking })).toThrow(/cardTracking/);
  });

  it("creates independent nested arrays and objects for every normal state", () => {
    const first = createPublicTrackerState();
    const second = createPublicTrackerState();

    expect(first.cardTracking).not.toBe(second.cardTracking);
    expect(first.cardTracking.friendly.current.deck.cards)
      .not.toBe(second.cardTracking.friendly.current.deck.cards);
    expect(first.cardTracking.opponent.used.items)
      .not.toBe(second.cardTracking.opponent.used.items);
    expect(first.cardTracking.opponentSecretSlots)
      .not.toBe(second.cardTracking.opponentSecretSlots);
  });

  it("clones a supplied card tracking override instead of sharing it", () => {
    const supplied = createEmptyCardTracking("game-1");
    const first = createPublicTrackerState({ cardTracking: supplied });
    const second = createPublicTrackerState({ cardTracking: supplied });

    expect(first.cardTracking).not.toBe(supplied);
    expect(first.cardTracking).not.toBe(second.cardTracking);
    expect(first.cardTracking.friendly.used.items)
      .not.toBe(second.cardTracking.friendly.used.items);
  });

  it("deeply clones all caller-owned state overrides", () => {
    const overrides = {
      deck: [{
        name: "火球术",
        count: 1,
        remaining: 1,
        drawn: 0,
        played: 0
      }],
      events: [{
        id: "event-1",
        at: "2026-07-29T12:00:00.000Z",
        kind: "draw" as const,
        player: "friendly" as const,
        cardName: "火球术"
      }],
      summary: {
        totalCards: 1,
        remainingCards: 1,
        drawnCards: 0,
        opponentPlayedCount: 0
      }
    };

    const state = createPublicTrackerState(overrides);
    expect(state.deck).not.toBe(overrides.deck);
    expect(state.deck[0]).not.toBe(overrides.deck[0]);
    expect(state.events).not.toBe(overrides.events);
    expect(state.events[0]).not.toBe(overrides.events[0]);
    expect(state.summary).not.toBe(overrides.summary);
  });

  it("accepts inserted-deck summaries but rejects duplicate source groups", () => {
    const state = createPublicTrackerState();
    (state.cardTracking as unknown as Record<string, unknown>).deckInsertions = {
      friendly: {
        groups: [{ sourceEntityId: "219", sourceName: "天空主母创建", remainingCount: 9 }],
        placements: [
          { entityId: "300", position: "top", cardName: "星界碎片" },
          { entityId: "301", position: "bottom" }
        ]
      },
      opponent: { groups: [], placements: [] }
    };
    expect(() => parsePublicTrackerState(state)).not.toThrow();

    const duplicate = structuredClone(state);
    const friendly = duplicate.cardTracking.deckInsertions!.friendly as unknown as {
      groups: unknown[];
    };
    friendly.groups.push({
      sourceEntityId: "219",
      sourceName: "重复来源",
      remainingCount: 1
    });
    expect(() => parsePublicTrackerState(duplicate)).toThrow(/卡牌生命周期数据无效/);
  });

  it("accepts side-scoped spell history counts without copying them into shared card details", () => {
    const state = createPublicTrackerState();
    overwriteContextDetails(state, {
      friendly: {
        "id:toy_378": {
          playedSpellsThisGame: [
            { dbfId: 1, name: "奥术飞弹", manaCost: 1 },
            { dbfId: 2, name: "火球术", manaCost: 4 }
          ],
          playedSpellsThisGameCount: 7,
          playedSpellsThisGameIncomplete: true
        }
      },
      opponent: {}
    });

    expect(parsePublicTrackerState(state).cardTracking.contextDetailsBySideAndCardKey.friendly)
      .toHaveProperty("id:toy_378");
    expect(state.cardTracking.detailsByCardKey).not.toHaveProperty("id:toy_378");
  });

  it("rejects malformed side-scoped spell history instead of inventing missing cards", () => {
    const tooSmall = createPublicTrackerState();
    overwriteContextDetails(tooSmall, {
      friendly: {
        "id:toy_378": {
          playedSpellsThisGame: [
            { dbfId: 1, name: "奥术飞弹" },
            { dbfId: 2, name: "火球术" }
          ],
          playedSpellsThisGameCount: 1
        }
      },
      opponent: {}
    });
    expect(() => parsePublicTrackerState(tooSmall)).toThrow(/卡牌生命周期数据无效/);

    const unknownField = createPublicTrackerState();
    overwriteContextDetails(unknownField, {
      friendly: {
        "id:toy_378": {
          playedSpellsThisGame: [],
          fabricatedCards: ["不存在的法术"]
        }
      },
      opponent: {}
    });
    expect(() => parsePublicTrackerState(unknownField)).toThrow(/卡牌生命周期数据无效/);

    const contradictory = createPublicTrackerState();
    overwriteContextDetails(contradictory, {
      friendly: {
        "id:toy_378": {
          playedSpellsThisGame: [{ dbfId: 1, name: "奥术飞弹" }],
          playedSpellsThisGameCount: 1,
          playedSpellsThisGameIncomplete: true
        }
      },
      opponent: {}
    });
    expect(() => parsePublicTrackerState(contradictory)).toThrow(/卡牌生命周期数据无效/);
  });

  it("accepts a logged game-context total and rejects impossible totals", () => {
    const valid = createPublicTrackerState();
    overwriteContextDetails(valid, {
      friendly: {},
      opponent: {
        "id:rev_514": {
          gameContextSections: [{
            key: "kelthuzad-resurrection-count",
            title: "会复活",
            emptyText: "数量来自对局日志",
            cards: [],
            totalCount: 5
          }]
        }
      }
    });
    expect(() => parsePublicTrackerState(valid)).not.toThrow();

    const invalid = structuredClone(valid);
    const section = invalid.cardTracking.contextDetailsBySideAndCardKey.opponent["id:rev_514"]!
      .gameContextSections![0] as unknown as Record<string, unknown>;
    section.totalCount = -1;
    expect(() => parsePublicTrackerState(invalid)).toThrow(/卡牌生命周期数据无效/);
  });

  it("rejects known groups whose total differs from the known count", () => {
    const state = createPublicTrackerState();
    overwriteZone(state, "friendly", "hand", {
      status: "known",
      knownCount: 0,
      totalCount: 1,
      cards: []
    });

    expect(() => parsePublicTrackerState(state)).toThrow(/卡牌生命周期数据无效/);
  });

  it("rejects partial groups without a larger total", () => {
    const state = createPublicTrackerState();
    overwriteZone(state, "opponent", "hand", {
      status: "partial",
      knownCount: 0,
      cards: []
    });

    expect(() => parsePublicTrackerState(state)).toThrow(/卡牌生命周期数据无效/);
  });

  it("rejects unknown groups that claim a total", () => {
    const state = createPublicTrackerState();
    overwriteZone(state, "opponent", "deck", {
      status: "unknown",
      knownCount: 0,
      totalCount: 3,
      cards: []
    });

    expect(() => parsePublicTrackerState(state)).toThrow(/卡牌生命周期数据无效/);
  });

  it("rejects a known count that differs from the sum of known cards", () => {
    const state = createPublicTrackerState();
    overwriteZone(state, "friendly", "deck", {
      status: "known",
      knownCount: 2,
      totalCount: 2,
      cards: [{ cardKey: "CS2_029", cardId: "CS2_029", name: "火球术", count: 1 }]
    });

    expect(() => parsePublicTrackerState(state)).toThrow(/卡牌生命周期数据无效/);
  });

  it("rejects duplicate history ids and inconsistent truncation", () => {
    const duplicate = createPublicTrackerState();
    overwriteHistory(duplicate, "friendly", "used", {
      totalCount: 2,
      truncated: false,
      items: [
        { id: "same", sequence: 1, entityId: "1", confidence: "confirmed" },
        { id: "same", sequence: 2, entityId: "2", confidence: "confirmed" }
      ]
    });
    expect(() => parsePublicTrackerState(duplicate)).toThrow(/卡牌生命周期数据无效/);

    const truncated = createPublicTrackerState();
    overwriteHistory(truncated, "friendly", "used", {
      totalCount: 2,
      truncated: false,
      items: [{ id: "use-1", sequence: 1, entityId: "1", confidence: "confirmed" }]
    });
    expect(() => parsePublicTrackerState(truncated)).toThrow(/卡牌生命周期数据无效/);
  });

  it("rejects history sequences that are not strictly decreasing", () => {
    const ascending = createPublicTrackerState();
    overwriteHistory(ascending, "friendly", "used", {
      totalCount: 2,
      truncated: false,
      items: [
        { id: "use-1", sequence: 1, entityId: "1", confidence: "confirmed" },
        { id: "use-2", sequence: 2, entityId: "2", confidence: "confirmed" }
      ]
    });
    expect(() => parsePublicTrackerState(ascending)).toThrow(/卡牌生命周期数据无效/);

    const equal = createPublicTrackerState();
    overwriteHistory(equal, "friendly", "used", {
      totalCount: 2,
      truncated: false,
      items: [
        { id: "use-2", sequence: 2, entityId: "2", confidence: "confirmed" },
        { id: "use-1", sequence: 2, entityId: "1", confidence: "confirmed" }
      ]
    });
    expect(() => parsePublicTrackerState(equal)).toThrow(/卡牌生命周期数据无效/);
  });

  it("rejects secret counts derived from candidate cards instead of slots", () => {
    const state = createPublicTrackerState();
    overwriteZone(state, "opponent", "secret", {
      status: "known",
      knownCount: 5,
      totalCount: 5,
      cards: [
        { cardKey: "SECRET_1", name: "候选1", count: 1 },
        { cardKey: "SECRET_2", name: "候选2", count: 1 },
        { cardKey: "SECRET_3", name: "候选3", count: 1 },
        { cardKey: "SECRET_4", name: "候选4", count: 1 },
        { cardKey: "SECRET_5", name: "候选5", count: 1 }
      ]
    });
    overwriteSecretSlots(state, [{
      entityId: "slot-1",
      candidates: [
        { cardId: "SECRET_1", name: "候选1", status: "possible" },
        { cardId: "SECRET_2", name: "候选2", status: "possible" },
        { cardId: "SECRET_3", name: "候选3", status: "possible" },
        { cardId: "SECRET_4", name: "候选4", status: "possible" },
        { cardId: "SECRET_5", name: "候选5", status: "possible" }
      ]
    }]);

    expect(() => parsePublicTrackerState(state)).toThrow(/卡牌生命周期数据无效/);
  });

  it("rejects actual outcome sections stored in base card details", () => {
    const indexedDetails = createPublicTrackerState();
    overwriteDetailsByCardKey(indexedDetails, {
      CS2_029: createDetailsWithOutcomeSections()
    });
    expect(() => parsePublicTrackerState(indexedDetails)).toThrow(/卡牌生命周期数据无效/);

    const secretDetails = createPublicTrackerState();
    overwriteZone(secretDetails, "opponent", "secret", {
      status: "partial",
      knownCount: 0,
      totalCount: 1,
      cards: []
    });
    overwriteSecretSlots(secretDetails, [{
      entityId: "slot-1",
      candidates: [{
        cardId: "EX1_287",
        name: "法术反制",
        status: "possible",
        details: createDetailsWithOutcomeSections()
      }]
    }]);
    expect(() => parsePublicTrackerState(secretDetails)).toThrow(/卡牌生命周期数据无效/);
  });

  it("accepts actual outcome sections on history items", () => {
    const state = createPublicTrackerState();
    overwriteHistory(state, "friendly", "used", {
      totalCount: 1,
      truncated: false,
      items: [{
        id: "use-1",
        sequence: 1,
        entityId: "1",
        confidence: "confirmed",
        outcomeSections: createDetailsWithOutcomeSections().cardOutcomeSections
      }]
    });

    expect(parsePublicTrackerState(state)).toBe(state);
  });

  it("rejects outcome trees deeper than 16 levels", () => {
    const state = createPublicTrackerState();
    let node: Record<string, unknown> = {
      key: "leaf",
      card: { dbfId: 1, name: "叶节点" }
    };
    for (let depth = 0; depth < 16; depth += 1) {
      node = {
        key: `depth-${depth}`,
        card: { dbfId: depth + 2, name: `第${depth + 1}层` },
        children: [node]
      };
    }
    overwriteHistory(state, "friendly", "used", {
      totalCount: 1,
      truncated: false,
      items: [{
        id: "use-1",
        sequence: 1,
        entityId: "1",
        confidence: "confirmed",
        outcomeSections: [{
          key: "actual",
          title: "本次实际施放",
          emptyText: "无结果",
          cards: [node]
        }]
      }]
    });

    expect(() => parsePublicTrackerState(state)).toThrow(/卡牌生命周期数据无效/);
  });

  it("rejects outcome trees with more than 512 nodes", () => {
    const state = createPublicTrackerState();
    const cards = Array.from({ length: 513 }, (_, index) => ({
      key: `node-${index}`,
      card: { dbfId: index + 1, name: `结果${index + 1}` }
    }));
    overwriteHistory(state, "friendly", "used", {
      totalCount: 1,
      truncated: false,
      items: [{
        id: "use-1",
        sequence: 1,
        entityId: "1",
        confidence: "confirmed",
        outcomeSections: [{
          key: "actual",
          title: "本次实际施放",
          emptyText: "无结果",
          cards
        }]
      }]
    });

    expect(() => parsePublicTrackerState(state)).toThrow(/卡牌生命周期数据无效/);
  });
});
