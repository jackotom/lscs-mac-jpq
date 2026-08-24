import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArenaInsightsPanel } from "../src/renderer/components/ArenaInsightsPanel";

describe("arena insights panel", () => {
  it("shows local run facts, source and update time", () => {
    render(<ArenaInsightsPanel loading={false} result={{
      status: "ok",
      source: "本机竞技场档案",
      updatedAt: "2026-08-22T12:00:00.000Z",
      runs: [{ id: "run-1", startedAt: "2026-08-22T11:00:00.000Z", hero: "法师", wins: 10, losses: 2, deckScore: 72, deck: [], rewards: [], mulligan: [], recordedMatchIds: [] }],
      summary: { runCount: 1, totalWins: 10, totalLosses: 2, winRate: 83.3 },
      highWinDecks: [{ id: "run-1", startedAt: "2026-08-22T11:00:00.000Z", hero: "法师", wins: 10, losses: 2, deckScore: 72, deck: [], rewards: [], mulligan: [], recordedMatchIds: [] }],
      mulliganStats: [{ cardName: "火球术", drawnBeforeMulligan: 3, kept: 3, inHandAfterMulligan: 3, wins: 2, winRate: 66.7 }]
    }} />);

    expect(screen.getByLabelText("竞技场中心")).toHaveTextContent("10 胜套牌");
    expect(screen.getByLabelText("竞技场中心")).toHaveTextContent("本机竞技场档案");
    expect(screen.getByLabelText("竞技场中心")).toHaveTextContent("火球术");
    expect(screen.getByLabelText("竞技场中心")).toHaveTextContent("本机日志未确认时留牌暂无");
  });

  it("shows a useful empty and error state", () => {
    const preview = render(<ArenaInsightsPanel loading={false} result={{ status: "ok", source: "本机竞技场档案", updatedAt: "2026-08-22T12:00:00.000Z", runs: [], highWinDecks: [], mulliganStats: [] }} />);
    expect(screen.getByRole("status")).toHaveTextContent("暂无竞技场档案");
    preview.rerender(<ArenaInsightsPanel loading={false} error="读取竞技场档案失败" />);
    expect(screen.getByRole("alert")).toHaveTextContent("读取竞技场档案失败");
  });

  it("keeps refresh under caller control", () => {
    const onRefresh = vi.fn();
    render(<ArenaInsightsPanel loading={false} onRefresh={onRefresh} result={{ status: "ok", source: "本机竞技场档案", updatedAt: "2026-08-22T12:00:00.000Z", runs: [], highWinDecks: [], mulliganStats: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: "刷新竞技场档案" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("separates current and completed runs, exposes deck cards and sends structured writes", async () => {
    const onRecordRewards = vi.fn();
    const onImportRuns = vi.fn();
    const onExportRuns = vi.fn();
    render(<ArenaInsightsPanel loading={false} onRecordRewards={onRecordRewards} onImportRuns={onImportRuns} onExportRuns={onExportRuns} result={{
      status: "ok", source: "本机竞技场档案", updatedAt: "2026-08-22T12:00:00.000Z",
      runs: [
        { id: "current", startedAt: "2026-08-22T11:00:00.000Z", hero: "法师", wins: 4, losses: 1, deck: [{ name: "火球术", count: 1 }], rewards: [], mulligan: [], recordedMatchIds: [] },
        { id: "finished", startedAt: "2026-08-21T11:00:00.000Z", endedAt: "2026-08-21T12:00:00.000Z", hero: "战士", wins: 10, losses: 2, deck: [], rewards: [], mulligan: [], recordedMatchIds: [] }
      ], highWinDecks: [{ id: "finished", startedAt: "2026-08-21T11:00:00.000Z", endedAt: "2026-08-21T12:00:00.000Z", wins: 10, losses: 2, deck: [], rewards: [], mulligan: [], recordedMatchIds: [] }], mulliganStats: []
    }} />);
    expect(screen.getByText("当前轮次")).toBeInTheDocument();
    expect(screen.getByText("历史轮次")).toBeInTheDocument();
    expect(screen.getByText(/火球术/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("竞技场奖励 JSON"), { target: { value: '[{"type":"gold","amount":150}]' } });
    fireEvent.click(screen.getByRole("button", { name: "保存竞技场奖励" }));
    await waitFor(() => expect(onRecordRewards).toHaveBeenCalledWith("current", [{ type: "gold", amount: 150 }]));
    fireEvent.change(screen.getByLabelText("竞技场档案 JSON"), { target: { value: '[]' } });
    fireEvent.click(screen.getByRole("button", { name: "导入竞技场档案" }));
    await waitFor(() => expect(onImportRuns).toHaveBeenCalledWith([]));
    fireEvent.click(screen.getByRole("button", { name: "导出竞技场档案" }));
    expect(onExportRuns).toHaveBeenCalledOnce();
  });
});
