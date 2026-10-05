import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TrackerOverlayEntry from "../src/renderer/TrackerOverlayEntry";
import UtilityOverlayEntry from "../src/renderer/UtilityOverlayEntry";
import { useDisplayState } from "../src/renderer/useDisplayState";
import { createPublicTrackerState } from "./fixtures/publicTrackerState";

afterEach(() => { window.history.replaceState({}, "", "/"); delete window.hearthstoneTracker; });

describe("production window entries", () => {
  it("audit regression: resubscribes the recommendation window when its mode changes", async () => {
    const getLadderDeckRecommendation = vi.fn(async () => ({ status: "unavailable" as const, message: "暂无数据" }));
    window.history.replaceState({}, "", "/?ladder-deck-overlay=1&mode=standard");
    window.hearthstoneTracker = {
      getLadderDeckRecommendation, onLadderDeckRecommendationUpdate: vi.fn(() => () => undefined),
      copyLadderDeckCode: vi.fn(async () => undefined), closeLadderDeckOverlay: vi.fn(async () => undefined)
    } as unknown as typeof window.hearthstoneTracker;
    render(<UtilityOverlayEntry />);
    await act(async () => { await Promise.resolve(); });
    window.history.pushState({}, "", "/?ladder-deck-overlay=1&mode=wild");
    await act(async () => { window.dispatchEvent(new PopStateEvent("popstate")); await Promise.resolve(); });
    expect(getLadderDeckRecommendation).toHaveBeenCalledWith("wild");
  });

  it("audit regression: accepts a valid initial snapshot after an invalid live update", async () => {
    let publish!: (state: unknown) => void;
    let resolveInitial!: (state: ReturnType<typeof createPublicTrackerState>) => void;
    const initial = new Promise<ReturnType<typeof createPublicTrackerState>>((resolve) => { resolveInitial = resolve; });
    window.hearthstoneTracker = {
      getState: vi.fn(() => initial), onUpdate: vi.fn((callback: (state: unknown) => void) => { publish = callback; return () => undefined; })
    } as unknown as typeof window.hearthstoneTracker;
    function Probe() { const state = useDisplayState(); return <span>{state?.deckName ?? "empty"}</span>; }
    render(<Probe />);
    act(() => publish({ deck: [null] }));
    await act(async () => resolveInitial(createPublicTrackerState({ deckName: "合法初始套牌" })));
    expect(await screen.findByText("合法初始套牌")).toBeInTheDocument();
  });

  it("audit regression: ignores a delayed collapse snapshot after a live collapse update", async () => {
    let publish!: (collapsed: boolean) => void;
    let resolveSnapshot!: (collapsed: boolean) => void;
    window.history.replaceState({}, "", "/?opponent-overlay=1");
    window.hearthstoneTracker = {
      getState: vi.fn(async () => createPublicTrackerState()), onUpdate: vi.fn(() => () => undefined),
      getOpponentOverlayCollapsed: vi.fn(() => new Promise<boolean>((resolve) => { resolveSnapshot = resolve; })),
      onOpponentOverlayCollapsedChange: vi.fn((callback: (collapsed: boolean) => void) => { publish = callback; return () => undefined; }),
      setOpponentOverlayCollapsed: vi.fn(async (value: boolean) => value)
    } as unknown as typeof window.hearthstoneTracker;
    render(<TrackerOverlayEntry />);
    await act(async () => { await Promise.resolve(); });
    act(() => publish(true));
    await screen.findByLabelText("恢复对手记牌小窗");
    await act(async () => resolveSnapshot(false));
    expect(screen.getByLabelText("恢复对手记牌小窗")).toBeInTheDocument();
  });
});
