import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";
import type { PublicTrackerState } from "../src/shared/types";
import { createPublicTrackerState } from "./fixtures/publicTrackerState";
import { openWorkbench } from "./helpers/openWorkbench";

const state = createPublicTrackerState({
  status: "watching",
  gameActive: true,
  logPath: "/Logs/Power.log",
  deck: [],
  events: [
    { id: "event-1", at: "2026-07-30T01:00:00.000Z", kind: "draw", player: "friendly", cardName: "火球术", turn: 7 },
    { id: "event-2", at: "2026-07-30T01:00:01.000Z", kind: "opponent-play", player: "opponent", cardName: "寒冰箭" },
    { id: "event-3", at: "2026-07-30T01:00:02.000Z", kind: "zone-change", player: "unknown" }
  ] as unknown as PublicTrackerState["events"],
  summary: { totalCards: 30, remainingCards: 29, drawnCards: 1, opponentPlayedCount: 1 }
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
  delete window.hearthstoneTracker;
});

function installApi(nextState: PublicTrackerState = state) {
  window.hearthstoneTracker = {
    discoverLogs: vi.fn(async () => []),
    getState: vi.fn(async () => nextState),
    onUpdate: vi.fn(() => () => undefined)
  } as unknown as typeof window.hearthstoneTracker;
}

describe("truthful main-window event presentation", () => {
  it("shows a trusted turn and omits unavailable turns instead of deriving array positions", async () => {
    installApi();
    render(<App />);
    await waitFor(() => expect(window.hearthstoneTracker?.getState).toHaveBeenCalled());

    await openWorkbench();

    const feed = screen.getByRole("main", { name: "实时事件流" });
    expect(within(feed).getByText("第7回合")).toBeInTheDocument();
    expect(within(feed).queryByText(/回合 \?/)).not.toBeInTheDocument();
    expect(within(feed).queryByText(/^第[123]回合$/)).not.toBeInTheDocument();
  });

  it("labels the event count honestly instead of calling it parsed log lines", async () => {
    installApi();
    render(<App />);
    await waitFor(() => expect(window.hearthstoneTracker?.getState).toHaveBeenCalled());

    await openWorkbench();
    const toolbar = screen.getByRole("banner", { name: "记牌器工具栏" });
    expect(toolbar).toHaveTextContent("事件 3");
    expect(toolbar).not.toHaveTextContent("3 行");
  });

  it("returns to opponent tracking after an arena draft enters a match", async () => {
    installApi(createPublicTrackerState({
      ...state,
      arena: {
        status: "playing",
        currentChoices: [],
        picks: [],
        deck: [{ name: "竞技场实战牌", count: 30 }],
        draftCount: 30,
        unresolvedCount: 0
      }
    }));
    render(<App />);
    await waitFor(() => expect(window.hearthstoneTracker?.getState).toHaveBeenCalled());

    await openWorkbench();

    expect(screen.getByRole("complementary", { name: "对手概览" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "竞技场选牌评分" })).not.toBeInTheDocument();
  });
});
