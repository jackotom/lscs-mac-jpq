import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OverlayPanel } from "../src/renderer/components/OverlayPanel";
import { toOverlayPanelViewModel } from "../src/renderer/overlayView";
import { parsePublicTrackerState } from "../src/renderer/runtimeValidation";
import type {
  OverlayCardTrackingView,
  OverlayPanelViewModel,
  OverlaySecretSlot
} from "../src/renderer/types";
import type { ArenaCardChoice, DeckCard, PublicTrackerState } from "../src/shared/types";
import { createPublicTrackerState } from "./fixtures/publicTrackerState";

function zone(
  key: keyof OverlayCardTrackingView["current"],
  count: number,
  name?: string
) {
  return {
    key,
    status: "known" as const,
    knownCount: count,
    totalCount: count,
    countLabel: String(count),
    cards: name ? [{ id: `${key}-1`, name, count: 1 }] : []
  };
}

function tracking(
  gameKey = "game-1",
  secretSlots: readonly OverlaySecretSlot[] = []
): OverlayCardTrackingView {
  return {
    status: "ready",
    gameKey,
    side: "friendly",
    current: {
      deck: zone("deck", 1, "牌库牌"),
      hand: zone("hand", 1, "手牌牌"),
      play: zone("play", 0),
      secret: zone("secret", secretSlots.length),
      graveyard: zone("graveyard", 1, "墓地牌"),
      removed: zone("removed", 0)
    },
    burned: {
      key: "burned",
      totalCount: 1,
      countLabel: "1",
      truncated: false,
      items: [{ id: "burn-1", sequence: 1, turn: 7, displayName: "烧毁牌", hidden: false, confidence: "inferred" }]
    },
    used: {
      key: "used",
      totalCount: 1,
      countLabel: "1",
      truncated: false,
      items: [{ id: "use-1", sequence: 2, turn: 8, displayName: "已使用牌", hidden: false, confidence: "confirmed" }]
    },
    secretSlots: [...secretSlots]
  };
}

function view(
  overrides: Partial<OverlayPanelViewModel> = {},
  cardTracking: OverlayCardTrackingView = tracking()
): OverlayPanelViewModel {
  return {
    cardTracking,
    summary: { totalCards: 30, remainingCards: 23, drawnCards: 7 },
    deckIdentity: { name: "测试套牌", status: "automatic", detail: "已自动识别当前对局" },
    remainingDeck: [],
    recentDraws: [],
    status: { tone: "tracking", label: "监听中", detail: "同步中", updatedAtLabel: "刚刚" },
    ...overrides
  };
}

