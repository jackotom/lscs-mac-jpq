import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";
import type { PublicTrackerState } from "../src/shared/types";
import { createPublicTrackerState } from "./fixtures/publicTrackerState";
import { openWorkbench } from "./helpers/openWorkbench";

const trackerState = createPublicTrackerState({
  status: "missing-log",
  deck: [],
  events: [],
  summary: { totalCards: 0, remainingCards: 0, drawnCards: 0, opponentPlayedCount: 0 }
});

const validHistory = {
  status: "ok",
  matches: [{ id: "match-1", mode: "standard", deckName: "元素法", result: "win", endedAt: "2026-07-21T10:30:00.000Z" }],
  summary: { total: 1, wins: 1, losses: 0, ties: 0, winRate: 1 }
};

afterEach(() => {
  delete window.hearthstoneTracker;
});

function installTrackerApi(
  getMatchHistory?: () => Promise<unknown>,
  initialState: PublicTrackerState = trackerState
) {
  let emitUpdate: ((state: PublicTrackerState) => void) | undefined;
  window.hearthstoneTracker = {
    discoverLogs: vi.fn(async () => []),
    selectLogPath: vi.fn(),
    start: vi.fn(),
    pause: vi.fn(),
    importDeck: vi.fn(),
    ensureLogConfig: vi.fn(),
    inspectLogConfig: vi.fn(),
    toggleOverlay: vi.fn(),
    getState: vi.fn(async () => initialState),
    onUpdate: vi.fn((callback: (state: PublicTrackerState) => void) => {
      emitUpdate = callback;
      return () => undefined;
    }),
    ...(getMatchHistory ? { getMatchHistory } : {})
  } as unknown as typeof window.hearthstoneTracker;
  return (state: PublicTrackerState) => emitUpdate?.(state);
}

