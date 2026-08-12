import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";
import { DEFAULT_TRACKER_SETTINGS } from "../src/main/trackerSettingsStore";
import type { TrackerSettings } from "../src/shared/types";
import { createPublicTrackerState } from "./fixtures/publicTrackerState";
import { openWorkbench } from "./helpers/openWorkbench";

const trackerState = createPublicTrackerState({
  status: "watching",
  deck: [],
  events: [],
  summary: { totalCards: 30, remainingCards: 23, drawnCards: 7, opponentPlayedCount: 4 }
});

const settings: TrackerSettings = {
  ...structuredClone(DEFAULT_TRACKER_SETTINGS)
};

afterEach(() => {
  delete window.hearthstoneTracker;
});

describe("desktop navigation shell", () => {
  it("keeps real routes in one shell and shows only live overview values", async () => {
    window.hearthstoneTracker = {
      discoverLogs: vi.fn(async () => []),
      getState: vi.fn(async () => trackerState),
      onUpdate: vi.fn(() => () => undefined),
      getTrackerSettings: vi.fn(async () => settings)
    } as unknown as typeof window.hearthstoneTracker;

    const { container } = render(<App />);
    await waitFor(() => expect(screen.queryByText("正在读取记牌器状态")).not.toBeInTheDocument());

    expect(container.querySelector(".desktop-frame > .app-shell.view-home")).toBeInTheDocument();
    expect(container.querySelector(".sidebar-window-controls")).not.toBeInTheDocument();
    expect(screen.getByText("炉石记牌器")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "首页" })).toBeInTheDocument();

    await openWorkbench();
    expect(screen.getByLabelText("当前对局概览")).toHaveTextContent("牌库剩余23 / 30已抽7对手已出0当前状态监听中");

    fireEvent.click(screen.getByRole("button", { name: "悬浮窗设置" }));
    expect(await screen.findByRole("heading", { name: "设置", level: 1 })).toBeInTheDocument();
    expect(container.querySelector(".desktop-frame > .app-sidebar + .app-shell .settings-page-settings")).toBeInTheDocument();
    expect(container.querySelector(".settings-window, .settings-section-nav")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "悬浮窗设置" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "悬浮窗设置" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "基础设置" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "悬浮窗" })).not.toBeInTheDocument();
  });

  it("opens deck tools as a first-level route and keeps both import flows on the page", async () => {
    const scanCollectionDecks = vi.fn(async () => ({
      status: "ok" as const,
      decks: [{
        id: "deck-1",
        name: "标准法师",
        heroClass: "法师",
        cardCount: 30,
        sourcePath: "/Users/test/Decks.log",
        updatedAt: "2026-07-22T08:00:00.000Z",
        warnings: []
      }]
    }));
    const importDeck = vi.fn(async () => trackerState);
    const importCollectionDeck = vi.fn(async () => trackerState);
    window.hearthstoneTracker = {
      discoverLogs: vi.fn(async () => []),
      getState: vi.fn(async () => trackerState),
      onUpdate: vi.fn(() => () => undefined),
      getTrackerSettings: vi.fn(async () => settings),
      scanCollectionDecks,
      importDeck,
      importCollectionDeck
    } as unknown as typeof window.hearthstoneTracker;

    const { container } = render(<App />);
    await waitFor(() => expect(screen.queryByText("正在读取记牌器状态")).not.toBeInTheDocument());

    await openWorkbench();
    fireEvent.click(screen.getByRole("button", { name: "卡组工具" }));
    expect(screen.getByRole("button", { name: "卡组工具" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "卡组工具", level: 1 })).toBeInTheDocument();
    expect(container.querySelector(".deck-tools-page")).toBeInTheDocument();
    expect(container.querySelector(".modal-backdrop, .modal")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "卡组代码或卡牌列表" }), {
      target: { value: "2x 火球术" }
    });
    fireEvent.click(screen.getByRole("button", { name: "导入当前内容" }));
    await waitFor(() => expect(importDeck).toHaveBeenCalledWith("2x 火球术"));
    expect(screen.getByRole("heading", { name: "卡组工具", level: 1 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "从收藏读取" }));
    expect(await screen.findByText("标准法师")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导入" }));
    await waitFor(() => expect(importCollectionDeck).toHaveBeenCalledWith("deck-1"));
    expect(container.querySelector(".modal-backdrop, .modal")).not.toBeInTheDocument();
  });
});