describe("standard tracker overlay", () => {
  afterEach(() => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
    vi.unstubAllGlobals();
  });

  it("uses compact candidate copy without claiming that the deck is loaded", () => {
    const { container } = render(<OverlayPanel view={view({
      deckIdentity: {
        name: "还不能确定是哪套很长的套牌名称",
        compactName: "还不能确定",
        status: "candidates",
        source: "inferred",
        candidateCount: 2,
        detail: "可能是 2 套；继续对局后会自动确认。",
        compactDetail: "2 套可能"
      }
    })} />);

    expect(screen.getByText("还不能确定")).toBeInTheDocument();
    expect(screen.getByText("2 套可能")).toBeInTheDocument();
    expect(screen.queryByText("还不能确定是哪套很长的套牌名称")).not.toBeInTheDocument();
    expect(container.querySelector(".overlay-deck-identity-compact svg")).toHaveAttribute(
      "class",
      expect.stringContaining("clock")
    );
    expect(container.querySelector(".overlay-deck-name")).toHaveAttribute(
      "title",
      expect.stringContaining("识别中")
    );
    expect(container.querySelector(".overlay-deck-name")).not.toHaveAttribute(
      "title",
      expect.stringContaining("已加载")
    );
  });

  it("uses lifecycle groups without an old other group", () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    const { container } = render(<OverlayPanel view={view()} />);

    expect(container.querySelector(".card-tracking-layout")).toHaveAttribute("data-layout-mode", "tall");
    expect(container.querySelector('[data-group-key="deck"]')).toHaveAttribute("data-expanded", "true");
    expect(container.querySelector('[data-group-key="hand"]')).toHaveAttribute("data-expanded", "true");
    expect(screen.queryByText("其他")).not.toBeInTheDocument();
  });

  it("shows inserted deck groups as two-line counts while keeping ordinary deck cards", () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    const lifecycle = {
      ...tracking(),
      current: {
        ...tracking().current,
        deck: {
          ...tracking().current.deck,
          knownCount: 6,
          totalCount: 6,
          countLabel: "6",
          cards: [
            { id: "deck-normal", name: "普通牌", count: 1 },
            { id: "deck-generated", name: "星界碎片", count: 5 }
          ]
        }
      },
      deckInsertions: {
        groups: [{ sourceEntityId: "219", sourceName: "天空主母创建", remainingCount: 10 }],
        placements: [
          { entityId: "300", position: "top" as const, cardName: "真实置顶牌" },
          { entityId: "301", position: "bottom" as const }
        ]
      }
    };
    const preview = render(<OverlayPanel view={view({}, lifecycle)} />);

    const generated = screen.getByText("天空主母创建").closest(".overlay-deck-insertion-group");
    expect(generated).not.toBeNull();
    expect(generated?.children).toHaveLength(2);
    expect(generated).toHaveTextContent("10张卡牌");
    expect(generated).not.toHaveTextContent("星界碎片");
    expect(screen.getByText("普通牌")).toBeInTheDocument();
    expect(screen.getByText("星界碎片")).toBeInTheDocument();
    expect(screen.getByLabelText("牌库位置记录")).toHaveTextContent("置顶：真实置顶牌");
    expect(screen.getByLabelText("牌库位置记录")).toHaveTextContent("置底：未知卡牌");

    preview.rerender(<OverlayPanel view={view({}, {
      ...lifecycle,
      deckInsertions: {
        groups: [{ sourceEntityId: "219", sourceName: "天空主母创建", remainingCount: 9 }],
        placements: []
      }
    })} />);

    expect(screen.getByText("9张卡牌")).toBeInTheDocument();
    expect(screen.queryByLabelText("牌库位置记录")).not.toBeInTheDocument();
    expect(screen.getByText("普通牌")).toBeInTheDocument();
    expect(screen.getByText("星界碎片")).toBeInTheDocument();
  });

  it("keeps exactly one group open on each short page", () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 200 });
    const { container } = render(<OverlayPanel view={view()} />);

    expect(container.querySelectorAll('[data-expanded="true"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    expect(container.querySelector(".card-tracking-layout")).toHaveAttribute("data-tracking-page", "history");
    expect(container.querySelectorAll('[data-expanded="true"]')).toHaveLength(1);
  });

  it("auto-opens only the first secret while preserving later user choices", () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 200 });
    const firstSecret: OverlaySecretSlot = {
      id: "secret-1",
      label: "? 1",
      candidates: [{ id: "EX1_287", name: "法术反制", status: "possible" }]
    };
    const preview = render(<OverlayPanel view={view()} />);

    preview.rerender(<OverlayPanel view={view({}, tracking("game-1", [firstSecret]))} />);
    expect(preview.container.querySelector('[data-group-key="secret"]')).toHaveAttribute("data-expanded", "true");

    fireEvent.click(screen.getByRole("button", { name: /手牌.*1/ }));
    preview.rerender(<OverlayPanel view={view({}, tracking("game-1", [
      firstSecret,
      { ...firstSecret, id: "secret-2" }
    ]))} />);
    expect(preview.container.querySelector('[data-group-key="hand"]')).toHaveAttribute("data-expanded", "true");

    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    preview.rerender(<OverlayPanel view={view({}, tracking("game-1", [
      firstSecret,
      { ...firstSecret, id: "secret-2" },
      { ...firstSecret, id: "secret-3" }
    ]))} />);
    expect(preview.container.querySelector(".card-tracking-layout")).toHaveAttribute("data-tracking-page", "history");
  });

  it("resets user selection for a new game key", () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 200 });
    const preview = render(<OverlayPanel view={view({}, tracking("game-1"))} />);
    fireEvent.click(screen.getByRole("button", { name: "历史" }));

    preview.rerender(<OverlayPanel view={view({}, tracking("game-2"))} />);

    expect(preview.container.querySelector(".card-tracking-layout")).toHaveAttribute("data-tracking-page", "current");
    expect(preview.container.querySelector('[data-group-key="deck"]')).toHaveAttribute("data-expanded", "true");
  });

  it("keeps the latest user group through short and tall layout changes", () => {
    let notifyResize: ResizeObserverCallback | undefined;
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    const preview = render(<OverlayPanel view={view()} />);

    fireEvent.click(screen.getByRole("button", { name: /墓地.*1/ }));
    act(() => {
      notifyResize?.([{ contentRect: { height: 200 } } as ResizeObserverEntry], {} as ResizeObserver);
    });
    expect(preview.container.querySelector(".card-tracking-layout")).toHaveAttribute("data-layout-mode", "short");
    expect(preview.container.querySelector('[data-group-key="graveyard"]')).toHaveAttribute("data-expanded", "true");

    act(() => {
      notifyResize?.([{ contentRect: { height: 900 } } as ResizeObserverEntry], {} as ResizeObserver);
    });
    expect(preview.container.querySelector(".card-tracking-layout")).toHaveAttribute("data-layout-mode", "tall");
    expect(preview.container.querySelectorAll('[data-expanded="true"]')).toHaveLength(1);
    expect(preview.container.querySelector('[data-group-key="graveyard"]')).toHaveAttribute("data-expanded", "true");
  });

  it("shows lifecycle history on the history page", () => {
    render(<OverlayPanel view={view()} />);

    fireEvent.click(screen.getByRole("button", { name: "历史" }));

    expect(screen.getByText("烧毁牌")).toBeInTheDocument();
    expect(screen.getByText("第7回合")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /已使用.*1/ })).toBeInTheDocument();
  });

  it("shows the compact trusted match pulse without exceeding one row", () => {
    render(<OverlayPanel view={view({
      matchPulse: {
        turn: 7,
        activeSide: "friendly",
        fullLabel: "第7回合 · 我方行动 · 法力5/7",
        compactLabel: "7回 · 我 · 5/7",
        actorLabel: "我方回合"
      }
    })} />);

    expect(screen.getByLabelText("当前对局进程")).toHaveTextContent("7回 · 我 · 5/7");
  });

  it("keeps global effects separate from physical card locations", () => {
    const preview = render(<OverlayPanel view={view({
      globalEffects: [{ id: "global-1", name: "全局效果", count: 1 }]
    })} />);

    expect(screen.getByRole("region", { name: "影响全局 1 张" })).toHaveTextContent("全局效果");

    preview.rerender(<OverlayPanel view={view({ globalEffects: [] })} />);
    expect(screen.queryByText("全局效果")).not.toBeInTheDocument();
  });

  it("short-circuits groups for loading, errors, and missing logs", () => {
    const preview = render(<OverlayPanel view={view()} isLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("正在读取记牌器状态");
    expect(document.querySelector("[data-group-key]")).not.toBeInTheDocument();

    preview.rerender(<OverlayPanel view={view()} loadError="读取失败测试" />);
    expect(screen.getByRole("alert")).toHaveTextContent("读取失败测试");

    preview.rerender(<OverlayPanel view={view({
      status: { tone: "offline", label: "缺少日志", detail: "缺少 Power.log", updatedAtLabel: "刚刚" }
    })} />);
    expect(screen.getByRole("status")).toHaveTextContent("先点修复日志");
    expect(document.querySelector("[data-group-key]")).not.toBeInTheDocument();
  });

  it("shows Arena deck statistics instead of lifecycle groups while drafting", () => {
    render(<OverlayPanel view={view({
      arena: {
        isChoosing: false,
        showDeckStats: true,
        statusLabel: "选牌中",
        progress: "12/30",
        confirmedCount: 12,
        unresolvedCount: 18,
        hero: "法师",
        choices: [],
        deck: [{ id: "arena-1", name: "竞技场牌", count: 1, pickRate: 82.4, deckImpact: -9.08 }],
        deckCount: 12
      }
    })} />);

    const arena = screen.getByLabelText("竞技场卡组影响");
    expect(arena).toHaveTextContent("竞技场牌");
    expect(within(arena).getByLabelText("竞技场阶段")).toHaveTextContent("选牌中 · 12/30");
    expect(screen.queryByRole("button", { name: "历史" })).not.toBeInTheDocument();
  });

  it("formats Arena rates, impact, missing values, and copies exactly", () => {
    render(<OverlayPanel view={view({
      arena: {
        isChoosing: true,
        showDeckStats: true,
        statusLabel: "选牌中",
        progress: "11/30",
        confirmedCount: 11,
        unresolvedCount: 19,
        hero: "德鲁伊",
        choices: [],
        deck: [
          { id: "arena-1", name: "高分牌", count: 2, cost: 3, pickRate: 75.6, deckImpact: 0.1 },
          { id: "arena-2", name: "低分牌", count: 1, cost: 5, pickRate: 29.74, deckImpact: -9.13 },
          { id: "arena-3", name: "空数据牌", count: 1, cost: 4 }
        ],
        deckCount: 11
      }
    })} />);

    const arena = screen.getByLabelText("竞技场卡组影响");
    expect(within(arena).getByLabelText("选取率 75.6%")).toHaveClass("is-positive");
    expect(within(arena).getByLabelText("选取率 29.7%")).toHaveClass("is-negative");
    expect(within(arena).getByLabelText("卡组影响 0.10")).toHaveClass("is-positive");
    expect(within(arena).getByLabelText("卡组影响 -9.13")).toHaveClass("is-negative");
    expect(within(arena).getAllByText("—")).toHaveLength(2);
    expect(within(arena).getByLabelText("数量 2")).toHaveTextContent("2");
  });

  it("shows persistent global effects above Arena deck stats during a live match", () => {
    render(<OverlayPanel view={view({
      globalEffects: [{
        id: "global-jail-122",
        name: "米尔牢斯·法力风暴",
        count: 1,
        details: {
          dbfId: 126353,
          cardId: "JAIL_122",
          name: "米尔牢斯·法力风暴",
          isSpell: false,
          relatedCards: []
        }
      }],
      arena: {
        isChoosing: false,
        showDeckStats: true,
        statusLabel: "牌库已生成",
        progress: "30/30",
        confirmedCount: 30,
        unresolvedCount: 0,
        hero: "牧师",
        choices: [],
        deck: [{ id: "arena-1", name: "竞技场牌", count: 1, cost: 3 }],
        deckCount: 30
      }
    })} />);

    const effect = screen.getByRole("region", { name: "影响全局 1 张" });
    expect(effect).toHaveTextContent("米尔牢斯·法力风暴");
    expect(screen.getByLabelText("竞技场卡组影响")).toBeInTheDocument();
  });

  it("renders lowercase-token Arena cards as localized rows without leaking internal ids", () => {
    const state = createPublicTrackerState({
      status: "watching",
      trackerMode: "arena",
      deck: [],
      events: [],
      summary: { totalCards: 30, remainingCards: 30, drawnCards: 0, opponentPlayedCount: 0 },
      arena: {
        status: "complete",
        currentChoices: [],
        picks: [],
        deck: [
          {
            cardId: "TIME_009t1",
            name: "侏儒光环",
            count: 15,
            deckImpact: 0.99,
            details: {
              dbfId: 119919,
              cardId: "TIME_009t1",
              name: "侏儒光环",
              manaCost: 4,
              isSpell: true,
              relatedCards: []
            }
          },
          {
            cardId: "TIME_009t2",
            name: "梅卡托克的光环",
            count: 15,
            deckImpact: 0.98,
            details: {
              dbfId: 119920,
              cardId: "TIME_009t2",
              name: "梅卡托克的光环",
              manaCost: 5,
              isSpell: true,
              relatedCards: []
            }
          }
        ],
        draftCount: 30,
        unresolvedCount: 0
      }
    });
    const overlayView = toOverlayPanelViewModel(parsePublicTrackerState(state), { maxDeckRows: 40 });

    render(<OverlayPanel view={overlayView} />);

    const arena = screen.getByLabelText("竞技场卡组影响");
    const gnomishAuraRow = within(arena).getByText("侏儒光环").closest("li");
    const mekkatorqueAuraRow = within(arena).getByText("梅卡托克的光环").closest("li");
    expect(gnomishAuraRow).not.toBeNull();
    expect(mekkatorqueAuraRow).not.toBeNull();
    expect(within(gnomishAuraRow as HTMLElement).getByLabelText("费用 4")).toBeInTheDocument();
    expect(within(gnomishAuraRow as HTMLElement).getByLabelText("选取率 —")).toBeInTheDocument();
    expect(within(gnomishAuraRow as HTMLElement).getByLabelText("卡组影响 0.99")).toBeInTheDocument();
    expect(within(mekkatorqueAuraRow as HTMLElement).getByLabelText("费用 5")).toBeInTheDocument();
    expect(within(mekkatorqueAuraRow as HTMLElement).getByLabelText("选取率 —")).toBeInTheDocument();
    expect(within(mekkatorqueAuraRow as HTMLElement).getByLabelText("卡组影响 0.98")).toBeInTheDocument();
    expect(arena).not.toHaveTextContent("TIME_009t1");
    expect(arena).not.toHaveTextContent("TIME_009t2");
    expect(within(arena).queryAllByLabelText("费用 ?")).toHaveLength(0);
  });

  it("returns the Arena deck list to the top when its first card or quantity changes", () => {
    const arenaView = (deck: NonNullable<OverlayPanelViewModel["arena"]>["deck"]) => view({
      arena: {
        isChoosing: false,
        showDeckStats: true,
        statusLabel: "重选中",
        progress: "30/30",
        confirmedCount: 30,
        unresolvedCount: 0,
        hero: "猎人",
        choices: [],
        deck,
        deckCount: deck.reduce((total, card) => total + (card.count ?? 1), 0)
      }
    });
    const originalDeck = [
      { id: "arena-1", name: "原首牌", count: 1, cost: 2 },
      { id: "arena-2", name: "原次牌", count: 1, cost: 3 }
    ];
    const preview = render(<OverlayPanel view={arenaView(originalDeck)} />);
    const list = preview.container.querySelector(".overlay-arena-stats-list");

    expect(list).toBeInstanceOf(HTMLUListElement);
    if (!(list instanceof HTMLUListElement)) {
      throw new Error("找不到竞技场牌库列表");
    }

    list.scrollTop = 48;
    preview.rerender(<OverlayPanel view={arenaView([
      { id: "arena-new", name: "新选牌", count: 1, cost: 1 },
      originalDeck[1]
    ])} />);
    expect(list.scrollTop).toBe(0);

    list.scrollTop = 48;
    preview.rerender(<OverlayPanel view={arenaView([
      { id: "arena-new", name: "新选牌", count: 2, cost: 1 },
      originalDeck[1]
    ])} />);
    expect(list.scrollTop).toBe(0);
  });

  it("keeps complete Arena card data from the first redraft frame through 35 candidates and a removal", () => {
    const confirmedDeck: DeckCard[] = Array.from({ length: 30 }, (_value, index) => ({
      name: `保留牌 ${index + 1}`,
      cardId: `KEEP_${index + 1}`,
      count: 1,
      pickRate: 50 + index / 10,
      deckImpact: index / 100,
      details: {
        dbfId: 1_000 + index,
        cardId: `KEEP_${index + 1}`,
        name: `保留牌 ${index + 1}`,
        manaCost: index % 8,
        isSpell: false,
        relatedCards: []
      }
    }));
    const overlayFor = (candidateCount: number): OverlayPanelViewModel => {
      const pendingCards: ArenaCardChoice[] = Array.from(
        { length: candidateCount - confirmedDeck.length },
        (_value, index) => ({
          name: `新选牌 ${index + 1}`,
          cardId: `NEW_${index + 1}`,
          count: 1,
          pickRate: 70 + index,
          deckImpact: 1 + index / 10,
          details: {
            dbfId: 2_000 + index,
            cardId: `NEW_${index + 1}`,
            name: `新选牌 ${index + 1}`,
            manaCost: 1 + index,
            isSpell: false,
            relatedCards: []
          },
          rating: {
            pickRate: 70 + index,
            highWinPickRateImpact: 1 + index / 10
          }
        })
      );
      const state: PublicTrackerState = createPublicTrackerState({
        status: "watching",
        trackerMode: "arena",
        deck: [],
        events: [],
        summary: { totalCards: 30, remainingCards: 30, drawnCards: 0, opponentPlayedCount: 0 },
        arena: {
          status: "redrafting",
          currentChoices: [],
          picks: [],
          deck: confirmedDeck,
          redraftPool: [...confirmedDeck, ...pendingCards],
          awaitingExactDeck: true,
          pendingRedraftChoices: pendingCards,
          draftCount: 30,
          unresolvedCount: 0
        }
      });
      return toOverlayPanelViewModel(parsePublicTrackerState(state), { maxDeckRows: 40 });
    };
    const preview = render(<OverlayPanel view={overlayFor(30)} />);

    for (const candidateCount of [30, 31, 32, 33, 34, 35, 34]) {
      const overlayView = overlayFor(candidateCount);
      preview.rerender(<OverlayPanel view={overlayView} />);

      const arena = screen.getByLabelText("竞技场卡组影响");
      expect(overlayView.arena?.deckCount).toBe(candidateCount);
      expect(within(arena).getAllByRole("listitem")).toHaveLength(candidateCount);
      const stage = within(arena).getByLabelText("竞技场阶段");
      expect(stage).toHaveTextContent(`${candidateCount}张候选 · 最终30`);
      expect(stage).toHaveAttribute("title", `重选中 · ${candidateCount}张候选 · 最终30`);
      if (candidateCount > 30) {
        expect(arena).toHaveTextContent(`新选牌 ${candidateCount - 30}`);
      } else {
        expect(arena).not.toHaveTextContent("新选牌");
      }
      expect(within(arena).queryAllByLabelText("费用 ?")).toHaveLength(0);
      expect(within(arena).queryAllByLabelText("选取率 —")).toHaveLength(0);
      expect(within(arena).queryAllByLabelText("卡组影响 —")).toHaveLength(0);

      const retainedRow = within(arena).getByText("保留牌 1").closest("li");
      expect(retainedRow).not.toBeNull();
      expect(within(retainedRow as HTMLElement).getByLabelText("费用 0")).toBeInTheDocument();
      expect(within(retainedRow as HTMLElement).getByLabelText("选取率 50.0%")).toBeInTheDocument();
      expect(within(retainedRow as HTMLElement).getByLabelText("卡组影响 0.00")).toBeInTheDocument();
    }
  });

  it("highlights lifecycle synergy on pointer hover and keyboard focus", () => {
    const base = tracking();
    const sourceDetails = {
      dbfId: 1001,
      name: "关联来源卡",
      isSpell: true,
      relatedCards: [{ dbfId: 1002, name: "关联目标卡" }]
    };
    const targetDetails = {
      dbfId: 1002,
      name: "关联目标卡",
      isSpell: false,
      relatedCards: []
    };
    const lifecycle = {
      ...base,
      current: {
        ...base.current,
        deck: {
          ...base.current.deck,
          cards: [{ id: "target", name: "关联目标卡", count: 1, details: targetDetails }]
        },
        hand: {
          ...base.current.hand,
          cards: [
            { id: "source", name: "关联来源卡", count: 1, details: sourceDetails },
            { id: "hand-target", name: "手牌关联目标卡", count: 1, details: targetDetails }
          ]
        }
      }
    } satisfies OverlayCardTrackingView;
    render(<OverlayPanel view={view({}, lifecycle)} />);

    const source = screen.getByText("关联来源卡").closest(".overlay-compact-card-row") as HTMLElement;
    const target = screen.getByText("关联目标卡").closest(".overlay-compact-card-row") as HTMLElement;
    const handTarget = screen.getByText("手牌关联目标卡").closest(".overlay-compact-card-row") as HTMLElement;
    fireEvent.mouseEnter(source);
    expect(target).toHaveClass("is-synergy-related");
    expect(target).toHaveAttribute("aria-description", "与当前卡牌有配合");
    expect(handTarget).not.toHaveClass("is-synergy-related");
    fireEvent.mouseLeave(source);
    expect(target).not.toHaveClass("is-synergy-related");

    fireEvent.focus(source);
    expect(target).toHaveClass("is-synergy-related");
    fireEvent.blur(source);
    expect(target).not.toHaveClass("is-synergy-related");
  });

  it("clears only interactions from the group being collapsed", () => {
    const base = tracking();
    const sourceDetails = {
      dbfId: 5001,
      name: "分组来源",
      isSpell: true,
      relatedCards: [{ dbfId: 5002, name: "分组目标" }]
    };
    const targetDetails = {
      dbfId: 5002,
      name: "分组目标",
      isSpell: false,
      relatedCards: []
    };
    const globalDetails = {
      dbfId: 5003,
      name: "全局分组来源",
      isSpell: true,
      relatedCards: [{ dbfId: 5002, name: "分组目标" }]
    };
    const lifecycle = {
      ...base,
      current: {
        ...base.current,
        deck: {
          ...base.current.deck,
          cards: [{ id: "group-target", name: "分组目标", count: 1, details: targetDetails }]
        },
        hand: {
          ...base.current.hand,
          cards: [{ id: "group-source", name: "分组来源", count: 1, details: sourceDetails }]
        }
      }
    } satisfies OverlayCardTrackingView;
    render(<OverlayPanel view={view({
      globalEffects: [{ id: "global-group-source", name: "全局分组来源", count: 1, details: globalDetails }]
    }, lifecycle)} />);

    const target = screen.getByText("分组目标").closest(".overlay-compact-card-row") as HTMLElement;
    const source = screen.getByText("分组来源").closest(".overlay-compact-card-row") as HTMLElement;
    fireEvent.click(source);
    expect(target).toHaveClass("is-synergy-related");

    fireEvent.click(screen.getByRole("button", { name: /场上.*0/ }));
    expect(target).toHaveClass("is-synergy-related");
    fireEvent.click(screen.getByRole("button", { name: /场上.*0/ }));
    expect(target).toHaveClass("is-synergy-related");
    fireEvent.click(screen.getByRole("button", { name: /手牌.*1/ }));
    expect(target).not.toHaveClass("is-synergy-related");

    const globalSource = screen.getByText("全局分组来源").closest(".overlay-compact-card-row") as HTMLElement;
    fireEvent.click(globalSource);
    expect(target).toHaveClass("is-synergy-related");
    fireEvent.click(screen.getByRole("button", { name: /墓地.*1/ }));
    expect(target).toHaveClass("is-synergy-related");
    fireEvent.click(screen.getByRole("button", { name: "影响全局 (1)" }));
    expect(target).not.toHaveClass("is-synergy-related");
  });

  it("keeps a clicked source selected while hover temporarily overrides it", () => {
    const base = tracking();
    const selectedTarget = {
      dbfId: 3002,
      name: "已选配合牌",
      isSpell: false,
      relatedCards: []
    };
    const hoverTarget = {
      dbfId: 3004,
      name: "悬停配合牌",
      isSpell: false,
      relatedCards: []
    };
    const selectedSource = {
      dbfId: 3001,
      name: "已选来源牌",
      isSpell: true,
      relatedCards: [{ dbfId: 3002, name: "已选配合牌" }]
    };
    const hoverSource = {
      dbfId: 3003,
      name: "全局悬停来源",
      isSpell: true,
      relatedCards: [{ dbfId: 3004, name: "悬停配合牌" }]
    };
    const lifecycle = {
      ...base,
      current: {
        ...base.current,
        deck: {
          ...base.current.deck,
          cards: [
            { id: "selected-target", name: "已选配合牌", count: 1, details: selectedTarget },
            { id: "hover-target", name: "悬停配合牌", count: 1, details: hoverTarget }
          ]
        },
        hand: {
          ...base.current.hand,
          cards: [{ id: "selected-source", name: "已选来源牌", count: 1, details: selectedSource }]
        }
      }
    } satisfies OverlayCardTrackingView;
    render(<OverlayPanel view={view({
      globalEffects: [{ id: "global-source", name: "全局悬停来源", count: 1, details: hoverSource }]
    }, lifecycle)} />);

    const source = screen.getByText("已选来源牌").closest(".overlay-compact-card-row") as HTMLElement;
    const globalSource = screen.getByText("全局悬停来源").closest(".overlay-compact-card-row") as HTMLElement;
    const selected = screen.getByText("已选配合牌").closest(".overlay-compact-card-row") as HTMLElement;
    const hovered = screen.getByText("悬停配合牌").closest(".overlay-compact-card-row") as HTMLElement;

    fireEvent.click(source);
    expect(source).toHaveAttribute("data-card-selected", "true");
    expect(selected).toHaveClass("is-synergy-related");
    expect(hovered).not.toHaveClass("is-synergy-related");

    fireEvent.mouseEnter(globalSource);
    expect(selected).not.toHaveClass("is-synergy-related");
    expect(hovered).toHaveClass("is-synergy-related");
    fireEvent.mouseLeave(source);
    expect(hovered).toHaveClass("is-synergy-related");
    fireEvent.mouseLeave(globalSource);
    expect(selected).toHaveClass("is-synergy-related");
    expect(hovered).not.toHaveClass("is-synergy-related");

    fireEvent.click(source);
    expect(source).toHaveAttribute("data-card-selected", "false");
    expect(selected).not.toHaveClass("is-synergy-related");

    fireEvent.keyDown(source, { key: "Enter" });
    expect(source).toHaveAttribute("data-card-selected", "true");
    expect(selected).toHaveClass("is-synergy-related");
    fireEvent.keyDown(source, { key: " " });
    expect(source).toHaveAttribute("data-card-selected", "false");
    expect(selected).not.toHaveClass("is-synergy-related");
  });

  it("clears selected synergy when its source is hidden, removed, or enters a new game", () => {
    const base = tracking();
    const sourceDetails = {
      dbfId: 4001,
      name: "待清理来源",
      isSpell: true,
      relatedCards: [{ dbfId: 4002, name: "待清理目标" }]
    };
    const targetDetails = {
      dbfId: 4002,
      name: "待清理目标",
      isSpell: false,
      relatedCards: []
    };
    const withSource = {
      ...base,
      current: {
        ...base.current,
        deck: {
          ...base.current.deck,
          cards: [{ id: "cleanup-target", name: "待清理目标", count: 1, details: targetDetails }]
        },
        hand: {
          ...base.current.hand,
          cards: [{ id: "cleanup-source", name: "待清理来源", count: 1, details: sourceDetails }]
        }
      }
    } satisfies OverlayCardTrackingView;
    const preview = render(<OverlayPanel view={view({}, withSource)} />);
    let source = screen.getByText("待清理来源").closest(".overlay-compact-card-row") as HTMLElement;
    let target = screen.getByText("待清理目标").closest(".overlay-compact-card-row") as HTMLElement;

    fireEvent.click(source);
    expect(target).toHaveClass("is-synergy-related");
    fireEvent.click(screen.getByRole("button", { name: /手牌.*1/ }));
    expect(target).not.toHaveClass("is-synergy-related");

    fireEvent.click(screen.getByRole("button", { name: /手牌.*1/ }));
    source = screen.getByText("待清理来源").closest(".overlay-compact-card-row") as HTMLElement;
    fireEvent.click(source);
    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    fireEvent.click(screen.getByRole("button", { name: "当前" }));
    target = screen.getByText("待清理目标").closest(".overlay-compact-card-row") as HTMLElement;
    expect(target).not.toHaveClass("is-synergy-related");

    source = screen.getByText("待清理来源").closest(".overlay-compact-card-row") as HTMLElement;
    fireEvent.click(source);
    preview.rerender(<OverlayPanel view={view({}, {
      ...withSource,
      current: {
        ...withSource.current,
        hand: { ...withSource.current.hand, knownCount: 0, totalCount: 0, countLabel: "0", cards: [] }
      }
    })} />);
    target = screen.getByText("待清理目标").closest(".overlay-compact-card-row") as HTMLElement;
    expect(target).not.toHaveClass("is-synergy-related");

    preview.rerender(<OverlayPanel view={view({}, { ...withSource, gameKey: "game-2" })} />);
    source = screen.getByText("待清理来源").closest(".overlay-compact-card-row") as HTMLElement;
    fireEvent.click(source);
    expect(screen.getByText("待清理目标").closest(".overlay-compact-card-row")).toHaveClass("is-synergy-related");
    preview.rerender(<OverlayPanel view={view({}, { ...withSource, gameKey: "game-3" })} />);
    expect(screen.getByText("待清理目标").closest(".overlay-compact-card-row")).not.toHaveClass("is-synergy-related");
  });

  it("highlights only eligible deck tutor candidates on hover and focus", () => {
    const base = tracking();
    const recruiterDetails = {
      dbfId: 2001,
      name: "血色招募者",
      cardType: "随从",
      manaCost: 5,
      isSpell: false,
      relatedCards: [],
      relationSelectors: [{ source: "deck" as const, cardTypes: ["随从"], manaCost: { max: 2 } }]
    };
    const minion = (dbfId: number, name: string, manaCost: number) => ({
      dbfId,
      name,
      cardType: "随从",
      manaCost,
      isSpell: false,
      relatedCards: []
    });
    const lifecycle = {
      ...base,
      current: {
        ...base.current,
        deck: {
          ...base.current.deck,
          knownCount: 5,
          totalCount: 5,
          countLabel: "5",
          cards: [
            { id: "recruiter", name: "血色招募者", count: 1, details: recruiterDetails },
            { id: "one-minion", name: "一费随从", count: 1, details: minion(2002, "一费随从", 1) },
            { id: "two-minion", name: "二费随从", count: 1, details: minion(2003, "二费随从", 2) },
            { id: "three-minion", name: "三费随从", count: 1, details: minion(2004, "三费随从", 3) },
            {
              id: "two-spell",
              name: "二费法术",
              count: 1,
              details: { dbfId: 2005, name: "二费法术", cardType: "法术", manaCost: 2, isSpell: true, relatedCards: [] }
            }
          ]
        },
        hand: {
          ...base.current.hand,
          cards: [{ id: "hand-two-minion", name: "手牌二费随从", count: 1, details: minion(2006, "手牌二费随从", 2) }]
        }
      }
    } satisfies OverlayCardTrackingView;
    render(<OverlayPanel view={view({}, lifecycle)} />);

    const recruiter = screen.getByText("血色招募者").closest(".overlay-compact-card-row") as HTMLElement;
    const oneMinion = screen.getByText("一费随从").closest(".overlay-compact-card-row") as HTMLElement;
    const twoMinion = screen.getByText("二费随从").closest(".overlay-compact-card-row") as HTMLElement;
    const threeMinion = screen.getByText("三费随从").closest(".overlay-compact-card-row") as HTMLElement;
    const twoSpell = screen.getByText("二费法术").closest(".overlay-compact-card-row") as HTMLElement;
    const handTwoMinion = screen.getByText("手牌二费随从").closest(".overlay-compact-card-row") as HTMLElement;

    fireEvent.mouseEnter(recruiter);
    expect(oneMinion).toHaveClass("is-synergy-related");
    expect(twoMinion).toHaveClass("is-synergy-related");
    expect(threeMinion).not.toHaveClass("is-synergy-related");
    expect(twoSpell).not.toHaveClass("is-synergy-related");
    expect(handTwoMinion).not.toHaveClass("is-synergy-related");

    fireEvent.mouseLeave(recruiter);
    fireEvent.focus(recruiter);
    expect(oneMinion).toHaveClass("is-synergy-related");
    expect(twoMinion).toHaveClass("is-synergy-related");
    expect(threeMinion).not.toHaveClass("is-synergy-related");
    expect(twoSpell).not.toHaveClass("is-synergy-related");
    expect(handTwoMinion).not.toHaveClass("is-synergy-related");
  });
});
