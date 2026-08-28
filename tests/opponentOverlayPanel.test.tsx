import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toCardTrackingView } from "../src/renderer/cardTrackingView";
import { OpponentOverlayPanel } from "../src/renderer/components/OpponentOverlayPanel";
import type {
  OverlayCardTrackingView,
  OverlayPanelViewModel,
  OverlaySecretSlot
} from "../src/renderer/types";
import { createEmptyCardTracking } from "./fixtures/publicTrackerState";

afterEach(() => {
  window.history.replaceState({}, "", "/");
  delete window.hearthstoneTracker;
});

function opponentTracking(
  secretSlots: readonly OverlaySecretSlot[] = [],
  handTotal = 5
): OverlayCardTrackingView {
  const empty = (key: keyof OverlayCardTrackingView["current"]) => ({
    key,
    status: "known" as const,
    knownCount: 0,
    totalCount: 0,
    countLabel: "0",
    cards: []
  });
  return {
    status: "ready",
    gameKey: "opponent-game",
    side: "opponent",
    current: {
      deck: { ...empty("deck"), status: "unknown", totalCount: undefined, countLabel: "?" },
      hand: {
        ...empty("hand"),
        status: "partial",
        knownCount: 1,
        totalCount: handTotal,
        countLabel: String(handTotal),
        cards: [{ id: "known-hand", name: "已知手牌", count: 1 }]
      },
      play: empty("play"),
      secret: { ...empty("secret"), countLabel: `当前 ${secretSlots.length}` },
      graveyard: empty("graveyard"),
      removed: empty("removed")
    },
    burned: { key: "burned", totalCount: 0, countLabel: "0", truncated: false, items: [] },
    used: { key: "used", totalCount: 0, countLabel: "0", truncated: false, items: [] },
    secretSlots: [...secretSlots]
  };
}

function view(
  cardTracking: OverlayCardTrackingView = opponentTracking(),
  overrides: Partial<OverlayPanelViewModel> = {}
): OverlayPanelViewModel {
  return {
    cardTracking,
    summary: { totalCards: 30, remainingCards: 22, drawnCards: 8 },
    deckIdentity: { name: "测试套牌", status: "automatic", detail: "自动识别当前对局" },
    remainingDeck: [],
    recentDraws: [],
    status: { tone: "tracking", label: "监听中", detail: "同步中", updatedAtLabel: "刚刚" },
    ...overrides
  };
}

