import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";
import { DEFAULT_TRACKER_SETTINGS } from "../src/main/trackerSettingsStore";
import { createPublicTrackerState } from "./fixtures/publicTrackerState";

const trackerState = createPublicTrackerState({
  status: "watching",
  gameActive: false,
  deck: [],
  events: [],
  summary: { totalCards: 0, remainingCards: 0, drawnCards: 0, opponentPlayedCount: 0 }
});

afterEach(() => {
  delete window.hearthstoneTracker;
});

function installApi() {
  window.hearthstoneTracker = {
    discoverLogs: vi.fn(async () => []),
    getState: vi.fn(async () => trackerState),
    onUpdate: vi.fn(() => () => undefined),
    getTrackerSettings: vi.fn(async () => structuredClone(DEFAULT_TRACKER_SETTINGS))
  } as unknown as typeof window.hearthstoneTracker;
}

describe("home and workbench navigation", () => {
  it("opens the secondary workbench from the home gear and returns home", async () => {
    installApi();
    render(<App />);

    await waitFor(() => expect(screen.getByRole("region", { name: "首页" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "关闭工作台，返回首页" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开二级工作台" }));

    expect(await screen.findByRole("button", { name: "关闭工作台，返回首页" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "实时对局" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "首页" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭工作台，返回首页" }));
    expect(await screen.findByRole("region", { name: "首页" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "关闭工作台，返回首页" })).not.toBeInTheDocument();
  });
});
