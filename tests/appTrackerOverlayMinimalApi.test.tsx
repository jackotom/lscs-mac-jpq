import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyCardTracking, createPublicTrackerState } from "./fixtures/publicTrackerState";
import { openWorkbench } from "./helpers/openWorkbench";

afterEach(() => {
  window.history.replaceState({}, "", "/");
  delete window.hearthstoneTracker;
});

describe("tracker overlay preload boundary", () => {
  it("keeps the opponent overlay mounted when prediction candidates are disabled", async () => {
    const cardTracking = structuredClone(createEmptyCardTracking("game-1"));
    const opponentCurrent = cardTracking.opponent.current as unknown as Record<string, unknown>;
    opponentCurrent.secret = {
      status: "partial",
      knownCount: 0,
      totalCount: 1,
      cards: []
    };
    (cardTracking as unknown as Record<string, unknown>).opponentSecretSlots = [{
      entityId: "secret-1",
      candidates: [{ cardId: "SECRET_1", name: "候选奥秘", status: "possible" }]
    }];
    const state = createPublicTrackerState({
      status: "watching",
      gameActive: true,
      cardTracking
    });
    window.history.replaceState({}, "", "/?opponent-overlay=1&show-secret-prediction=0");
    window.hearthstoneTracker = {
      getState: vi.fn(async () => state),
      onUpdate: vi.fn(() => () => undefined),
      getOpponentOverlayCollapsed: vi.fn(async () => false)
    } as unknown as typeof window.hearthstoneTracker;
    const { default: App } = await import("../src/renderer/App.js");

    render(<App />);

    expect(await screen.findByLabelText("对手记牌器置顶小窗")).toBeInTheDocument();
    expect(screen.queryByText("候选奥秘")).not.toBeInTheDocument();
  });

  it("renders with the minimal tracker-overlay API", async () => {
    const state = createPublicTrackerState({
      status: "watching",
      gameActive: false,
      deckName: "测试牌库",
      deck: [],
      events: [],
      summary: { totalCards: 0, remainingCards: 0, drawnCards: 0, opponentPlayedCount: 0 },
      lastUpdated: new Date().toISOString()
    });
    window.history.replaceState({}, "", "/?overlay=1");
    window.hearthstoneTracker = {
      getState: vi.fn(async () => state),
      onUpdate: vi.fn(() => () => undefined),
      showCardPreview: vi.fn(async () => undefined),
      hideCardPreview: vi.fn(async () => undefined),
      onCardPreviewPinnedChange: vi.fn(() => () => undefined)
    } as unknown as typeof window.hearthstoneTracker;
    const { default: App } = await import("../src/renderer/App.js");

    render(<App />);

    expect(await screen.findByLabelText("炉石记牌器置顶小窗")).toBeInTheDocument();
    expect(window.hearthstoneTracker?.getState).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "关闭小窗" })).not.toBeInTheDocument();
  });

  it("closes through the dedicated friendly-overlay capability without a toggle API", async () => {
    const state = createPublicTrackerState({
      status: "watching",
      deck: [],
      events: [],
      summary: { totalCards: 0, remainingCards: 0, drawnCards: 0, opponentPlayedCount: 0 }
    });
    const closeFriendlyOverlay = vi.fn(async () => undefined);
    window.history.replaceState({}, "", "/?overlay=1");
    window.hearthstoneTracker = {
      getState: vi.fn(async () => state),
      onUpdate: vi.fn(() => () => undefined),
      closeFriendlyOverlay
    } as unknown as typeof window.hearthstoneTracker;
    const { default: App } = await import("../src/renderer/App.js");

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "关闭小窗" }));

    expect(closeFriendlyOverlay).toHaveBeenCalledOnce();
  });

  it("clears a rejected live-state error after the next valid update", async () => {
    const validState = createPublicTrackerState({
      status: "watching",
      deck: [],
      events: [],
      summary: { totalCards: 0, remainingCards: 0, drawnCards: 0, opponentPlayedCount: 0 }
    });
    let emit!: (state: unknown) => void;
    window.history.replaceState({}, "", "/?overlay=1");
    window.hearthstoneTracker = {
      getState: vi.fn(async () => validState),
      onUpdate: vi.fn((callback: (state: unknown) => void) => {
        emit = callback;
        return () => undefined;
      }),
      showCardPreview: vi.fn(async () => undefined),
      hideCardPreview: vi.fn(async () => undefined),
      onCardPreviewPinnedChange: vi.fn(() => () => undefined)
    } as unknown as typeof window.hearthstoneTracker;
    const { default: App } = await import("../src/renderer/App.js");

    render(<App />);
    await screen.findByLabelText("炉石记牌器置顶小窗");
    await waitFor(() => expect(screen.queryByText("正在读取记牌器状态")).not.toBeInTheDocument());

    act(() => {
      emit({
        ...validState,
        arena: {
          status: "complete",
          draftCount: 29,
          unresolvedCount: 0,
          currentChoices: [],
          picks: [],
          deck: [{ name: "只有二十九张", count: 29 }]
        }
      });
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("竞技场状态数据无效");

    act(() => emit(validState));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("renders hand and other cards from a live tracker update", async () => {
    const initialState = createPublicTrackerState({
      status: "watching",
      deckName: "法术法师",
      autoMatchedDeckId: "spell-mage",
      deck: [],
      events: [],
      summary: { totalCards: 30, remainingCards: 25, drawnCards: 5, opponentPlayedCount: 0 }
    });
    let emit!: (state: unknown) => void;
    window.history.replaceState({}, "", "/?overlay=1");
    window.hearthstoneTracker = {
      getState: vi.fn(async () => initialState),
      onUpdate: vi.fn((callback: (state: unknown) => void) => {
        emit = callback;
        return () => undefined;
      }),
      showCardPreview: vi.fn(async () => undefined),
      hideCardPreview: vi.fn(async () => undefined),
      onCardPreviewPinnedChange: vi.fn(() => () => undefined)
    } as unknown as typeof window.hearthstoneTracker;
    const { default: App } = await import("../src/renderer/App.js");

    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: /手牌.*0/ })).toBeInTheDocument());

    const updatedTracking = createEmptyCardTracking("live-update");
    const friendlyCurrent = updatedTracking.friendly.current as unknown as Record<string, unknown>;
    friendlyCurrent.hand = {
      status: "known",
      knownCount: 3,
      totalCount: 3,
      cards: [
        { cardKey: "流水档案管理员", name: "流水档案管理员", count: 2 },
        { cardKey: "霜崖十字绣", name: "霜崖十字绣", count: 1 }
      ]
    };
    friendlyCurrent.graveyard = {
      status: "known",
      knownCount: 1,
      totalCount: 1,
      cards: [{ cardKey: "烈焰风暴", name: "烈焰风暴", count: 1 }]
    };
    act(() => emit({
      ...initialState,
      cardTracking: updatedTracking
    }));

    expect(await screen.findByRole("button", { name: /手牌.*3/ })).toHaveTextContent("手牌 (3)");
    expect(screen.getByText("流水档案管理员")).toBeInTheDocument();
    expect(screen.getByText("霜崖十字绣")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /墓地.*1/ }));
    expect(screen.getByText("烈焰风暴")).toBeInTheDocument();
  });

  it("does not render an unresolved tracker row as a real card in the main deck", async () => {
    const state = createPublicTrackerState({
      status: "watching",
      deckName: "竞技场牌库",
      deck: [
        { name: "真实竞技场牌", count: 24, remaining: 24, drawn: 0, played: 0 },
        { name: "未解析竞技场牌", count: 6, remaining: 6, drawn: 0, played: 0, unresolved: true }
      ],
      events: [],
      summary: { totalCards: 30, remainingCards: 30, drawnCards: 0, opponentPlayedCount: 0 },
      arena: {
        status: "complete",
        draftCount: 24,
        unresolvedCount: 6,
        currentChoices: [],
        picks: [],
        deck: [{ name: "真实竞技场牌", count: 24 }]
      }
    });
    window.hearthstoneTracker = {
      discoverLogs: vi.fn(async () => []),
      getState: vi.fn(async () => state),
      onUpdate: vi.fn(() => () => undefined)
    } as unknown as typeof window.hearthstoneTracker;
    const { default: App } = await import("../src/renderer/App.js");

    render(<App />);

    await openWorkbench();
    expect(await screen.findAllByText("真实竞技场牌")).not.toHaveLength(0);
    expect(screen.queryByText("未解析竞技场牌")).not.toBeInTheDocument();
  });

  it("renders an unresolved inserted-card placeholder in a constructed deck", async () => {
    const state = createPublicTrackerState({
      status: "watching",
      gameActive: true,
      deckName: "测试套牌",
      autoMatchedDeckId: "constructed-deck",
      deck: [
        { name: "原始牌", count: 1, remaining: 1, drawn: 0, played: 0 },
        { name: "未知塞入牌", count: 2, remaining: 2, drawn: 0, played: 0, unresolved: true }
      ],
      events: [],
      summary: { totalCards: 3, remainingCards: 3, drawnCards: 0, opponentPlayedCount: 0 }
    });
    window.hearthstoneTracker = {
      discoverLogs: vi.fn(async () => []),
      getState: vi.fn(async () => state),
      onUpdate: vi.fn(() => () => undefined)
    } as unknown as typeof window.hearthstoneTracker;
    const { default: App } = await import("../src/renderer/App.js");

    render(<App />);

    await openWorkbench();
    expect(await screen.findByText("未知塞入牌 ×2")).toBeInTheDocument();
  });
});