describe("match history route", () => {
  it.each([
    { format: "ratio", winRate: 6 / 17 },
    { format: "percentage", winRate: 35.3 }
  ])("renders a 6/17 win rate from a $format response as 35.3%", async ({ winRate }) => {
    const matches = Array.from({ length: 17 }, (_value, index) => ({
      id: `match-${index + 1}`,
      mode: "standard",
      result: index < 6 ? "win" : "loss",
      endedAt: `2026-07-${String(index + 1).padStart(2, "0")}T10:30:00.000Z`
    }));
    installTrackerApi(vi.fn(async () => ({
      status: "ok",
      matches,
      summary: { total: 17, wins: 6, losses: 11, ties: 0, winRate }
    })));

    render(<App />);

    await waitFor(() => expect(screen.getByText("总胜率").closest("article")).toHaveTextContent("35.3%"));
  });

  it("loads real history for the home dashboard and refreshes it on the history route", async () => {
    const getMatchHistory = vi.fn(async () => validHistory);
    installTrackerApi(getMatchHistory);

    render(<App />);
    await waitFor(() => expect(getMatchHistory).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("元素法")).toBeInTheDocument();
    expect(getMatchHistory).toHaveBeenCalledTimes(2);

    await openWorkbench();
    fireEvent.click(await screen.findByRole("button", { name: "对局记录" }));

    expect(await screen.findByText("元素法")).toBeInTheDocument();
    await waitFor(() => expect(getMatchHistory).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("button", { name: "打开卡牌资料" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭工作台，返回首页" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开卡牌资料" }));
    fireEvent.click(await screen.findByRole("button", { name: "关闭工作台，返回首页" }));
    await waitFor(() => expect(getMatchHistory).toHaveBeenCalledTimes(4));
    await openWorkbench();
    fireEvent.click(screen.getByRole("button", { name: "对局记录" }));
    expect(await screen.findByText("元素法")).toBeInTheDocument();
    await waitFor(() => expect(getMatchHistory).toHaveBeenCalledTimes(5));
  });

  it("refreshes the home history after the active game ends", async () => {
    const activeState: PublicTrackerState = {
      ...trackerState,
      status: "watching",
      gameActive: true
    };
    const completedHistory = {
      status: "ok",
      matches: [{ id: "match-2", mode: "arena", deckName: "新结束的竞技场", result: "win", endedAt: "2026-07-22T12:00:00.000Z" }],
      summary: { total: 1, wins: 1, losses: 0, ties: 0, winRate: 1 }
    };
    const getMatchHistory = vi.fn(async () => validHistory);
    const emitUpdate = installTrackerApi(getMatchHistory, activeState);

    render(<App />);
    await waitFor(() => expect(getMatchHistory).toHaveBeenCalledTimes(2));
    getMatchHistory.mockResolvedValue(completedHistory);
    getMatchHistory.mockClear();

    await act(async () => {
      emitUpdate({ ...activeState, gameActive: false });
    });

    expect(await screen.findByText("新结束的竞技场")).toBeInTheDocument();
    expect(getMatchHistory).toHaveBeenCalledTimes(1);
  });

  it("shows the real history loading and failure state on the home dashboard", async () => {
    let rejectHistory: (error: Error) => void = () => undefined;
    const getMatchHistory = vi.fn(() => new Promise((_, reject) => {
      rejectHistory = reject;
    }));
    installTrackerApi(getMatchHistory);

    render(<App />);
    expect(await screen.findByText("正在读取最近对局…")).toBeInTheDocument();
    await waitFor(() => expect(getMatchHistory).toHaveBeenCalledTimes(2));

    await act(async () => {
      rejectHistory(new Error("连接断开"));
    });

    expect(await screen.findByText("连接断开")).toBeInTheDocument();
  });

  it("clearly explains unavailable and rejected history reads", async () => {
    const preview = render(<App />);
    await openWorkbench();
    fireEvent.click(await screen.findByRole("button", { name: "对局记录" }));
    expect(await screen.findByText("当前版本无法读取真实对局历史，请在桌面版更新后重试。")).toBeInTheDocument();
    preview.unmount();

    installTrackerApi(vi.fn(async () => Promise.reject(new Error("连接断开"))));
    render(<App />);
    await openWorkbench();
    fireEvent.click(await screen.findByRole("button", { name: "对局记录" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("连接断开");
  });

  it("shows a backend history error", async () => {
    installTrackerApi(vi.fn(async () => ({ status: "error", error: "历史文件损坏" })));
    render(<App />);

    await openWorkbench();
    fireEvent.click(await screen.findByRole("button", { name: "对局记录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("历史文件损坏");
  });

  it("accepts and renders casual history records", async () => {
    installTrackerApi(vi.fn(async () => ({
      status: "ok",
      matches: [{ id: "casual-1", mode: "casual", deckName: "休闲套牌", result: "win", endedAt: "2026-07-22T12:00:00.000Z" }],
      summary: { total: 1, wins: 1, losses: 0, ties: 0, winRate: 1 }
    })));
    render(<App />);

    await openWorkbench();
    fireEvent.click(await screen.findByRole("button", { name: "对局记录" }));

    expect(await screen.findByText("休闲")).toBeInTheDocument();
  });

  it.each([
    ["summary", { ...validHistory, summary: { ...validHistory.summary, total: -1 } }],
    ["matches", { ...validHistory, matches: {} }],
    ["date", { ...validHistory, matches: [{ ...validHistory.matches[0], endedAt: "not-a-date" }] }],
    ["result enum", { ...validHistory, matches: [{ ...validHistory.matches[0], result: "victory" }] }],
    ["mode enum", { ...validHistory, matches: [{ ...validHistory.matches[0], mode: "ranked" }] }]
  ])("rejects a malformed %s response without crashing", async (_label, response) => {
    installTrackerApi(vi.fn(async () => response));
    render(<App />);

    await openWorkbench();
    fireEvent.click(await screen.findByRole("button", { name: "对局记录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("对局历史数据无效，已拒绝更新界面。");
  });
});
