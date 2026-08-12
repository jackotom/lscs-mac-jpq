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

  it("validates supplied global-effect data", () => {
    const base = createPublicTrackerState();
    expect(parsePublicTrackerState(base)).toEqual(base);
    expect(() => parsePublicTrackerState({ ...base, globalEffects: "bad" })).toThrow(/全局影响数据无效/);
    expect(() => parsePublicTrackerState({ ...base, opponentGlobalEffects: [{ name: "失败", count: 0 }] }))
      .toThrow(/全局影响数据无效/);
    expect(parsePublicTrackerState({ ...base, globalEffects: [{ name: "全场效果", count: 1 }] }).globalEffects)
      .toEqual([{ name: "全场效果", count: 1 }]);
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
