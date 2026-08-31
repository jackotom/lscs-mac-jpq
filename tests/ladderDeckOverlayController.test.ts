import { describe, expect, it, vi } from "vitest";
import { LadderDeckOverlayController, resolveLadderDeckMode } from "../src/main/ladderDeckOverlayController";
import type { PublicTrackerState } from "../src/shared/types";
import { createPublicTrackerState } from "./fixtures/publicTrackerState";

function state(
  overrides: Parameters<typeof createPublicTrackerState>[0] = {}
): PublicTrackerState {
  return createPublicTrackerState({
    status: "watching",
    deck: [],
    events: [],
    summary: { totalCards: 0, remainingCards: 0, drawnCards: 0, opponentPlayedCount: 0 },
    ...overrides
  });
}

describe("LadderDeckOverlayController", () => {
  it("invalidates an in-flight refresh when stopped", async () => {
    let resolveFrontmost!: (value: string) => void;
    const frontmost = new Promise<string>((resolve) => {
      resolveFrontmost = resolve;
    });
    const createWindow = vi.fn(async () => undefined);
    const updateMode = vi.fn(async () => undefined);
    const showInactive = vi.fn();
    const controller = new LadderDeckOverlayController({
      getState: () => state({ constructedScreenMode: "standard" }),
      getFrontmostAppName: () => frontmost,
      hasWindow: () => false,
      isVisible: () => false,
      createWindow,
      updateMode,
      showInactive,
      hide: vi.fn()
    });

    const refresh = controller.refresh();
    controller.stop();
    resolveFrontmost("Hearthstone");
    await refresh;

    expect(createWindow).not.toHaveBeenCalled();
    expect(updateMode).not.toHaveBeenCalled();
    expect(showInactive).not.toHaveBeenCalled();
  });

  it("ignores a window-creation rejection caused by stopping the refresh", async () => {
    let rejectCreation!: (error: Error) => void;
    const creation = new Promise<void>((_resolve, reject) => {
      rejectCreation = reject;
    });
    const createWindow = vi.fn(() => creation);
    const controller = new LadderDeckOverlayController({
      getState: () => state({ constructedScreenMode: "standard" }),
      getFrontmostAppName: async () => "Hearthstone",
      hasWindow: () => false,
      isVisible: () => false,
      createWindow,
      updateMode: vi.fn(async () => undefined),
      showInactive: vi.fn(),
      hide: vi.fn()
    });

    const refresh = controller.refresh();
    await vi.waitFor(() => expect(createWindow).toHaveBeenCalledOnce());
    controller.stop();
    rejectCreation(new Error("window destroyed during load"));

    await expect(refresh).resolves.toBeUndefined();
  });

  it("does not let a stopped creation close a replacement window", async () => {
    let finishCreation!: () => void;
    let windowIdentity: "none" | "old" | "replacement" = "none";
    const creation = new Promise<void>((resolve) => {
      finishCreation = () => {
        windowIdentity = "old";
        resolve();
      };
    });
    const hide = vi.fn(() => {
      windowIdentity = "none";
    });
    const createWindow = vi.fn(() => creation);
    const controller = new LadderDeckOverlayController({
      getState: () => state({ constructedScreenMode: "standard" }),
      getFrontmostAppName: async () => "Hearthstone",
      hasWindow: () => windowIdentity !== "none",
      isVisible: () => windowIdentity !== "none",
      createWindow,
      updateMode: vi.fn(async () => undefined),
      showInactive: vi.fn(),
      hide
    });

    const refresh = controller.refresh();
    await vi.waitFor(() => expect(createWindow).toHaveBeenCalledOnce());
    controller.stop();
    windowIdentity = "replacement";
    finishCreation();
    windowIdentity = "replacement";
    await refresh;

    expect(windowIdentity).toBe("replacement");
    expect(hide).not.toHaveBeenCalled();
  });

  it("resolves only constructed standard and wild contexts", () => {
    expect(resolveLadderDeckMode(state({ constructedScreenMode: "standard" }))).toBe("standard");
    expect(resolveLadderDeckMode(state({ constructedScreenMode: "wild" }))).toBe("wild");
    expect(resolveLadderDeckMode(state({ constructedScreenMode: "casual" }))).toBeUndefined();
    expect(resolveLadderDeckMode(state({ constructedScreenMode: "standard", arena: { status: "drafting", draftCount: 0, unresolvedCount: 30, currentChoices: [], picks: [], deck: [] } }))).toBeUndefined();
    expect(resolveLadderDeckMode(state())).toBeUndefined();
  });

  it("creates, refreshes and shows the matching recommendation without focusing", async () => {
    const showInactive = vi.fn();
    const updateMode = vi.fn(async () => undefined);
    const create = vi.fn(async () => undefined);
    const controller = new LadderDeckOverlayController({
      getState: () => state({ constructedScreenMode: "standard" }),
      getFrontmostAppName: async () => "Hearthstone",
      hasWindow: () => false,
      isVisible: () => false,
      createWindow: create,
      updateMode,
      showInactive,
      hide: vi.fn()
    });

    await controller.refresh();

    expect(create).toHaveBeenCalledOnce();
    expect(updateMode).toHaveBeenCalledWith("standard");
    expect(showInactive).toHaveBeenCalledOnce();
  });

  it("hides outside Hearthstone and in unsupported contexts", async () => {
    let currentState = state({ constructedScreenMode: "wild" });
    let frontmost = "Hearthstone";
    const hide = vi.fn();
    const controller = new LadderDeckOverlayController({
      getState: () => currentState,
      getFrontmostAppName: async () => frontmost,
      hasWindow: () => true,
      isVisible: () => true,
      createWindow: vi.fn(),
      updateMode: vi.fn(),
      showInactive: vi.fn(),
      hide
    });

    frontmost = "Finder";
    await controller.refresh();
    currentState = state();
    frontmost = "Hearthstone";
    await controller.refresh();

    expect(hide).toHaveBeenCalledTimes(2);
  });

  it("keeps the recommendation visible while the tracker itself is frontmost after dragging", async () => {
    const hide = vi.fn();
    const controller = new LadderDeckOverlayController({
      getState: () => state({ constructedScreenMode: "standard" }),
      getFrontmostAppName: async () => "炉石记牌器",
      hasWindow: () => true,
      isVisible: () => true,
      isAnyOverlayFocused: () => false,
      isAnyOverlayInteractionActive: () => false,
      createWindow: vi.fn(),
      updateMode: vi.fn(),
      showInactive: vi.fn(),
      hide
    });

    await controller.refresh();

    expect(hide).not.toHaveBeenCalled();
  });

  it("does not let an older mode refresh show over a newer mode", async () => {
    let currentState = state({ constructedScreenMode: "standard" });
    let release!: () => void;
    const updateMode = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const showInactive = vi.fn();
    const controller = new LadderDeckOverlayController({
      getState: () => currentState,
      getFrontmostAppName: async () => "Hearthstone",
      hasWindow: () => true,
      isVisible: () => false,
      createWindow: vi.fn(),
      updateMode,
      showInactive,
      hide: vi.fn()
    });

    const pending = controller.refresh();
    await vi.waitFor(() => expect(updateMode).toHaveBeenCalledWith("standard"));
    currentState = state({ constructedScreenMode: "wild" });
    release();
    await pending;

    expect(showInactive).not.toHaveBeenCalled();
  });

  it("does not show when Hearthstone loses focus during refresh", async () => {
    let calls = 0;
    const showInactive = vi.fn();
    const controller = new LadderDeckOverlayController({
      getState: () => state({ constructedScreenMode: "standard" }),
      getFrontmostAppName: async () => ++calls === 1 ? "Hearthstone" : "Finder",
      hasWindow: () => true,
      isVisible: () => false,
      createWindow: vi.fn(),
      updateMode: vi.fn(async () => undefined),
      showInactive,
      hide: vi.fn()
    });
    await controller.refresh();
    expect(showInactive).not.toHaveBeenCalled();
  });

  it("keeps a manual close suppressed until the mode changes", async () => {
    let current = state({ constructedScreenMode: "standard" });
    const createWindow = vi.fn(async () => undefined);
    const controller = new LadderDeckOverlayController({
      getState: () => current,
      getFrontmostAppName: async () => "Hearthstone",
      hasWindow: () => false,
      isVisible: () => false,
      createWindow,
      updateMode: vi.fn(async () => undefined),
      showInactive: vi.fn(),
      hide: vi.fn()
    });
    controller.suppressCurrentMode();
    await controller.refresh();
    expect(createWindow).not.toHaveBeenCalled();
    current = state({ constructedScreenMode: "wild" });
    await controller.refresh();
    expect(createWindow).toHaveBeenCalledOnce();
  });
});
