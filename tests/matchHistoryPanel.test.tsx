import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MatchHistoryPanel } from "../src/renderer/components/MatchHistoryPanel";
import type { MatchHistoryResult } from "../src/shared/types";

const history = {
  status: "ok",
  matches: [
    { id: "old", mode: "arena", deckName: "竞技场", result: "loss", endedAt: "2026-07-20T10:30:00.000Z" },
    { id: "new", mode: "standard", deckName: "元素法", result: "win", endedAt: "2026-07-21T10:30:00.000Z" },
    { id: "tie", mode: "wild", deckName: "任务术", result: "tie", endedAt: "2026-07-19T10:30:00.000Z" }
  ],
  summary: { total: 3, wins: 1, losses: 1, ties: 1, winRate: 1 / 3 }
} as unknown as MatchHistoryResult;

const casualHistory: MatchHistoryResult = {
  status: "ok",
  matches: [{ id: "casual", mode: "casual", deckName: "休闲套牌", result: "win", endedAt: "2026-07-22T10:30:00.000Z" }],
  summary: { total: 1, wins: 1, losses: 0, ties: 0, winRate: 1 }
};

describe("MatchHistoryPanel", () => {
  it("shows the summary and newest records first", () => {
    render(<MatchHistoryPanel result={history} loading={false} />);

    expect(screen.getByText("总局数")).toBeInTheDocument();
    expect(screen.getByText("胜率")).toBeInTheDocument();
    expect(screen.getByText("33.3%")).toBeInTheDocument();
    expect(screen.getByText("胜利")).toBeInTheDocument();
    expect(screen.getByText("失败")).toBeInTheDocument();
    expect(screen.getByText("平局")).toBeInTheDocument();
    expect(screen.getAllByText("元素法")[0]).toBeInTheDocument();
    expect(screen.getByText("元素法").closest("li")).toHaveClass("match-history-row");
    expect(screen.getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      expect.stringContaining("元素法"),
      expect.stringContaining("竞技场"),
      expect.stringContaining("任务术")
    ]);
  });

  it("labels a casual record as casual", () => {
    render(<MatchHistoryPanel result={casualHistory} loading={false} />);

    expect(screen.getByText("休闲")).toBeInTheDocument();
  });

  it("shows an explicit empty state", () => {
    render(<MatchHistoryPanel result={{ ...history, matches: [], summary: { total: 0, wins: 0, losses: 0, ties: 0, winRate: 0 } } as MatchHistoryResult} loading={false} />);

    expect(screen.getByText("还没有已完成的对局记录。完成一局后会自动显示在这里。"))
      .toBeInTheDocument();
  });

  it("shows an explicit error state", () => {
    render(<MatchHistoryPanel result={undefined} loading={false} error="历史文件损坏" />);

    expect(screen.getByRole("alert")).toHaveTextContent("历史文件损坏");
  });
});
