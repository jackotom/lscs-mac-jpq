import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const source = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

describe("Arena hero win-rate ranking integration", () => {
  it("keeps overlay control isolated while exposing read-only home ranking data", () => {
    const preload = source("src/main/preload.cts");
    const main = source("src/main/main.ts");
    expect(preload).toContain('params.get("arena-hero-ranking-overlay") === "1"');
    expect(preload).toContain('ipcRenderer.invoke("tracker:get-arena-hero-win-rate-ranking")');
    expect(preload).toContain('ipcRenderer.invoke("tracker:close-arena-hero-win-rate-ranking")');
    expect(main).toContain('secureHandle("tracker:get-arena-hero-win-rate-ranking"');
    expect(main).toContain('secureHandle("tracker:close-arena-hero-win-rate-ranking"');
    expect(main).toContain("event.sender !== arenaHeroRankingWindow?.webContents");
  });

  it("shows on the left only during a watched Arena session and respects both switches", () => {
    const main = source("src/main/main.ts");
    const bounds = source("src/main/overlayWindowBounds.ts");
    expect(bounds).toContain("const arenaHeroLeftInset = 0");
    expect(main).toContain("getDefaultArenaHeroRankingWindowBounds(");
    expect(main).toContain('tracker.getState().status === "watching"');
    expect(main).toContain('arena.status !== "inactive"');
    expect(main).toContain("!trackerSettings.overlay.enabled");
    expect(main).toContain("!trackerSettings.overlay.arenaHeroWinRateRanking");
    expect(main).toContain("arenaHeroRankingSuppressed = true");
    expect(main).toContain('arena.status === "inactive") arenaHeroRankingSuppressed = false');
  });

  it("keeps the ranking window alive while the user moves or resizes it", () => {
    const main = source("src/main/main.ts");

    expect(main).toContain("isHearthstoneFrontmost");
    expect(main).toContain("arenaHeroRankingInteractionActiveUntil");
    expect(main).toContain("markArenaHeroRankingInteraction");
    expect(main).toContain("isArenaHeroRankingInteractionActive()");
    expect(main).toContain("isOverlayFrontmostAllowed(");
    expect(main).toContain("overlaySettingsPreviewWindows.arenaHeroRanking");
    expect(main).toContain("arenaHeroRankingWindow.isFocused()");
    expect(main).toMatch(/createdWindow\.on\("focus",\s*markArenaHeroRankingInteraction\)/);
    expect(main).toMatch(/createdWindow\.on\("will-move",\s*markArenaHeroRankingInteraction\)/);
    expect(main).toMatch(/createdWindow\.on\("will-resize",\s*markArenaHeroRankingInteraction\)/);
    expect(main).toMatch(/createdWindow\.on\("move",[\s\S]*?markArenaHeroRankingInteraction\(\)/);
    expect(main).toMatch(/createdWindow\.on\("resize",[\s\S]*?markArenaHeroRankingInteraction\(\)/);
  });

  it("restores, saves, and repairs ranking-window bounds", () => {
    const main = source("src/main/main.ts");
    const bounds = source("src/main/overlayWindowBounds.ts");

    expect(bounds).toContain("export function getDefaultArenaHeroRankingWindowBounds");
    expect(bounds).toContain("const arenaHeroDefaultWidth = 100");
    expect(bounds).toContain("const arenaHeroDefaultHeight = 560");
    expect(main).not.toContain("function getDefaultArenaHeroRankingWindowBounds");
    expect(main).toMatch(/defaultBounds: fallback,[\s\S]*?minWidth: 100,[\s\S]*?minHeight: 200/);
    expect(main).toContain("await loadArenaHeroRankingWindowBounds()");
    expect(main).toContain('"arena-hero-ranking-window-bounds.json"');
    expect(main).toContain("scheduleArenaHeroRankingWindowBoundsSave(createdWindow)");
    expect(main).toContain("saveArenaHeroRankingWindowBounds(createdWindow.getBounds())");
    expect(main).toContain("ensureArenaHeroRankingWindowVisible(window)");
  });
});
