import { describe, expect, it } from "vitest";
import { shouldShowArenaChoiceOverlay } from "../src/main/arenaChoiceOverlayVisibility";
import { isHearthstoneFrontmost, resolveFrontmostAppHelperPath } from "../src/main/frontmostApp";
import type { ArenaState } from "../src/shared/types";

const draftingArena: ArenaState = {
  status: "drafting",
  hero: { name: "德鲁伊" },
  draftCount: 11,
  unresolvedCount: 30,
  currentChoices: [
    { name: "闪光试剂瓶", count: 1 },
    { name: "野蛮先锋", count: 1 },
    { name: "微型战斗机甲", count: 1 }
  ],
  picks: [],
  deck: []
};

describe("arena choice overlay visibility", () => {
  it("shows only while Hearthstone is the frontmost app", () => {
    expect(shouldShowArenaChoiceOverlay(draftingArena, "Hearthstone")).toBe(true);
    expect(shouldShowArenaChoiceOverlay(draftingArena, "ChatGPT")).toBe(false);
    expect(shouldShowArenaChoiceOverlay(draftingArena, "炉石记牌器")).toBe(false);
  });

  it("shows two reliable choices while the third card is still being recognized", () => {
    expect(shouldShowArenaChoiceOverlay({ ...draftingArena, currentChoices: draftingArena.currentChoices.slice(0, 2) }, "Hearthstone")).toBe(true);
    expect(shouldShowArenaChoiceOverlay({ ...draftingArena, currentChoices: draftingArena.currentChoices.slice(0, 1) }, "Hearthstone")).toBe(false);
    expect(shouldShowArenaChoiceOverlay({ ...draftingArena, status: "playing" }, "Hearthstone")).toBe(false);
  });

  it("shows the three-card quality overlay while redrafting", () => {
    expect(shouldShowArenaChoiceOverlay({ ...draftingArena, status: "redrafting" }, "Hearthstone")).toBe(true);
  });

  it("matches the macOS Hearthstone process name exactly", () => {
    expect(isHearthstoneFrontmost("Hearthstone")).toBe(true);
    expect(isHearthstoneFrontmost(" hearthstone ")).toBe(true);
    expect(isHearthstoneFrontmost("Hearthstone Helper")).toBe(false);
    expect(isHearthstoneFrontmost(undefined)).toBe(false);
  });

  it("resolves the packaged frontmost app helper from Electron resources", () => {
    expect(resolveFrontmostAppHelperPath("/Applications/Tracker.app/Contents/Resources", "file:///ignored.js", true))
      .toBe("/Applications/Tracker.app/Contents/MacOS/frontmost-app");
  });

  it("resolves the project frontmost app helper during development", () => {
    expect(resolveFrontmostAppHelperPath("/Electron/Resources", "file:///project/dist-electron/main/frontmostApp.js", false))
      .toBe("/project/native/bin/frontmost-app");
  });
});