describe("opponent overlay", () => {
  it("shows confirmed opponent hand timeline and only counts down from a reliable start time", () => {
    render(<OpponentOverlayPanel view={{
      ...view(),
      opponentHand: [{
        entityId: "hand-1",
        name: "锻造火球术",
        drawnTurn: 3,
        created: true,
        forged: true,
        buffs: ["法术伤害 +1"]
      }],
      turnTimer: { turn: 4, activeSide: "opponent", startedAt: "2026-08-22T12:00:00.000Z", durationSeconds: 75 }
    } as OverlayPanelViewModel} isCollapsed={false} />);

    const timelineToggle = screen.getByRole("button", { name: "已确认手牌 (1)" });
    const handToggle = screen.getByRole("button", { name: /手牌 \(5\)/ });
    expect(handToggle).toHaveAttribute("aria-expanded", "true");
    expect(timelineToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("锻造火球术")).not.toBeInTheDocument();
    fireEvent.click(timelineToggle);
    expect(timelineToggle).toHaveAttribute("aria-expanded", "true");
    expect(handToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("对手手牌时间线")).toHaveTextContent("锻造火球术");
    expect(screen.getByLabelText("对手手牌时间线")).toHaveTextContent("第 3 回合抽取");
    expect(screen.getByLabelText("对手手牌时间线")).toHaveTextContent("创建");
    expect(screen.getByLabelText("对手手牌时间线")).toHaveTextContent("已锻造");
    expect(screen.getByLabelText("回合计时")).toHaveTextContent("剩余");
    const timeline = screen.getByLabelText("对手手牌时间线");
    expect(timeline.parentElement).toHaveClass("card-tracking-main");
    expect(timeline.previousElementSibling).toHaveAttribute("data-group-key", "removed");
    expect(timeline.nextElementSibling).toBeNull();
    fireEvent.click(handToggle);
    expect(timelineToggle).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps an empty confirmed-hand button as the last current group", () => {
    render(<OpponentOverlayPanel view={view()} isCollapsed={false} />);

    const toggle = screen.getByRole("button", { name: "已确认手牌 (0)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getByLabelText("对手手牌时间线")).toHaveTextContent("暂无确认记录");
  });

  it("marks an unavailable timer without inventing a countdown", () => {
    render(<OpponentOverlayPanel view={{ ...view(), turnTimer: { turn: 5, durationSeconds: 75 } }} isCollapsed={false} />);
    expect(screen.getByLabelText("回合计时")).toHaveClass("is-unavailable");
    expect(screen.getByLabelText("回合计时")).not.toHaveTextContent("剩余");
  });

  it("updates reliable timer countdown while the overlay stays open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T12:00:00.000Z"));
    render(<OpponentOverlayPanel view={{ ...view(), turnTimer: { turn: 5, startedAt: "2026-08-22T12:00:00.000Z", durationSeconds: 75 } }} isCollapsed={false} />);
    expect(screen.getByLabelText("回合计时")).toHaveTextContent("剩余 1:15");
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(screen.getByLabelText("回合计时")).toHaveTextContent("剩余 1:10");
    vi.useRealTimers();
  });

  it("deduplicates confirmed entities and keeps legacy rows visible as limited evidence", () => {
    render(<OpponentOverlayPanel view={{ ...view(), opponentHand: [
      { entityId: "same", name: "火球术", created: true, forged: true, buffs: [] },
      { entityId: "same", name: "火球术", created: true, forged: true, buffs: [] },
      { name: "旧版已知手牌", count: 2 }
    ] }} isCollapsed={false} />);
    fireEvent.click(screen.getByRole("button", { name: "已确认手牌 (3)" }));
    expect(screen.getAllByText("火球术")).toHaveLength(1);
    expect(screen.getByText("旧版已知手牌 ×2")).toBeInTheDocument();
    expect(screen.getByText("火球术").closest(".opponent-hand-row")).toHaveClass("is-created", "is-forged");
  });

  it("keeps secret slots out of the regular opponent tracker", () => {
    const secret: OverlaySecretSlot = {
      id: "slot-1",
      label: "? 1",
      candidates: Array.from({ length: 5 }, (_value, index) => ({
        id: `candidate-${index + 1}`,
        name: `候选牌 ${index + 1}`,
        status: "possible" as const
      }))
    };
    render(<OpponentOverlayPanel view={view(opponentTracking([secret]))} isCollapsed={false} />);

    expect(screen.queryByRole("button", { name: /奥秘/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/候选牌 \d/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("对手概览")).not.toHaveTextContent("奥秘");
  });

  it("keeps hidden hand cards aggregated", () => {
    render(<OpponentOverlayPanel view={view()} isCollapsed={false} />);

    expect(screen.getByText("已知手牌")).toBeInTheDocument();
    expect(screen.getByText("未公开 ×4")).toBeInTheDocument();
  });

  it("renders exact public deck and hand totals from real tracking state", () => {
    const tracking = structuredClone(createEmptyCardTracking("opponent-counts"));
    const current = tracking.opponent.current as unknown as Record<string, unknown>;
    current.deck = { status: "partial", knownCount: 0, totalCount: 22, cards: [] };
    current.hand = {
      status: "partial",
      knownCount: 1,
      totalCount: 6,
      cards: [{ cardKey: "id:known-hand", name: "已知手牌", count: 1 }]
    };
    const cardTracking = toCardTrackingView(tracking, "opponent", { showSecretCandidates: true });

    render(<OpponentOverlayPanel view={view(cardTracking)} isCollapsed={false} />);

    expect(screen.getByLabelText("对手概览")).toHaveTextContent("牌库 22");
    expect(screen.getByLabelText("对手概览")).toHaveTextContent("手牌 6");
  });

  it("shows the opponent's inserted-deck counts without listing generated card names", () => {
    render(<OpponentOverlayPanel view={view({
      ...opponentTracking(),
      deckInsertions: {
        groups: [{ sourceEntityId: "500", sourceName: "对手来源创建", remainingCount: 5 }],
        placements: [{ entityId: "501", position: "top" }]
      }
    })} isCollapsed={false} />);

    fireEvent.click(screen.getByRole("button", { name: /牌库.*\?/ }));
    expect(screen.getByLabelText("牌库生成记录")).toHaveTextContent("对手来源创建5张卡牌");
    expect(screen.getByLabelText("牌库位置记录")).toHaveTextContent("置顶：未知卡牌");
  });

  it("keeps global effects and public counters", () => {
    render(<OpponentOverlayPanel view={view(opponentTracking(), {
      opponentGlobalEffects: [{ id: "global-1", name: "对手全局效果", count: 1 }],
      opponentCounters: { nextFatigueDamage: 3, spellsPlayed: 8 }
    })} isCollapsed={false} />);

    expect(screen.getByText("对手全局效果")).toBeInTheDocument();
    expect(screen.getByText("疲劳")).toBeInTheDocument();
    expect(screen.getByText("法术")).toBeInTheDocument();
  });

  it("shows only the active side from match pulse", () => {
    render(<OpponentOverlayPanel view={view(opponentTracking(), {
      matchPulse: {
        turn: 7,
        activeSide: "friendly",
        fullLabel: "第7回合 · 我方行动 · 法力5/7",
        compactLabel: "7回 · 我 · 5/7",
        actorLabel: "我方回合"
      }
    })} isCollapsed={false} />);

    const pulse = screen.getByLabelText("当前行动方");
    expect(pulse).toHaveTextContent("我方回合");
    expect(pulse).not.toHaveTextContent(/7|5\/7/);
  });

  it("keeps the collapsed restore button independent from secret state", () => {
    const secret: OverlaySecretSlot = { id: "slot-1", label: "? 1", candidates: [] };
    const onCollapsedChange = vi.fn();
    render(
      <OpponentOverlayPanel
        view={view(opponentTracking([secret]))}
        isCollapsed
        onCollapsedChange={onCollapsedChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "恢复对手记牌小窗" }));
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it("requests collapse changes but renders only the controlled value", () => {
    const onCollapsedChange = vi.fn();
    const preview = render(
      <OpponentOverlayPanel view={view()} isCollapsed={false} onCollapsedChange={onCollapsedChange} />
    );

    fireEvent.click(screen.getByRole("button", { name: "折叠对手小窗" }));
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    expect(screen.getByText("已知手牌")).toBeInTheDocument();

    preview.rerender(<OpponentOverlayPanel view={view()} isCollapsed onCollapsedChange={onCollapsedChange} />);
    fireEvent.click(screen.getByRole("button", { name: "恢复对手记牌小窗" }));
    expect(onCollapsedChange).toHaveBeenLastCalledWith(false);
  });

  it("updates the public hand count without replacing the revealed row", () => {
    const preview = render(<OpponentOverlayPanel view={view(opponentTracking([], 3))} isCollapsed={false} />);
    const revealedRow = screen.getByText("已知手牌").closest(".overlay-compact-card-row");
    expect(screen.getByText("未公开 ×2")).toBeInTheDocument();

    preview.rerender(<OpponentOverlayPanel view={view(opponentTracking([], 6))} isCollapsed={false} />);

    expect(screen.getByText("已知手牌").closest(".overlay-compact-card-row")).toBe(revealedRow);
    expect(screen.getByText("未公开 ×5")).toBeInTheDocument();
  });

  it("keeps card preview integration for a revealed lifecycle hand card", () => {
    const base = opponentTracking([], 2);
    const cardTracking = {
      ...base,
      current: {
        ...base.current,
        hand: {
          ...base.current.hand,
          cards: [{
            id: "known-hand",
            name: "火球术",
            count: 1,
            details: {
              dbfId: 315,
              cardId: "CS2_029",
              name: "火球术",
              manaCost: 4,
              cardType: "法术",
              text: "造成 6 点伤害。",
              isSpell: true,
              relatedCards: []
            }
          }]
        }
      }
    } satisfies OverlayCardTrackingView;
    render(<OpponentOverlayPanel view={view(cardTracking)} isCollapsed={false} />);

    const row = screen.getByText("火球术").closest(".overlay-compact-card-row") as HTMLElement;
    expect(row).not.toHaveAttribute("role", "button");
    expect(row).not.toHaveAttribute("aria-pressed");
    expect(row).not.toHaveAttribute("data-card-selected");
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    expect(row).not.toHaveAttribute("data-card-selected");

    fireEvent.mouseEnter(row);

    expect(screen.getByRole("tooltip")).toHaveTextContent("造成 6 点伤害。");
    expect(screen.getByText("未公开 ×1")).toBeInTheDocument();
  });

  it("keeps opponent card rows preview-only without hover or focus synergy", () => {
    const base = opponentTracking();
    const sourceDetails = {
      dbfId: 7001,
      name: "对手检索来源",
      cardType: "随从",
      manaCost: 5,
      text: "从你的牌库中召唤一个法力值消耗不高于（2）点的随从。",
      isSpell: false,
      relatedCards: [],
      relationSelectors: [{ source: "deck" as const, cardTypes: ["随从"], manaCost: { max: 2 } }]
    };
    const targetDetails = {
      dbfId: 7002,
      name: "对手二费目标",
      cardType: "随从",
      manaCost: 2,
      text: "战吼：获得+1攻击力。",
      isSpell: false,
      relatedCards: []
    };
    const cardTracking = {
      ...base,
      current: {
        ...base.current,
        deck: {
          ...base.current.deck,
          status: "known" as const,
          knownCount: 2,
          totalCount: 2,
          countLabel: "2",
          cards: [
            { id: "opponent-source", name: "对手检索来源", count: 1, details: sourceDetails },
            { id: "opponent-target", name: "对手二费目标", count: 1, details: targetDetails }
          ]
        }
      }
    } satisfies OverlayCardTrackingView;
    render(<OpponentOverlayPanel view={view(cardTracking)} isCollapsed={false} />);
    fireEvent.click(screen.getByRole("button", { name: /牌库.*2/ }));

    const source = screen.getByText("对手检索来源").closest(".overlay-compact-card-row") as HTMLElement;
    const target = screen.getByText("对手二费目标").closest(".overlay-compact-card-row") as HTMLElement;
    fireEvent.mouseEnter(source);
    expect(screen.getByRole("tooltip")).toHaveTextContent("从你的牌库中召唤");
    expect(target).not.toHaveClass("is-synergy-related");
    fireEvent.mouseLeave(source);

    fireEvent.focus(source);
    expect(target).not.toHaveClass("is-synergy-related");
  });

  it("shows artwork for every revealed used-card row and keeps names when artwork is unavailable", () => {
    const base = opponentTracking();
    const cardTracking = {
      ...base,
      used: {
        key: "used" as const,
        totalCount: 3,
        countLabel: "3",
        truncated: false,
        items: [
          {
            id: "used-first",
            sequence: 3,
            displayName: "重复卡牌",
            hidden: false,
            confidence: "confirmed" as const,
            details: {
              dbfId: 1001,
              name: "重复卡牌",
              cropImageUrl: "https://example.test/repeated-card.jpg",
              isSpell: false,
              relatedCards: []
            }
          },
          {
            id: "used-second",
            sequence: 2,
            displayName: "重复卡牌",
            hidden: false,
            confidence: "confirmed" as const,
            details: {
              dbfId: 1001,
              name: "重复卡牌",
              cropImageUrl: "https://example.test/repeated-card.jpg",
              isSpell: false,
              relatedCards: []
            }
          },
          {
            id: "used-no-art",
            sequence: 1,
            displayName: "无图卡牌",
            hidden: false,
            confidence: "confirmed" as const,
            details: {
              dbfId: 1002,
              name: "无图卡牌",
              isSpell: false,
              relatedCards: []
            }
          }
        ]
      }
    } satisfies OverlayCardTrackingView;
    const preview = render(<OpponentOverlayPanel view={view(cardTracking)} isCollapsed={false} />);

    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    fireEvent.click(screen.getByRole("button", { name: /已使用.*3/ }));

    const repeatedRows = screen.getAllByText("重复卡牌").map((name) =>
      name.closest(".overlay-history-card-row") as HTMLElement
    );
    expect(repeatedRows).toHaveLength(2);
    expect(repeatedRows.every((row) => row.querySelector(".overlay-card-art-image"))).toBe(true);
    expect(screen.getByText("无图卡牌")).toBeVisible();

    const firstArtwork = repeatedRows[0]!.querySelector(".overlay-card-art-image") as HTMLImageElement;
    fireEvent.error(firstArtwork);
    expect(repeatedRows[0]).not.toContainElement(firstArtwork);
    expect(repeatedRows[0]).toHaveTextContent("重复卡牌");
    expect(preview.container.querySelector(".card-tracking-main")).toHaveAttribute(
      "data-scroll-owner",
      "card-tracking-main"
    );
  });

  it("short-circuits lifecycle groups for loading, errors, and missing logs", () => {
    const preview = render(<OpponentOverlayPanel view={view()} isCollapsed={false} isLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("正在读取对局状态");
    expect(document.querySelector("[data-group-key]")).not.toBeInTheDocument();

    preview.rerender(<OpponentOverlayPanel view={view()} isCollapsed={false} loadError="读取失败测试" />);
    expect(screen.getByRole("alert")).toHaveTextContent("读取失败测试");

    preview.rerender(<OpponentOverlayPanel
      view={view(opponentTracking(), {
        status: { tone: "offline", label: "缺少日志", detail: "缺少 Power.log", updatedAtLabel: "刚刚" }
      })}
      isCollapsed={false}
    />);
    expect(screen.getByRole("status")).toHaveTextContent("先点修复日志");
  });
});
