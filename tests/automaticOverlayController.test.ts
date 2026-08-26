import { describe, expect, it, vi } from "vitest";
import {
  AutomaticOverlayController,
  resolveAutomaticOverlayContext,
  type AutomaticOverlayHost
} from "../src/main/automaticOverlayController";
import type { PublicTrackerState } from "../src/shared/types";
import { createPublicTrackerState } from "./fixtures/publicTrackerState";

function makeState(
  overrides: Parameters<typeof createPublicTrackerState>[0] = {}
): PublicTrackerState {
  return createPublicTrackerState({
    status: "watching",
    trackerMode: "ladder",
    deck: [],
    events: [],
    summary: { totalCards: 0, remainingCards: 0, drawnCards: 0, opponentPlayedCount: 0 },
    ...overrides
  });
}

function makeHost(initialState: PublicTrackerState) {
  let state = initialState;
  let frontmostAppName: string | undefined = "Hearthstone";
  let overlayExists = false;
  let overlayVisible = false;
  let overlayFocused = false;
  let overlayInteractionActive = false;

  const createOverlayWindow = vi.fn(async () => {
    overlayExists = true;
  });
  const showOverlayWindow = vi.fn(() => {
    overlayVisible = true;
  });
  const hideOverlayWindow = vi.fn(() => {
    overlayVisible = false;
  });

  const host: AutomaticOverlayHost = {
    getState: () => state,
    getFrontmostAppName: async () => frontmostAppName,
    hasOverlayWindow: () => overlayExists,
    isOverlayVisible: () => overlayVisible,
    isOverlayFocused: () => overlayFocused,
    isOverlayInteractionActive: () => overlayInteractionActive,
    createOverlayWindow,
    showOverlayWindow,
    hideOverlayWindow
  };

  return {
    host,
    createOverlayWindow,
    showOverlayWindow,
    hideOverlayWindow,
    setState(nextState: PublicTrackerState) {
      state = nextState;
    },
    setFrontmostAppName(nextName: string | undefined) {
      frontmostAppName = nextName;
    },
    setOverlayFocused(nextFocused: boolean) {
      overlayFocused = nextFocused;
    },
    setOverlayInteractionActive(nextActive: boolean) {
      overlayInteractionActive = nextActive;
    },
    closeOverlayWindow() {
      overlayExists = false;
      overlayVisible = false;
    }
  };
}

