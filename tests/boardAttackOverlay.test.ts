import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  configureBoardAttackOverlayWindow,
  getBoardAttackIconBounds,
  getBoardAttackOverlayQuery,
  getBoardAttackOverlayWindowOptions,
  getHeroHealthOverlayBounds,
  getSecretOverlayBounds,
  getSmartCounterOverlayBounds,
  setAuxiliaryOverlayMouseInteractive,
  shouldShowBoardAttackOverlay
} from "../src/main/boardAttackOverlay";
import { clampBoundsToWorkArea } from "../src/main/auxiliaryOverlayWindowState";

type Bounds = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

function overlaps(left: Bounds, right: Bounds): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function expectInsideDisplay(bounds: Bounds, display: Bounds): void {
  expect(bounds.x).toBeGreaterThanOrEqual(display.x);
  expect(bounds.y).toBeGreaterThanOrEqual(display.y);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(display.x + display.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(display.y + display.height);
}

function expectPairwiseSeparate(bounds: readonly Bounds[]): void {
  for (let left = 0; left < bounds.length; left += 1) {
    for (let right = left + 1; right < bounds.length; right += 1) {
      expect(overlaps(bounds[left], bounds[right])).toBe(false);
    }
  }
}

describe("board attack overlay", () => {
  it("places compact 44px icons at the confirmed HDT percentages", () => {
    const display = { x: 100, y: 50, width: 2000, height: 1000 };

    expect(getBoardAttackIconBounds(display)).toEqual({
      opponent: { x: 610, y: 274, width: 44, height: 44 },
      friendly: { x: 610, y: 726, width: 44, height: 44 }
    });
  });

  it("places compact health counters beside both heroes without covering them or the attack icons", () => {
    const display = { x: 100, y: 50, width: 2000, height: 1000 };
    const attack = getBoardAttackIconBounds(display);
    const opponent = getHeroHealthOverlayBounds(display, "opponent-health");
    const friendly = getHeroHealthOverlayBounds(display, "friendly-health");
    const opponentHero = { x: 900, y: 70, width: 400, height: 280 };
    const friendlyHero = { x: 900, y: 740, width: 400, height: 280 };

    expect(opponent).toEqual({ x: 1350, y: 328, width: 72, height: 42 });
    expect(friendly).toEqual({ x: 480, y: 690, width: 72, height: 42 });
    expectPairwiseSeparate([opponent, friendly, attack.opponent, attack.friendly]);
    expect(overlaps(opponent, opponentHero)).toBe(false);
    expect(overlaps(friendly, friendlyHero)).toBe(false);
    expectInsideDisplay(opponent, display);
    expectInsideDisplay(friendly, display);
  });

  it("stays visible while Hearthstone or one of the tracker overlays is frontmost", () => {
    expect(shouldShowBoardAttackOverlay(true, "Hearthstone")).toBe(true);
    expect(shouldShowBoardAttackOverlay(true, "炉石记牌器")).toBe(true);
    expect(shouldShowBoardAttackOverlay(true, "Hearthstone Mac Tracker")).toBe(true);
    expect(shouldShowBoardAttackOverlay(true, undefined, true)).toBe(true);
    expect(shouldShowBoardAttackOverlay(false, "炉石记牌器", true)).toBe(false);
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

  it("keeps eleven smart counters separate from the default friendly attack icon at 1470x956", () => {
    const display = { x: 0, y: 0, width: 1470, height: 956 };
    const friendly = getBoardAttackIconBounds(display).friendly;
    const counters = Array.from({ length: 11 }, (_, index) =>
      getSmartCounterOverlayBounds(display, index)
    );

    expect(counters[0].x).toBe(friendly.x + friendly.width + 8);
    expectPairwiseSeparate([friendly, ...counters]);
    counters.forEach((bounds) => expectInsideDisplay(bounds, display));
  });

  it("fits eleven smart counters on one non-overlapping row at 1024x640", () => {
    const display = { x: 0, y: 0, width: 1024, height: 640 };
    const counters = Array.from({ length: 11 }, (_, index) =>
      getSmartCounterOverlayBounds(display, index)
    );

    expect(new Set(counters.map(({ y }) => y)).size).toBe(1);
    expectPairwiseSeparate(counters);
    counters.forEach((bounds) => expectInsideDisplay(bounds, display));
  });

  it.each([
    { x: 0, y: 0, width: 800, height: 600 },
    { x: 0, y: 0, width: 640, height: 480 }
  ])("wraps eleven smart counters upward inside $width x $height", (display) => {
    const counters = Array.from({ length: 11 }, (_, index) =>
      getSmartCounterOverlayBounds(display, index)
    );
    const coordinates = counters.map(({ x, y }) => `${x},${y}`);

    expect(new Set(counters.map(({ y }) => y)).size).toBeGreaterThan(1);
    expect(Math.min(...counters.map(({ y }) => y))).toBeLessThan(counters[0].y);
    expect(new Set(coordinates)).toHaveLength(counters.length);
    expectPairwiseSeparate(counters);
    counters.forEach((bounds) => expectInsideDisplay(bounds, display));
  });

  it("uses display-relative wrapping correctly on a negative-origin monitor", () => {
    const display = { x: -1024, y: -640, width: 1024, height: 640 };
    const friendly = getBoardAttackIconBounds(display).friendly;
    const counters = Array.from({ length: 11 }, (_, index) =>
      getSmartCounterOverlayBounds(display, index)
    );

    expect(counters[0].x).toBe(friendly.x + friendly.width + 8);
    expectPairwiseSeparate([friendly, ...counters]);
    counters.forEach((bounds) => expectInsideDisplay(bounds, display));
  });

  it.each([
    {
      name: "right Dock",
      display: { x: 0, y: 0, width: 1024, height: 640 },
      workArea: { x: 0, y: 24, width: 944, height: 616 }
    },
    {
      name: "left Dock",
      display: { x: 0, y: 0, width: 1024, height: 640 },
      workArea: { x: 80, y: 24, width: 944, height: 616 }
    }
  ])("lays out eleven smart counters inside the $name work area before clamping", ({ display, workArea }) => {
    const friendly = getBoardAttackIconBounds(display).friendly;
    const counters = Array.from({ length: 11 }, (_, index) =>
      getSmartCounterOverlayBounds(display, index, workArea)
    );
    const clamped = counters.map((bounds) => clampBoundsToWorkArea(bounds, workArea));

    expectPairwiseSeparate([friendly, ...counters]);
    expectPairwiseSeparate(clamped);
    expect(new Set(clamped.map(({ x, y }) => `${x},${y}`))).toHaveLength(clamped.length);
    counters.forEach((bounds) => expectInsideDisplay(bounds, workArea));
  });

  it.each([
    { x: 0, y: 0, width: 640, height: 480 },
    { x: -640, y: -480, width: 640, height: 480 }
  ])("uses free rows below the anchor before 31 counters can collide on a $x,$y display", (display) => {
    const counters = Array.from({ length: 31 }, (_, index) =>
      getSmartCounterOverlayBounds(display, index, display)
    );
    const clamped = counters.map((bounds) => clampBoundsToWorkArea(bounds, display));

    expectPairwiseSeparate(counters);
    expectPairwiseSeparate(clamped);
    expect(new Set(clamped.map(({ x, y }) => `${x},${y}`))).toHaveLength(clamped.length);
    counters.forEach((bounds) => expectInsideDisplay(bounds, display));
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
      ["workspaces", true, { visibleOnFullScreen: true, skipTransformProcessType: false }],
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
