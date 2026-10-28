import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MatchHistoryPanel } from "../src/renderer/components/MatchHistoryPanel";
import type { MatchHistoryResult } from "../src/shared/types";

const result: MatchHistoryResult = {
  status: "ok",
  matches: [
    { id: "a", mode: "standard", result: "win", endedAt: "2026-10-04T12:00:00Z", deckName: "元素法", details: { deckKey: "version-a", initiative: "first", opponentClass: "MAGE", turns: 8 } },
    { id: "b", mode: "standard", result: "tie", endedAt: "2026-10-05T12:00:00Z", deckName: "元素法", details: { deckKey: "version-b", initiative: "second", opponentClass: "MAGE" } },
    { id: "old", mode: "wild", result: "loss", endedAt: "2026-10-05T12:00:00Z" }
  ],
  summary: { total: 3, wins: 1, losses: 1, ties: 1, winRate: 1 / 3 }
};

describe("match insights panel", () => {
  it("filters records and analytics together and explains missing metrics", () => {
    render(<MatchHistoryPanel result={result} loading={false} />);
    expect(screen.getByRole("table", { name: "每日趋势" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "先后手表现" })).toHaveTextContent("未知");
    fireEvent.change(screen.getByLabelText("套牌版本"), { target: { value: "v:version-b" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(within(screen.getByLabelText("对局汇总")).getByText("0%")).toBeInTheDocument();
    expect(screen.getByText(/平均回合：未知/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("起始日期"), { target: { value: "2026-10-06" } });
    expect(screen.getByText("当前筛选没有对局记录。调整条件后重试。")).toBeInTheDocument();
    expect(within(screen.getByLabelText("对局汇总")).getByText("—")).toBeInTheDocument();
  });
});