describe("AutomaticOverlayController", () => {
  it("re-presents an allowed existing overlay once even when Electron reports it visible", async () => {
    const showInactive = vi.fn();
    const controller = new AutomaticOverlayController({
      getState: () => makeState({ constructedScreenMode: "standard" }),
      getFrontmostAppName: async () => "Hearthstone",
      hasOverlayWindow: () => true,
      isOverlayVisible: () => true,
      isOverlayFocused: () => false,
      createOverlayWindow: vi.fn(),
      showOverlayWindow: showInactive,
      hideOverlayWindow: vi.fn()
    });

    await controller.refresh();
    await controller.refresh();

    expect(showInactive).toHaveBeenCalledOnce();
  });

  it("re-presents both visible overlays without focus when a new game starts", async () => {
    let state = makeState({
      constructedScreenMode: "standard",
      autoMatchedDeckId: "deck-a",
      gameActive: false
    });
    const friendlyShowInactive = vi.fn();
    const opponentShowInactive = vi.fn();
    const makeExistingVisibleHost = (showOverlayWindow: () => void): AutomaticOverlayHost => ({
      getState: () => state,
      getFrontmostAppName: async () => "Hearthstone",
      hasOverlayWindow: () => true,
      isOverlayVisible: () => true,
      isOverlayFocused: () => false,
      createOverlayWindow: vi.fn(),
      showOverlayWindow,
      hideOverlayWindow: vi.fn()
    });
    const friendlyController = new AutomaticOverlayController(
      makeExistingVisibleHost(friendlyShowInactive)
    );
    const opponentController = new AutomaticOverlayController(
      makeExistingVisibleHost(opponentShowInactive)
    );
    await Promise.all([friendlyController.refresh(), opponentController.refresh()]);
    friendlyShowInactive.mockClear();
    opponentShowInactive.mockClear();

    state = { ...state, gameActive: true };
    await Promise.all([friendlyController.refresh(), opponentController.refresh()]);
    await Promise.all([friendlyController.refresh(), opponentController.refresh()]);

    expect(friendlyShowInactive).toHaveBeenCalledOnce();
    expect(opponentShowInactive).toHaveBeenCalledOnce();
  });

  it("uses only the inactive presentation path for an automatic friendly overlay", async () => {
    let overlayExists = false;
    let overlayVisible = false;
    const showInactive = vi.fn(() => {
      overlayVisible = true;
    });
    const show = vi.fn();
    const focus = vi.fn();
    const controller = new AutomaticOverlayController({
      getState: () => makeState({ constructedScreenMode: "standard" }),
      getFrontmostAppName: async () => "Hearthstone",
      hasOverlayWindow: () => overlayExists,
      isOverlayVisible: () => overlayVisible,
      isOverlayFocused: () => false,
      createOverlayWindow: vi.fn(async () => {
        overlayExists = true;
      }),
      showOverlayWindow: showInactive,
      hideOverlayWindow: vi.fn()
    });

    await controller.refresh();

    expect(showInactive).toHaveBeenCalledOnce();
    expect(show).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it("does not create an overlay when its global setting is disabled", async () => {
    const fixture = makeHost(makeState({ constructedScreenMode: "standard" }));
    const controller = new AutomaticOverlayController({
      ...fixture.host,
      isEnabled: () => false
    });

    await controller.refresh();

    expect(fixture.createOverlayWindow).not.toHaveBeenCalled();
    expect(fixture.showOverlayWindow).not.toHaveBeenCalled();
  });

  it("hides an existing overlay as soon as its global switch is disabled", async () => {
    const fixture = makeHost(makeState({ constructedScreenMode: "standard" }));
    let enabled = true;
    const controller = new AutomaticOverlayController({
      ...fixture.host,
      isEnabled: () => enabled
    });
    await controller.refresh();
    enabled = false;

    await controller.refresh();

    expect(fixture.hideOverlayWindow).toHaveBeenCalledOnce();
  });

  it("leaves a manually opened overlay alone while manual detection is enabled", async () => {
    const fixture = makeHost(makeState({ constructedScreenMode: "standard" }));
    let automaticDetection = true;
    const controller = new AutomaticOverlayController({
      ...fixture.host,
      isEnabled: () => automaticDetection,
      shouldHideWhenDisabled: () => false
    });
    await controller.refresh();
    automaticDetection = false;

    await controller.refresh();

    expect(fixture.hideOverlayWindow).not.toHaveBeenCalled();
  });

  it("invalidates an in-flight refresh when stopped", async () => {
    let resolveFrontmost!: (value: string) => void;
    const frontmost = new Promise<string>((resolve) => {
      resolveFrontmost = resolve;
    });
    const fixture = makeHost(makeState({ constructedScreenMode: "standard" }));
    const controller = new AutomaticOverlayController({
      ...fixture.host,
      getFrontmostAppName: () => frontmost
    });

    const refresh = controller.refresh();
    controller.stop();
    resolveFrontmost("Hearthstone");
    await refresh;

    expect(fixture.createOverlayWindow).not.toHaveBeenCalled();
    expect(fixture.showOverlayWindow).not.toHaveBeenCalled();
  });

  it("ignores a window-creation rejection caused by stopping the refresh", async () => {
    let rejectCreation!: (error: Error) => void;
    const creation = new Promise<void>((_resolve, reject) => {
      rejectCreation = reject;
    });
    const fixture = makeHost(makeState({ constructedScreenMode: "standard" }));
    const createOverlayWindow = vi.fn(() => creation);
    const controller = new AutomaticOverlayController({
      ...fixture.host,
      createOverlayWindow
    });

    const refresh = controller.refresh();
    await vi.waitFor(() => expect(createOverlayWindow).toHaveBeenCalledOnce());
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
    const hideOverlayWindow = vi.fn(() => {
      windowIdentity = "none";
    });
    const createOverlayWindow = vi.fn(() => creation);
    const controller = new AutomaticOverlayController({
      getState: () => makeState({ constructedScreenMode: "standard" }),
      getFrontmostAppName: async () => "Hearthstone",
      hasOverlayWindow: () => windowIdentity !== "none",
      isOverlayVisible: () => windowIdentity !== "none",
      isOverlayFocused: () => false,
      createOverlayWindow,
      showOverlayWindow: vi.fn(),
      hideOverlayWindow
    });

    const refresh = controller.refresh();
    await vi.waitFor(() => expect(createOverlayWindow).toHaveBeenCalledOnce());
    controller.stop();
    windowIdentity = "replacement";
    finishCreation();
    windowIdentity = "replacement";
    await refresh;

    expect(windowIdentity).toBe("replacement");
    expect(hideOverlayWindow).not.toHaveBeenCalled();
  });

  it("shows a waiting tracker while Hearthstone is open before the mode is recognized", async () => {
    const fixture = makeHost(makeState({ trackerMode: undefined, gameActive: false }));
    const controller = new AutomaticOverlayController(fixture.host);

    await controller.refresh();

    expect(resolveAutomaticOverlayContext(makeState({ trackerMode: undefined }))).toBe("watching:waiting-for-mode");
    expect(fixture.createOverlayWindow).toHaveBeenCalledTimes(1);
    expect(fixture.showOverlayWindow).toHaveBeenCalledTimes(1);
  });

  it("creates and shows the overlay as soon as a constructed deck is selected", async () => {
    const fixture = makeHost(makeState({
      constructedScreenMode: "standard",
      autoMatchedDeckId: "standard-deck",
      deckName: "标准测试套牌",
      deck: [{ name: "测试牌", count: 2, remaining: 2, drawn: 0, played: 0 }],
      summary: { totalCards: 30, remainingCards: 30, drawnCards: 0, opponentPlayedCount: 0 }
    }));
    const controller = new AutomaticOverlayController(fixture.host);

    await controller.refresh();

    expect(fixture.createOverlayWindow).toHaveBeenCalledTimes(1);
    expect(fixture.showOverlayWindow).toHaveBeenCalledTimes(1);
  });

  it("shows a waiting overlay when the constructed mode is known but the deck is not", async () => {
    const fixture = makeHost(makeState({ constructedScreenMode: "wild" }));
    const controller = new AutomaticOverlayController(fixture.host);

    await controller.refresh();

    expect(fixture.createOverlayWindow).toHaveBeenCalledTimes(1);
    expect(fixture.showOverlayWindow).toHaveBeenCalledTimes(1);
  });

  it("keeps a waiting overlay visible during an active constructed game", async () => {
    const fixture = makeHost(makeState({ gameActive: true }));
    const controller = new AutomaticOverlayController(fixture.host);

    await controller.refresh();

    expect(fixture.createOverlayWindow).toHaveBeenCalledTimes(1);
    expect(fixture.showOverlayWindow).toHaveBeenCalledTimes(1);
  });

  it("hides outside Hearthstone and restores without creating a second window", async () => {
    const fixture = makeHost(makeState({
      constructedScreenMode: "standard",
      autoMatchedDeckId: "deck-a",
      deck: [{ name: "测试牌", count: 2, remaining: 2, drawn: 0, played: 0 }]
    }));
    const controller = new AutomaticOverlayController(fixture.host);
    await controller.refresh();

    fixture.setFrontmostAppName("Finder");
    await controller.refresh();
    fixture.setFrontmostAppName("Hearthstone");
    await controller.refresh();

    expect(fixture.hideOverlayWindow).toHaveBeenCalledTimes(1);
    expect(fixture.createOverlayWindow).toHaveBeenCalledTimes(1);
    expect(fixture.showOverlayWindow).toHaveBeenCalledTimes(2);
  });

  it("keeps the overlay visible while the user resizes or interacts with it", async () => {
    const fixture = makeHost(makeState({
      constructedScreenMode: "wild",
      autoMatchedDeckId: "deck-a",
      deck: [{ name: "测试牌", count: 2, remaining: 2, drawn: 0, played: 0 }]
    }));
    const controller = new AutomaticOverlayController(fixture.host);
    await controller.refresh();

    fixture.setFrontmostAppName("炉石记牌器");
    fixture.setOverlayFocused(true);
    await controller.refresh();
    expect(fixture.hideOverlayWindow).not.toHaveBeenCalled();

    fixture.setOverlayFocused(false);
    fixture.setOverlayInteractionActive(true);
    await controller.refresh();
    expect(fixture.hideOverlayWindow).not.toHaveBeenCalled();

    fixture.setOverlayInteractionActive(false);
    fixture.setFrontmostAppName("Finder");
    await controller.refresh();
    expect(fixture.hideOverlayWindow).toHaveBeenCalledTimes(1);
  });

  it("keeps the overlay visible while the tracker itself is frontmost after dragging", async () => {
    const fixture = makeHost(makeState({ constructedScreenMode: "standard" }));
    const controller = new AutomaticOverlayController(fixture.host);
    await controller.refresh();
    fixture.setFrontmostAppName("炉石记牌器");
    fixture.setOverlayFocused(false);
    fixture.setOverlayInteractionActive(false);

    await controller.refresh();

    expect(fixture.hideOverlayWindow).not.toHaveBeenCalled();
  });

  it("keeps a manual close suppressed until the deck or mode changes", async () => {
    const fixture = makeHost(makeState({
      constructedScreenMode: "standard",
      autoMatchedDeckId: "deck-a",
      deck: [{ name: "测试牌", count: 2, remaining: 2, drawn: 0, played: 0 }]
    }));
    const controller = new AutomaticOverlayController(fixture.host);
    await controller.refresh();

    controller.suppressCurrentContext();
    fixture.closeOverlayWindow();
    await controller.refresh();
    expect(fixture.createOverlayWindow).toHaveBeenCalledTimes(1);

    fixture.setState(makeState({
      constructedScreenMode: "standard",
      autoMatchedDeckId: "deck-b",
      deck: [{ name: "另一张牌", count: 2, remaining: 2, drawn: 0, played: 0 }]
    }));
    await controller.refresh();

    expect(fixture.createOverlayWindow).toHaveBeenCalledTimes(2);
    expect(fixture.showOverlayWindow).toHaveBeenCalledTimes(2);
  });

  it("keeps the same selected deck suppressed when the deck-select screen disappears", async () => {
    const fixture = makeHost(makeState({
      constructedScreenMode: "standard",
      autoMatchedDeckId: "deck-a",
      deck: [{ name: "测试牌", count: 2, remaining: 2, drawn: 0, played: 0 }]
    }));
    const controller = new AutomaticOverlayController(fixture.host);
    await controller.refresh();

    controller.suppressCurrentContext();
    fixture.closeOverlayWindow();
    fixture.setState(makeState({
      autoMatchedDeckId: "deck-a",
      deck: [{ name: "测试牌", count: 2, remaining: 1, drawn: 1, played: 0 }]
    }));
    await controller.refresh();

    expect(fixture.createOverlayWindow).toHaveBeenCalledTimes(1);
    expect(fixture.showOverlayWindow).toHaveBeenCalledTimes(1);
  });

  it("restores a manually closed overlay when the same deck changes mode", async () => {
    const fixture = makeHost(makeState({
      constructedScreenMode: "standard",
      autoMatchedDeckId: "deck-a",
      deck: [{ name: "测试牌", count: 2, remaining: 2, drawn: 0, played: 0 }]
    }));
    const controller = new AutomaticOverlayController(fixture.host);
    await controller.refresh();

    controller.suppressCurrentContext();
    fixture.closeOverlayWindow();
    fixture.setState(makeState({
      constructedScreenMode: "wild",
      autoMatchedDeckId: "deck-a",
      deck: [{ name: "测试牌", count: 2, remaining: 2, drawn: 0, played: 0 }]
    }));
    await controller.refresh();

    expect(fixture.createOverlayWindow).toHaveBeenCalledTimes(2);
    expect(fixture.showOverlayWindow).toHaveBeenCalledTimes(2);
  });

  it("switches to Arena as a new automatic context", async () => {
    const fixture = makeHost(makeState({
      constructedScreenMode: "standard",
      autoMatchedDeckId: "deck-a",
      deck: [{ name: "测试牌", count: 2, remaining: 2, drawn: 0, played: 0 }]
    }));
    const controller = new AutomaticOverlayController(fixture.host);
    await controller.refresh();

    controller.suppressCurrentContext();
    fixture.closeOverlayWindow();
    fixture.setState(makeState({
      trackerMode: "arena",
      arena: { status: "drafting", draftCount: 0, unresolvedCount: 30, currentChoices: [], picks: [], deck: [] }
    }));
    await controller.refresh();

    expect(fixture.createOverlayWindow).toHaveBeenCalledTimes(2);
    expect(fixture.showOverlayWindow).toHaveBeenCalledTimes(2);
  });

  it("does not let an older refresh reopen a newly suppressed context", async () => {
    let state = makeState({
      constructedScreenMode: "standard",
      autoMatchedDeckId: "deck-a",
      deck: [{ name: "套牌 A", count: 2, remaining: 2, drawn: 0, played: 0 }]
    });
    let resolveFrontmost: ((name: string | undefined) => void) | undefined;
    const frontmost = new Promise<string | undefined>((resolve) => {
      resolveFrontmost = resolve;
    });
    const createOverlayWindow = vi.fn(async () => undefined);
    const showOverlayWindow = vi.fn();
    const controller = new AutomaticOverlayController({
      getState: () => state,
      getFrontmostAppName: () => frontmost,
      hasOverlayWindow: () => false,
      isOverlayVisible: () => false,
      isOverlayFocused: () => false,
      createOverlayWindow,
      showOverlayWindow,
      hideOverlayWindow: vi.fn()
    });

    const refresh = controller.refresh();
    state = makeState({
      constructedScreenMode: "standard",
      autoMatchedDeckId: "deck-b",
      deck: [{ name: "套牌 B", count: 2, remaining: 2, drawn: 0, played: 0 }]
    });
    controller.suppressCurrentContext();
    resolveFrontmost?.("Hearthstone");
    await refresh;

    expect(createOverlayWindow).not.toHaveBeenCalled();
    expect(showOverlayWindow).not.toHaveBeenCalled();
  });
});
