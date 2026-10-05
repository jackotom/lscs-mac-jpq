import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DecisionInsight } from "../src/shared/decisionInsights";
import { DecisionInsightsPanel } from "../src/renderer/components/DecisionInsightsPanel";
import { OverlayPanel } from "../src/renderer/components/OverlayPanel";
import { toOverlayPanelViewModel } from "../src/renderer/overlayView";
import { createPublicTrackerState } from "./fixtures/publicTrackerState";

function insight(overrides: Partial<DecisionInsight> = {}): DecisionInsight {
  return {
    id: "offer-1", kind: "mulligan", mode: "standard", status: "ready",
    source: "公开统计", updatedAt: "2026-10-05T08:00:00Z",
    cards: [{ entityId: "11", cardId: "A", name: "测试卡牌" }],
    stats: [{ cardId: "A", samples: 1000, winRate: 56.7, keepRate: 70, keepSamples: 1000, metric: "mulligan" }],
    ...overrides
  };
}

describe("decision insights", () => {
  it("shows mulligan metrics and source without calling them optimal decisions", () => {
    render(<DecisionInsightsPanel insight={insight()} />);
    expect(screen.getByText("起手留牌参考")).toBeInTheDocument();
    expect(screen.getByText(/起手后胜率/)).toHaveTextContent("56.7%");
    expect(screen.getByText(/保留率/)).toHaveTextContent("70.0%");
    expect(screen.getByText("常见保留")).toBeInTheDocument();
    expect(screen.getByText(/统计不代表此局最优选择/)).toBeInTheDocument();
    expect(screen.getByText(/公开统计/)).toBeInTheDocument();
    expect(document.querySelector("time")).toHaveAttribute("datetime", "2026-10-05T08:00:00Z");
  });

  it.each([
    ["discovered", "发现后胜率"], ["drawn", "抽到后胜率参考"]
  ] as const)("labels %s data accurately", (metric, label) => {
    render(<DecisionInsightsPanel insight={insight({ kind: "discover", stats: [{ cardId: "A", samples: 400, winRate: 51.2, metric }] })} />);
    expect(screen.getByText(new RegExp(label))).toHaveTextContent("51.2%");
    if (metric === "drawn") expect(screen.getByText(/并非发现统计/)).toBeInTheDocument();
    expect(screen.queryByText("常见保留")).not.toBeInTheDocument();
  });

  it("marks small samples without a keep suggestion, and keeps unknown data empty", () => {
    render(<DecisionInsightsPanel insight={insight({
      cards: [...insight().cards, { entityId: "12", cardId: "UNKNOWN", name: "未知卡牌" }],
      stats: [{ cardId: "A", samples: 199, winRate: 80, keepRate: 90, metric: "mulligan" }]
    })} />);
    expect(screen.getByText("小样本")).toBeInTheDocument();
    expect(screen.queryByText("常见保留")).not.toBeInTheDocument();
    const unknown = screen.getByText("未知卡牌").closest("li")!;
    expect(within(unknown).getByText("暂无统计")).toBeInTheDocument();
    expect(unknown).not.toHaveTextContent("0%");
  });

  it("keeps duplicate card instances as separate options", () => {
    render(<DecisionInsightsPanel insight={insight({ cards: [
      ...insight().cards, { entityId: "12", cardId: "A", name: "测试卡牌" }
    ] })} />);
    expect(screen.getAllByText("测试卡牌")).toHaveLength(2);
    expect(document.querySelector('[data-entity-id="11"]')).toBeInTheDocument();
    expect(document.querySelector('[data-entity-id="12"]')).toBeInTheDocument();
  });

  it.each([undefined, 199])("withholds keep labels when original-hand samples are %s", (keepSamples) => {
    render(<DecisionInsightsPanel insight={insight({
      stats: [{ cardId: "A", samples: 1000, winRate: 80, keepRate: 90, keepSamples, metric: "mulligan" }]
    })} />);
    expect(screen.getByText(/保留率/)).toHaveTextContent("90.0%");
    expect(screen.queryByText("常见保留")).not.toBeInTheDocument();
    if (keepSamples !== undefined) expect(screen.getByText("小样本")).toBeInTheDocument();
  });

  it("hides absent insight and explicitly renders loading or unavailable without stale rates", () => {
    const preview = render(<DecisionInsightsPanel />);
    expect(preview.container).toBeEmptyDOMElement();
    preview.rerender(<DecisionInsightsPanel insight={insight({ status: "loading" })} />);
    expect(screen.getByRole("status")).toHaveTextContent("正在读取统计");
    expect(screen.queryByText(/56.7%/)).not.toBeInTheDocument();
    preview.rerender(<DecisionInsightsPanel insight={insight({ status: "unavailable", note: "当前模式暂无数据" })} />);
    expect(screen.getByRole("status")).toHaveTextContent("统计暂不可用");
    expect(screen.getByText("当前模式暂无数据")).toBeInTheDocument();
    expect(screen.queryByText(/56.7%/)).not.toBeInTheDocument();
  });

  it("maps only active friendly decisions and clears them outside watching games", () => {
    const decisionInsight = insight();
    const { id, kind, cards } = decisionInsight;
    const state = createPublicTrackerState({
      status: "watching", gameActive: true,
      decisionOffer: { id, kind, cards }, decisionInsight
    });
    const endedState = createPublicTrackerState({
      ...state, gameActive: false, decisionOffer: undefined, decisionInsight: undefined
    });
    expect(toOverlayPanelViewModel(state).decisionInsight).toEqual(state.decisionInsight);
    expect(toOverlayPanelViewModel(state, { side: "opponent" }).decisionInsight).toBeUndefined();
    expect(toOverlayPanelViewModel(endedState).decisionInsight).toBeUndefined();
    expect(toOverlayPanelViewModel({ ...state, status: "paused" }).decisionInsight).toBeUndefined();
    expect(toOverlayPanelViewModel({ ...state, decisionInsight: undefined }).decisionInsight).toBeUndefined();
    render(<OverlayPanel view={toOverlayPanelViewModel(state)} />);
    expect(screen.getByText("起手留牌参考")).toBeInTheDocument();
  });
});
