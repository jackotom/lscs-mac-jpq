import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  configureBoardAttackOverlayWindow,
  getBoardAttackIconBounds,
  getBoardAttackOverlayQuery,
  getBoardAttackOverlayWindowOptions,
  getSecretOverlayBounds,
  setAuxiliaryOverlayMouseInteractive,
  shouldShowBoardAttackOverlay
} from "../src/main/boardAttackOverlay";

describe("board attack overlay", () => {
  it("places compact 44px icons at the confirmed HDT percentages", () => {
    const display = { x: 100, y: 50, width: 2000, height: 1000 };

    expect(getBoardAttackIconBounds(display)).toEqual({
      opponent: { x: 610, y: 274, width: 44, height: 44 },
      friendly: { x: 610, y: 726, width: 44, height: 44 }
    });
  });

  it("shows only for an active game while Hearthstone is frontmost", () => {
    expect(shouldShowBoardAttackOverlay(true, "Hearthstone")).toBe(true);
    expect(shouldShowBoardAttackOverlay(false, "Hearthstone")).toBe(false);
    expect(shouldShowBoardAttackOverlay(true, "ChatGPT")).toBe(false);
  });

  it("sizes the secret helper as a compact one-column Firestone-style panel", () => {
    const display = { x: 0, y: 0, width: 1470, height: 956 };

    expect(getSecretOverlayBounds(display, [10])).toMatchObject({ x: 384, width: 144, height: 190 });
    expect(getSecretOverlayBounds(display, [1, 1])).toMatchObject({ x: 384, width: 144, height: 82 });
    expect(getSecretOverlayBounds(display, [10, 10])).toMatchObject({ x: 384, width: 144, height: 388 });
    expect(getSecretOverlayBounds(display, [])).toMatchObject({ x: 384, width: 144, height: 37 });
  });

  it("builds a transparent full-display window and makes it click-through", () => {
    const options = getBoardAttackOverlayWindowOptions(
      { x: 100, y: 50, width: 2000, height: 1000 },
      "/tmp/preload.cjs"
    );
    const calls: unknown[][] = [];
    configureBoardAttackOverlayWindow({
      setVisibleOnAllWorkspaces: (...args) => calls.push(["workspaces", ...args]),
      setAlwaysOnTop: (...args) => calls.push(["alwaysOnTop", ...args]),
      setIgnoreMouseEvents: (...args) => calls.push(["ignoreMouse", ...args])
    });

    expect(options).toMatchObject({
      x: 100,
      y: 50,
      width: 2000,
      height: 1000,
      show: false,
      frame: false,
      transparent: true,
      focusable: false,
      resizable: false,
      hasShadow: false,
      backgroundColor: "#00000000",
      webPreferences: { preload: "/tmp/preload.cjs", backgroundThrottling: true }
    });
    expect(calls).toEqual([
      ["workspaces", true, { visibleOnFullScreen: true, skipTransformProcessType: true }],
      ["alwaysOnTop", true, "screen-saver"],
      ["ignoreMouse", true, { forward: true }]
    ]);
  });

  it("accepts mouse input only while a compact entry is being used", () => {
    const calls: unknown[][] = [];
    const window = {
      setIgnoreMouseEvents: (...args: unknown[]) => calls.push(args)
    };

    setAuxiliaryOverlayMouseInteractive(window, true);
    setAuxiliaryOverlayMouseInteractive(window, false);

    expect(calls).toEqual([
      [false, { forward: true }],
      [true, { forward: true }]
    ]);
  });

  it("adds deterministic demo data for the board-attack QA launch", () => {
    expect(getBoardAttackOverlayQuery(false)).toEqual({ "board-attack-overlay": "1" });
    expect(getBoardAttackOverlayQuery(true)).toEqual({
      "board-attack-overlay": "1",
      "show-friendly-attack": "1",
      "show-opponent-attack": "1",
      "qa-opponent-demo": "1"
    });
    expect(getBoardAttackOverlayQuery(true, { showFriendly: false, showOpponent: false })).toEqual({
      "board-attack-overlay": "1",
      "show-friendly-attack": "1",
      "show-opponent-attack": "1",
      "qa-opponent-demo": "1"
    });
    expect(getBoardAttackOverlayQuery(false, { showFriendly: false, showOpponent: true })).toEqual({
      "board-attack-overlay": "1",
      "show-friendly-attack": "0",
      "show-opponent-attack": "1"
    });
  });

  it("clears both document backgrounds so the full-display canvas stays transparent", () => {
    const css = readFileSync(join(process.cwd(), "src/renderer/boardAttackOverlayStyles.css"), "utf8");

    expect(css).toMatch(/html\.board-attack-overlay-document[\s\S]*?background:\s*transparent/);
    expect(css).toMatch(/html\.board-attack-overlay-document body[\s\S]*?background:\s*transparent/);
  });
});
