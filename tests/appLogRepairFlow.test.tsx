import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";
import type { PublicTrackerState } from "../src/shared/types";
import { createPublicTrackerState } from "./fixtures/publicTrackerState";
import { openWorkbench } from "./helpers/openWorkbench";

const emptySummary = {
  totalCards: 0,
  remainingCards: 0,
  drawnCards: 0,
  opponentPlayedCount: 0
};

afterEach(() => {
  window.history.replaceState({}, "", "/");
  delete window.hearthstoneTracker;
});

function installApi(state: PublicTrackerState) {
  const ensureLogConfig = vi.fn(async () => ({
    path: "/Users/test/Library/Preferences/Blizzard/Hearthstone/log.config",
    exists: true,
    hasPowerLog: true,
    hasZoneLog: true,
    hasDecksLog: true,
    hasArenaLog: true
  }));
  window.hearthstoneTracker = {
    discoverLogs: vi.fn(async () => []),
    getState: vi.fn(async () => state),
    onUpdate: vi.fn(() => () => undefined),
    ensureLogConfig
  } as unknown as typeof window.hearthstoneTracker;
  return { ensureLogConfig };
}

describe("log repair guidance", () => {
  it("keeps a waiting watching state in tracking mode even when Player.log is the current path", async () => {
    installApi(createPublicTrackerState({
      status: "watching",
      gameActive: false,
      logPath: "/Users/test/Logs/Player.log",
      deck: [],
      events: [],
      summary: emptySummary
    }));

    render(<App />);
    await openWorkbench();

    expect(await screen.findByRole("button", { name: "暂停" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "开始" })).not.toBeInTheDocument();
    expect(screen.queryByText("只有 Player.log")).not.toBeInTheDocument();
  });

  it("shows one repair instruction and replaces it with visible restart guidance after repair", async () => {
    const { ensureLogConfig } = installApi(createPublicTrackerState({
      status: "missing-log",
      error: "没有找到可用的 Power.log。",
      deck: [],
      events: [],
      summary: emptySummary
    }));

    render(<App />);
    await openWorkbench();

    const guidance = "先点“修复日志”，完全退出并重新打开炉石，然后进入一局。";
    expect(await screen.findAllByText(guidance)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "修复日志" }));

    expect(await screen.findByText(/日志配置已就绪.*完全退出并重新打开炉石，然后进入一局。/)).toBeInTheDocument();
    expect(screen.queryByText(guidance)).not.toBeInTheDocument();
    expect(screen.queryByText("没有找到可用的 Power.log。")).not.toBeInTheDocument();
    await waitFor(() => expect(ensureLogConfig).toHaveBeenCalledOnce());
  });
});
