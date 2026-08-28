import { describe, expect, it, vi } from "vitest";
import {
  createSynchronousActionLock,
  selectVisibleNotice,
  shouldRequestCardLibrary
} from "../src/renderer/frontendStability";
import { parsePublicTrackerState, parseTrackerSettings } from "../src/renderer/runtimeValidation";
import { createPublicTrackerState } from "./fixtures/publicTrackerState";

describe("frontend stability helpers", () => {
  it("shows initialization errors before live errors and notices", () => {
    expect(selectVisibleNotice("初始化失败", "实时失败", "普通提示")).toEqual({ message: "初始化失败", role: "alert" });
  });

  it("shows live errors before ordinary notices", () => {
    expect(selectVisibleNotice(undefined, "实时失败", "普通提示")).toEqual({ message: "实时失败", role: "alert" });
  });

  it("does not request for an unchanged debounced card query", () => {
    expect(shouldRequestCardLibrary(
      { query: "火", page: 1, pageSize: 48 },
      { query: "火", page: 1, pageSize: 48 }
    )).toBe(false);
  });

  it("locks an action synchronously before React can rerender", async () => {
    let release!: () => void;
    const task = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }))
      .mockResolvedValue(undefined);
    const lock = createSynchronousActionLock();
    const first = lock.run(task);
    const second = lock.run(task);
    expect(task).toHaveBeenCalledOnce();
    expect(second).toBeUndefined();
    release();
    await first;
    await lock.run(task);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed tracker state at the renderer boundary", () => {
    expect(() => parsePublicTrackerState({ status: "watching", deck: "bad" })).toThrow(/状态数据无效/);
  });

  it("accepts the minimum valid tracker state", () => {
    const state = createPublicTrackerState();
    expect(parsePublicTrackerState(state)).toEqual(state);
  });

  it("accepts independent hero health-limit values and rejects malformed limits", () => {
    const state = createPublicTrackerState();

    expect(parsePublicTrackerState({ ...state, heroHealthLimit: { friendly: 30 } }).heroHealthLimit)
      .toEqual({ friendly: 30 });
    expect(parsePublicTrackerState({ ...state, heroHealthLimit: { opponent: 42 } }).heroHealthLimit)
      .toEqual({ opponent: 42 });
    expect(() => parsePublicTrackerState({ ...state, heroHealthLimit: { friendly: -1 } }))
      .toThrow(/英雄血量上限数据无效/);
    expect(() => parsePublicTrackerState({ ...state, heroHealthLimit: { opponent: "30" } }))
      .toThrow(/英雄血量上限数据无效/);
  });

  it("accepts extensible smart-counter ids and scoped rule output", () => {
    const state = createPublicTrackerState({
      smartCounters: [{
        id: "friendly-current-turn-spells",
        ruleId: "friendly-current-turn-spells",
        side: "friendly",
        label: "本回合法术",
        value: 2,
        target: 3,
        scope: "current-turn"
      }]
    });

    expect(parsePublicTrackerState(state).smartCounters).toEqual(state.smartCounters);
    expect(() => parsePublicTrackerState({
      ...state,
      smartCounters: [{ ...state.smartCounters![0], id: "../../unsafe" }]
    })).toThrow(/智能卡牌计数数据无效/);
  });

  it("validates supplied global-effect data", () => {
    const base = createPublicTrackerState();
    expect(parsePublicTrackerState(base)).toEqual(base);
    expect(() => parsePublicTrackerState({ ...base, globalEffects: "bad" })).toThrow(/全局影响数据无效/);
    expect(() => parsePublicTrackerState({ ...base, opponentGlobalEffects: [{ name: "失败", count: 0 }] }))
      .toThrow(/全局影响数据无效/);
    expect(parsePublicTrackerState({ ...base, globalEffects: [{ name: "全场效果", count: 1 }] }).globalEffects)
      .toEqual([{ name: "全场效果", count: 1 }]);
  });

  it("accepts valid relation selectors in public card details", () => {
    const base = createPublicTrackerState();
    const details = {
      dbfId: 1,
      name: "关系来源牌",
      isSpell: false,
      relatedCards: [],
      relationSelectors: [
        {
          source: "deck",
          cardTypes: ["随从"],
          racesAny: ["野兽"],
          spellSchoolsAny: ["自然"],
          mechanicsAny: ["突袭"],
          mechanicsAll: ["战吼"],
          raritiesAny: ["RARE"],
          manaCost: { min: 0, max: 2, exact: 1, oneOf: [1] },
          attack: { min: 0, max: 2 },
          health: { exact: 1 }
        },
        { source: "visible", cardTypes: ["法术"] }
      ]
    };
    const state = {
      ...base,
      cardTracking: {
        ...base.cardTracking!,
        detailsByCardKey: { "id:1": details }
      }
    };

    expect(parsePublicTrackerState(state).cardTracking?.detailsByCardKey["id:1"])
      .toEqual(details);
  });

  it.each([
    { source: "deck" },
    { source: "graveyard" },
    { source: "deck", cardTypes: [] },
    { source: "deck", cardTypes: "随从" },
    { source: "deck", cardTypes: ["随从", 1] },
    { source: "visible", racesAny: [null] },
    { source: "deck", spellSchoolsAny: "自然" },
    { source: "deck", mechanicsAny: {} },
    { source: "visible", mechanicsAll: {} },
    { source: "deck", mechanicsAll: [] },
    { source: "deck", raritiesAny: [1] },
    { source: "deck", manaCost: [] },
    { source: "deck", manaCost: {} },
    { source: "deck", manaCost: { min: -1 } },
    { source: "deck", manaCost: { max: Number.POSITIVE_INFINITY } },
    { source: "deck", manaCost: { exact: "0" } },
    { source: "deck", manaCost: { oneOf: [0, -1] } },
    { source: "deck", attack: { min: Number.NaN } },
    { source: "deck", health: { oneOf: "1" } }
  ])("rejects malformed relation selector %#", (selector) => {
    const base = createPublicTrackerState();
    const state = {
      ...base,
      cardTracking: {
        ...base.cardTracking!,
        detailsByCardKey: {
          "id:1": {
            dbfId: 1,
            name: "关系来源牌",
            isSpell: false,
            relatedCards: [],
            relationSelectors: [selector]
          }
        }
      }
    };

    expect(() => parsePublicTrackerState(state)).toThrow(/卡牌生命周期数据无效/);
  });

  it("rejects a non-array relationSelectors payload before renderer matching", () => {
    const base = createPublicTrackerState();
    const malformedDetails = {
      dbfId: 1,
      name: "关系来源牌",
      isSpell: false,
      relatedCards: [],
      relationSelectors: { source: "deck" }
    };

    expect(() => parsePublicTrackerState({
      ...base,
      globalEffects: [{ name: "全场效果", count: 1, details: malformedDetails }]
    })).toThrow(/全局影响数据无效/);
  });

  it("accepts public match counters and rejects malformed or negative values", () => {
    const base = createPublicTrackerState({
      status: "watching",
      deck: [],
      events: [],
      summary: { totalCards: 0, remainingCards: 0, drawnCards: 0, opponentPlayedCount: 0 }
    });
    const matchCounters = {
      friendly: { nextFatigueDamage: 0, corpses: 6, spellsPlayed: 8 },
      opponent: { nextFatigueDamage: 3 }
    };

    expect(parsePublicTrackerState({ ...base, matchCounters }).matchCounters).toEqual(matchCounters);
    expect(() => parsePublicTrackerState({
      ...base,
      matchCounters: { friendly: { corpses: -1 }, opponent: {} }
    })).toThrow(/本局公开计数数据无效/);
    expect(() => parsePublicTrackerState({
      ...base,
      matchCounters: { friendly: { spellsPlayed: 1.5 }, opponent: {} }
    })).toThrow(/本局公开计数数据无效/);
    expect(() => parsePublicTrackerState({
      ...base,
      matchCounters: { friendly: {}, opponent: { nextFatigueDamage: "3" } }
    })).toThrow(/本局公开计数数据无效/);
    expect(() => parsePublicTrackerState({
      ...base,
      matchCounters: { friendly: {} }
    })).toThrow(/本局公开计数数据无效/);
  });

  it("validates tracker settings from the trusted API boundary", () => {
    const settings = {
      ladder: { friendlyDeckTracker: true, opponentDeckTracker: false },
      arena: { friendlyDeckTracker: false, opponentDeckTracker: true },
      general: {
        launchAtLogin: false,
        startMinimized: true,
        showGameStatusIcon: true,
        minimizeToMenuBar: true,
        focusOnOpen: true,
        gameDetection: "automatic",
        gameLanguage: "zh-CN",
        windowMatching: "smart"
      },
      overlay: {
        enabled: true,
        showOnlyInGame: true,
        theme: "light",
        arenaHeroWinRateRanking: true,
        showFriendlyAttack: true,
        showOpponentAttack: true,
        secretPrediction: true,
        smartCardCounters: true,
        healthChange: true,
        position: "left",
        offsetX: 20,
        offsetY: 0,
        opacity: 85,
        hideInFullscreen: true
      },
      appearance: {
        theme: "dark",
        accentColor: "#3b82f6",
        fontSize: "medium",
        zoom: 100,
        animations: true,
        cardImageQuality: "high"
      },
      other: {
        autoUpdateCards: true,
        updateFrequency: "daily",
        matchRetentionDays: 90,
        notifyUpdates: true,
        notifyAnnouncements: true,
        verboseLogs: false
      }
    };
    expect(parseTrackerSettings(settings)).toEqual(settings);
    expect(() => parseTrackerSettings({ ...settings, arena: { ...settings.arena, opponentDeckTracker: "yes" } }))
      .toThrow(/设置数据无效/);
    expect(() => parseTrackerSettings({ ...settings, general: { ...settings.general, focusOnOpen: "yes" } }))
      .toThrow(/设置数据无效/);
    expect(() => parseTrackerSettings({ ...settings, overlay: { ...settings.overlay, opacity: 101 } }))
      .toThrow(/设置数据无效/);
    expect(() => parseTrackerSettings({ ...settings, appearance: { ...settings.appearance, accentColor: "#ffffff" } }))
      .toThrow(/设置数据无效/);
  });

  it.each([
    ["status", { status: "ranked", draftCount: 24, unresolvedCount: 6, currentChoices: [], picks: [], deck: [{ name: "已确认牌", count: 24 }] }],
    ["missing unresolved count", { status: "complete", draftCount: 24, currentChoices: [], picks: [], deck: [{ name: "已确认牌", count: 24 }] }],
    ["negative unresolved count", { status: "complete", draftCount: 24, unresolvedCount: -1, currentChoices: [], picks: [], deck: [{ name: "已确认牌", count: 24 }] }],
    ["fractional card count", { status: "complete", draftCount: 24, unresolvedCount: 6, currentChoices: [], picks: [], deck: [{ name: "已确认牌", count: 23.5 }] }],
    ["inconsistent total", { status: "complete", draftCount: 24, unresolvedCount: 5, currentChoices: [], picks: [], deck: [{ name: "已确认牌", count: 24 }] }]
  ])("rejects malformed Arena %s", (_label, arena) => {
    const state = {
      status: "watching",
      deck: [],
      opponentPlayed: [],
      events: [],
      summary: { totalCards: 30, remainingCards: 30, drawnCards: 0, opponentPlayedCount: 0 },
      arena
    };

    expect(() => parsePublicTrackerState(state)).toThrow(/竞技场状态数据无效/);
  });

  it("accepts a pending Arena redraft state and rejects malformed pending choices", () => {
    const state = createPublicTrackerState({
      status: "watching",
      arena: {
        status: "complete",
        draftCount: 30,
        unresolvedCount: 0,
        currentChoices: [],
        picks: [],
        deck: [{ name: "上一次确认牌库", count: 30 }],
        awaitingExactDeck: true,
        pendingRedraftChoices: [{ name: "本次新选牌", count: 1, cardId: "TEST_001" }]
      }
    });

    expect(parsePublicTrackerState(state).arena).toMatchObject({
      awaitingExactDeck: true,
      pendingRedraftChoices: [{ name: "本次新选牌", count: 1 }]
    });
    expect(() => parsePublicTrackerState({
      ...state,
      arena: {
        ...state.arena!,
        pendingRedraftChoices: [{ name: "错误数量", count: 0 }]
      }
    })).toThrow(/竞技场状态数据无效/);
  });

  it.each([
    [24, 6],
    [29, 1],
    [30, 0]
  ])("accepts an Arena state with %i confirmed and %i unresolved cards", (confirmedCount, unresolvedCount) => {
    const state = createPublicTrackerState({
      status: "watching",
      arena: {
        status: "complete",
        draftCount: confirmedCount,
        unresolvedCount,
        currentChoices: [],
        picks: [],
        deck: [{ name: "已确认牌", count: confirmedCount }]
      }
    });

    expect(parsePublicTrackerState(state).arena).toMatchObject({ draftCount: confirmedCount, unresolvedCount });
  });

  it("validates optional Arena deck statistics at the renderer boundary", () => {
    const base = createPublicTrackerState({
      status: "watching",
      deck: [],
      events: [],
      summary: { totalCards: 30, remainingCards: 30, drawnCards: 0, opponentPlayedCount: 0 },
      arena: {
        status: "complete",
        draftCount: 30,
        unresolvedCount: 0,
        currentChoices: [],
        picks: [],
        deck: [{ name: "参考牌", count: 30, pickRate: 75.6, deckImpact: -9.13 }]
      }
    });

    expect(parsePublicTrackerState(base).arena?.deck[0]).toMatchObject({ pickRate: 75.6, deckImpact: -9.13 });
    expect(() => parsePublicTrackerState({
      ...base,
      arena: { ...base.arena!, deck: [{ ...base.arena!.deck[0], pickRate: Number.NaN }] }
    })).toThrow(/竞技场状态数据无效/);
    expect(() => parsePublicTrackerState({
      ...base,
      arena: { ...base.arena!, deck: [{ ...base.arena!.deck[0], pickRate: -0.01 }] }
    })).toThrow(/竞技场状态数据无效/);
    expect(() => parsePublicTrackerState({
      ...base,
      arena: { ...base.arena!, deck: [{ ...base.arena!.deck[0], pickRate: 100.01 }] }
    })).toThrow(/竞技场状态数据无效/);
    expect(() => parsePublicTrackerState({
      ...base,
      arena: {
        ...base.arena,
        currentChoices: [{ name: "候选牌", count: 1, rating: { pickRate: -0.01 } }]
      }
    })).toThrow(/竞技场状态数据无效/);
    expect(() => parsePublicTrackerState({
      ...base,
      arena: {
        ...base.arena,
        currentChoices: [{ name: "候选牌", count: 1, rating: { firestone: { pickRate: 100.01 } } }]
      }
    })).toThrow(/竞技场状态数据无效/);
    expect(() => parsePublicTrackerState({
      ...base,
      arena: { ...base.arena!, deck: [{ ...base.arena!.deck[0], deckImpact: "-9.13" }] }
    })).toThrow(/竞技场状态数据无效/);
  });
});
