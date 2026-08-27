import { describe, expect, it, vi } from "vitest";
import {
  shouldRunBoardAttackOverlayMonitor,
  presentMainWindow,
  shouldFocusMainWindowOnLaunch,
  shouldHandleAppActivate,
  shouldPreventAutomatedCaptureClose,
  shouldShowMainWindowOnLaunch
} from "../src/main/mainWindowVisibility";

const qaOverlayCaptureFlags = [
  "QA_OPEN_OVERLAY",
  "QA_OPEN_OPPONENT_OVERLAY",
  "QA_OPEN_ARENA_CHOICE_OVERLAY",
  "QA_OPEN_LADDER_DECK_OVERLAY",
  "QA_OPEN_BOARD_ATTACK_OVERLAY",
  "QA_OPEN_FRIENDLY_ATTACK_OVERLAY",
  "QA_OPEN_OPPONENT_ATTACK_OVERLAY",
  "QA_OPEN_FRIENDLY_HEALTH_OVERLAY",
  "QA_OPEN_OPPONENT_HEALTH_OVERLAY",
  "QA_OPEN_SECRET_OVERLAY",
  "QA_OPEN_SMART_COUNTER_OVERLAY",
  "QA_OPEN_ARENA_HERO_RANKING_OVERLAY",
  "QA_OPEN_THREE_WINDOW_LAYOUT"
] as const;

