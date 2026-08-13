import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";
import { DEFAULT_TRACKER_SETTINGS } from "../src/main/trackerSettingsStore";
import { createPublicTrackerState } from "./fixtures/publicTrackerState";

const conflictingState = createPublicTrackerState({
  status: "watching",
  gameActive: true,
  deckName: "学徒猎人",
  deckIdentity: {
    status: "confirmed",
    source: "decks-log",
    deckId: "qa-conflicting-deck",
    observedDistinctCards: 4,
    candidateCount: 1,
    bestScore: 1,
    scoreLead: 1
  }
});

afterEach(() => {
  delete window.hearthstoneTracker;
  window.history.replaceState({}, "", "/");
});

describe("home QA demo", () => {
  it("stays isolated from the live tracker state", async () => {
    window.history.replaceState({}, "", "/?qa-home-demo=1");
    const getState = vi.fn(async () => conflictingState);
    const discoverLogs = vi.fn(async () => []);
    const onUpdate = vi.fn(() => () => undefined);
    window.hearthstoneTracker = {
      getState,
      discoverLogs,
      onUpdate,
      getTrackerSettings: vi.fn(async () => structuredClone(DEFAULT_TRACKER_SETTINGS))
    } as unknown as typeof window.hearthstoneTracker;

    const { container } = render(<App />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByRole("region", { name: "首页" })).toHaveTextContent("冰霜法");
    expect(screen.queryByText("学徒猎人")).not.toBeInTheDocument();
    expect(screen.queryByText("炉石已确认这套牌")).not.toBeInTheDocument();
    expect(getState).not.toHaveBeenCalled();
    expect(discoverLogs).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(
      [...container.querySelectorAll("img")]
        .map((image) => image.getAttribute("src") ?? "")
        .filter((source) => /^https?:/u.test(source) && new URL(source).hostname !== "localhost")
    ).toEqual([]);
  });
});
