import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";
import { DEFAULT_TRACKER_SETTINGS } from "../src/main/trackerSettingsStore";
import type { TrackerSettings } from "../src/shared/types";
import { openWorkbench } from "./helpers/openWorkbench";

const trackerState = {
  status: "watching" as const,
  deck: [],
  opponentPlayed: [],
  events: [],
  summary: { totalCards: 0, remainingCards: 0, drawnCards: 0, opponentPlayedCount: 0 }
};

afterEach(() => {
  window.history.replaceState({}, "", "/");
  delete window.hearthstoneTracker;
});

function installApi(options: { failRead?: boolean; failSave?: boolean; blockSaves?: boolean } = {}) {
  let persisted: TrackerSettings = structuredClone(DEFAULT_TRACKER_SETTINGS);
  let openSettings: (() => void) | undefined;
  const saveReleases: Array<() => void> = [];
  window.hearthstoneTracker = {
    discoverLogs: vi.fn(async () => []),
    getState: vi.fn(async () => trackerState),
    onUpdate: vi.fn(() => () => undefined),
    getTrackerSettings: vi.fn(async () => {
      if (options.failRead) throw new Error("无法读取已保存设置");
      return persisted;
    }),
    setTrackerSettings: vi.fn(async (next: TrackerSettings) => {
      if (options.failSave) throw new Error("设置保存失败");
      if (options.blockSaves) {
        await new Promise<void>((resolve) => { saveReleases.push(resolve); });
      }
      persisted = next;
      return persisted;
    }),
    restoreDefaultSettings: vi.fn(async () => {
      persisted = structuredClone(DEFAULT_TRACKER_SETTINGS);
      return persisted;
    }),
    openLogFolder: vi.fn(async () => undefined),
    refreshCardDatabase: vi.fn(async () => ({ status: "updated" as const, cardCount: 321, warnings: [] })),
    onOpenSettings: vi.fn((callback: () => void) => {
      openSettings = callback;
      return () => undefined;
    })
  } as unknown as typeof window.hearthstoneTracker;
  return {
    show: () => act(() => openSettings?.()),
    getPersisted: () => persisted,
    releaseNextSave: () => saveReleases.shift()?.()
  };
}

async function openSettingsPage(): Promise<void> {
  await openWorkbench();
  fireEvent.click(await screen.findByRole("button", { name: "插件与其他设置" }));
}

describe("settings API round trip", () => {
  it("uses the trusted overlay API when the gear is clicked", async () => {
    window.history.replaceState({}, "", "/?overlay=1");
    const openSettings = vi.fn(async () => true);
    window.hearthstoneTracker = {
      getState: vi.fn(async () => trackerState),
      onUpdate: vi.fn(() => () => undefined),
      openSettings
    } as unknown as typeof window.hearthstoneTracker;

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "打开软件设置" }));
    expect(openSettings).toHaveBeenCalledOnce();
  });

  it("loads, persists, reflects the saved value, and reloads it after reopening", async () => {
    const api = installApi();
    render(<App />);
    await waitFor(() => expect(window.hearthstoneTracker?.getState).toHaveBeenCalled());

    await openSettingsPage();
    expect(await screen.findByRole("heading", { name: "设置", level: 1 })).toHaveFocus();
    const friendlySwitch = await screen.findByRole("switch", { name: /我方卡牌记牌器/ });
    expect(friendlySwitch).toHaveAttribute("aria-checked", "true");

    fireEvent.click(friendlySwitch);
    await waitFor(() => expect(friendlySwitch).toHaveAttribute("aria-checked", "false"));
    expect(api.getPersisted().ladder.friendlyDeckTracker).toBe(false);
    expect(api.getPersisted().arena.friendlyDeckTracker).toBe(false);
    expect(window.hearthstoneTracker?.setTrackerSettings).toHaveBeenCalledWith(api.getPersisted());

    fireEvent.click(screen.getByRole("button", { name: "关闭工作台，返回首页" }));
    await openSettingsPage();
    expect(await screen.findByRole("switch", { name: /我方卡牌记牌器/ })).toHaveAttribute("aria-checked", "false");
    expect(window.hearthstoneTracker?.getTrackerSettings).toHaveBeenCalledTimes(3);
  });

  it("reports read and save failures without pretending the switch changed", async () => {
    installApi({ failRead: true });
    const first = render(<App />);
    await openSettingsPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("无法读取已保存设置");
    first.unmount();

    installApi({ failSave: true });
    render(<App />);
    await openSettingsPage();
    const friendlySwitch = await screen.findByRole("switch", { name: /我方卡牌记牌器/ });
    fireEvent.click(friendlySwitch);
    expect(await screen.findByRole("alert")).toHaveTextContent("设置保存失败");
    expect(friendlySwitch).toHaveAttribute("aria-checked", "true");
  });

  it("keeps sliders interactive and persists the latest of 40 rapid changes", async () => {
    const api = installApi({ blockSaves: true });
    render(<App />);
    await openSettingsPage();
    const zoom = await screen.findByRole("slider", { name: "界面缩放" });

    for (let value = 81; value <= 120; value += 1) {
      fireEvent.change(zoom, { target: { value: String(value) } });
    }

    expect(zoom).not.toBeDisabled();
    expect(zoom).toHaveValue("120");
    expect(window.hearthstoneTracker?.setTrackerSettings).toHaveBeenCalledTimes(1);

    api.releaseNextSave();
    await waitFor(() => expect(window.hearthstoneTracker?.setTrackerSettings).toHaveBeenCalledTimes(2));
    expect(zoom).not.toBeDisabled();
    expect(zoom).toHaveValue("120");

    api.releaseNextSave();
    await waitFor(() => expect(api.getPersisted().appearance.zoom).toBe(120));
    expect(zoom).toHaveValue("120");
  });

  it("wires the three maintenance actions and reports successful completion", async () => {
    installApi();
    render(<App />);
    await openSettingsPage();
    expect(await screen.findByRole("heading", { name: "其他设置" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开日志目录" }));
    expect(await screen.findByText("已打开日志目录。")).toBeInTheDocument();
    expect(window.hearthstoneTracker?.openLogFolder).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "更新卡牌库" }));
    expect(await screen.findByText("卡牌库已更新，共 321 张。")).toBeInTheDocument();
    expect(window.hearthstoneTracker?.refreshCardDatabase).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "恢复默认设置" }));
    expect(await screen.findByText("已恢复默认设置。")).toBeInTheDocument();
    expect(window.hearthstoneTracker?.restoreDefaultSettings).toHaveBeenCalledOnce();
  });
});