describe("main window launch visibility", () => {
  it.each(qaOverlayCaptureFlags)("does not run the production auxiliary-overlay monitor during %s", (flag) => {
    expect(shouldRunBoardAttackOverlayMonitor({ [flag]: "1" }, true)).toBe(false);
  });

  it("runs the production auxiliary-overlay monitor only when a normal launch enables one", () => {
    expect(shouldRunBoardAttackOverlayMonitor({}, true)).toBe(true);
    expect(shouldRunBoardAttackOverlayMonitor({}, false)).toBe(false);
  });

  it("shows a normal launch for a new user", () => {
    expect(shouldShowMainWindowOnLaunch({})).toBe(true);
  });

  it("keeps a normal launch in the background when start minimized is enabled", () => {
    expect(shouldShowMainWindowOnLaunch({}, true)).toBe(false);
  });

  it("shows the main window for a main-window QA screenshot", () => {
    expect(shouldShowMainWindowOnLaunch({ QA_SCREENSHOT_PATH: "/tmp/main.png", QA_EXIT_AFTER_SCREENSHOT: "1" })).toBe(true);
  });

  it("never steals focus while an automated screenshot is running", () => {
    expect(shouldFocusMainWindowOnLaunch({}, true)).toBe(true);
    expect(shouldFocusMainWindowOnLaunch({
      QA_SCREENSHOT_PATH: "/tmp/main.png",
      QA_EXIT_AFTER_SCREENSHOT: "1"
    }, true)).toBe(false);
    expect(shouldFocusMainWindowOnLaunch({
      QA_INSPECT_PATH: "/tmp/main.json",
      QA_EXIT_AFTER_SCREENSHOT: "1"
    }, true)).toBe(false);
  });

  it("protects an automated screenshot window until application shutdown", () => {
    const captureEnvironment = {
      QA_SCREENSHOT_PATH: "/tmp/main.png",
      QA_EXIT_AFTER_SCREENSHOT: "1"
    };

    expect(shouldPreventAutomatedCaptureClose(captureEnvironment, false)).toBe(true);
    expect(shouldPreventAutomatedCaptureClose(captureEnvironment, true)).toBe(false);
    expect(shouldPreventAutomatedCaptureClose({}, false)).toBe(false);
  });

  it("keeps the main window hidden when QA is capturing an overlay", () => {
    expect(shouldShowMainWindowOnLaunch({
      QA_SCREENSHOT_PATH: "/tmp/overlay.png",
      QA_EXIT_AFTER_SCREENSHOT: "1",
      QA_OPEN_OVERLAY: "1"
    })).toBe(false);
  });

  it("keeps the main window hidden when QA is capturing the board-attack overlay", () => {
    expect(shouldShowMainWindowOnLaunch({
      QA_SCREENSHOT_PATH: "/tmp/board-attack.png",
      QA_EXIT_AFTER_SCREENSHOT: "1",
      QA_OPEN_BOARD_ATTACK_OVERLAY: "1"
    })).toBe(false);
  });

  it.each([
    "QA_OPEN_FRIENDLY_ATTACK_OVERLAY",
    "QA_OPEN_OPPONENT_ATTACK_OVERLAY",
    "QA_OPEN_FRIENDLY_HEALTH_OVERLAY",
    "QA_OPEN_OPPONENT_HEALTH_OVERLAY",
    "QA_OPEN_SECRET_OVERLAY",
    "QA_OPEN_SMART_COUNTER_OVERLAY"
  ])("keeps the main window hidden when QA is capturing %s", (flag) => {
    expect(shouldShowMainWindowOnLaunch({
      QA_SCREENSHOT_PATH: "/tmp/auxiliary-overlay.png",
      QA_EXIT_AFTER_SCREENSHOT: "1",
      [flag]: "1"
    })).toBe(false);
  });

  it("keeps the main window hidden when QA is capturing the ladder recommendation overlay", () => {
    expect(shouldShowMainWindowOnLaunch({
      QA_SCREENSHOT_PATH: "/tmp/ladder.png",
      QA_EXIT_AFTER_SCREENSHOT: "1",
      QA_OPEN_LADDER_DECK_OVERLAY: "1"
    })).toBe(false);
  });

  it("keeps the main window hidden when QA is capturing the Arena hero ranking", () => {
    expect(shouldShowMainWindowOnLaunch({
      QA_SCREENSHOT_PATH: "/tmp/hero-ranking.png",
      QA_EXIT_AFTER_SCREENSHOT: "1",
      QA_OPEN_ARENA_HERO_RANKING_OVERLAY: "1"
    })).toBe(false);
  });

  it("keeps the main window hidden when QA is capturing the three-window layout", () => {
    expect(shouldShowMainWindowOnLaunch({
      QA_SCREENSHOT_PATH: "/tmp/three-window-layout.png",
      QA_EXIT_AFTER_SCREENSHOT: "1",
      QA_OPEN_THREE_WINDOW_LAYOUT: "1"
    })).toBe(false);
  });

  it("ignores the launch activate event and handles later user activation", () => {
    expect(shouldHandleAppActivate(false, false, 10_000, 9_000)).toBe(false);
    expect(shouldHandleAppActivate(true, false, 8_999, 9_000)).toBe(false);
    expect(shouldHandleAppActivate(true, false, 9_000, 9_000)).toBe(true);
    expect(shouldHandleAppActivate(true, true, 1_000, 9_000)).toBe(true);
  });

  it("never raises the main window during an overlay-only QA capture", () => {
    expect(shouldHandleAppActivate(true, true, 10_000, 9_000, true)).toBe(false);
  });

  it("shows inactive without calling either focus API when focus on open is disabled", () => {
    const calls: string[] = [];
    const window = {
      isMinimized: () => true,
      restore: () => calls.push("restore"),
      show: () => calls.push("show"),
      showInactive: () => calls.push("showInactive"),
      focus: () => calls.push("focus")
    };
    const focusApplication = vi.fn(() => calls.push("app.focus"));

    presentMainWindow(window, false, focusApplication);

    expect(calls).toEqual(["restore", "showInactive"]);
    expect(focusApplication).not.toHaveBeenCalled();
  });

  it("brings the window forward once when focus on open is enabled", () => {
    const calls: string[] = [];
    const window = {
      isMinimized: () => false,
      restore: () => calls.push("restore"),
      show: () => calls.push("show"),
      showInactive: () => calls.push("showInactive"),
      focus: () => calls.push("focus")
    };

    presentMainWindow(window, true, () => calls.push("app.focus"));

    expect(calls).toEqual(["app.focus", "show", "focus"]);
  });
});
