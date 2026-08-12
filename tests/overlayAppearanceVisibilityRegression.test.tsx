import { render, waitFor } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutomaticOverlayController, type AutomaticOverlayHost } from "../src/main/automaticOverlayController";
import { DEFAULT_TRACKER_SETTINGS } from "../src/main/trackerSettingsStore";
import App from "../src/renderer/App";
import type { PublicTrackerState } from "../src/shared/types";
import { createPublicTrackerState } from "./fixtures/publicTrackerState";

const overlayRoutes = [
  { name: "牌库悬浮窗", query: "/?overlay=1&qa-opponent-demo=1", selector: ".overlay-shell:not(.opponent-overlay-shell)", styleSelector: ".overlay-shell" },
  { name: "对手出牌悬浮窗", query: "/?opponent-overlay=1&qa-opponent-demo=1", selector: ".opponent-overlay-shell", styleSelector: ".opponent-overlay-shell" },
  { name: "竞技场选牌悬浮窗", query: "/?arena-choice-overlay=1&qa-arena-demo=1", selector: ".arena-choice-overlay-shell", styleSelector: ".arena-choice-overlay-card" },
] as const;

function trackerState(gameActive: boolean): PublicTrackerState {
  return createPublicTrackerState({
    status: "watching",
    trackerMode: "ladder",
    constructedScreenMode: "standard",
    gameActive,
    deck: [],
    events: [],
    summary: { totalCards: 0, remainingCards: 0, drawnCards: 0, opponentPlayedCount: 0 },
  });
}

function installLightThemeApi(state: PublicTrackerState) {
  window.hearthstoneTracker = {
    getState: vi.fn(async () => state),
    onUpdate: vi.fn(() => () => undefined),
    getTrackerSettings: vi.fn(async () => ({
      ...structuredClone(DEFAULT_TRACKER_SETTINGS),
      appearance: {
        ...structuredClone(DEFAULT_TRACKER_SETTINGS.appearance),
        theme: "light" as const,
      },
    })),
    getOpponentOverlayCollapsed: vi.fn(async () => false),
  } as unknown as typeof window.hearthstoneTracker;
}

function makeOverlayHost(initialState: PublicTrackerState) {
  const state = initialState;
  let frontmostAppName = "炉石记牌器";
  let exists = false;
  let visible = false;
  const createOverlayWindow = vi.fn(async () => {
    exists = true;
  });
  const showOverlayWindow = vi.fn(() => {
    visible = true;
  });
  const hideOverlayWindow = vi.fn(() => {
    visible = false;
  });
  const host: AutomaticOverlayHost = {
    getState: () => state,
    getFrontmostAppName: async () => frontmostAppName,
    hasOverlayWindow: () => exists,
    isOverlayVisible: () => visible,
    isOverlayFocused: () => false,
    createOverlayWindow,
    showOverlayWindow,
    hideOverlayWindow,
    isFrontmostAppAllowed: (appName) => appName === "Hearthstone",
  };

  return {
    host,
    createOverlayWindow,
    showOverlayWindow,
    hideOverlayWindow,
    setFrontmostAppName(appName: string) {
      frontmostAppName = appName;
    },
  };
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  delete window.hearthstoneTracker;
  delete document.documentElement.dataset.trackerTheme;
});

describe("light overlay appearance", () => {
  it.each(overlayRoutes)("marks the $name document as light", async ({ query, selector }) => {
    window.history.replaceState({}, "", query);
    installLightThemeApi(trackerState(true));

    render(<App />);

    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-tracker-theme", "light"));
    expect(document.querySelector(selector)).toBeInTheDocument();
  });

  it("provides a white light-theme background for all three overlay shells", () => {
    const rendererDirectory = join(process.cwd(), "src/renderer");
    const styles = readdirSync(rendererDirectory)
      .filter((file) => file.endsWith(".css"))
      .map((file) => readFileSync(join(rendererDirectory, file), "utf8"))
      .join("\n");
    const rules = Array.from(styles.matchAll(/([^{}]+)\{([^{}]*)\}/g), (match) => ({
      selector: match[1],
      declarations: match[2],
    }));
    const whiteBackground = /background(?:-color)?\s*:\s*(?:#fff(?:fff)?|rgba?\(\s*255\s*,\s*255\s*,\s*255(?:\s*,\s*(?:0?\.\d+|1))?\s*\))/i;

    for (const route of overlayRoutes) {
      const shellClass = route.styleSelector;
      const hasWhiteLightRule = rules.some((rule) => (
        shellClass
        && rule.selector.includes("data-tracker-theme=\"light\"")
        && rule.selector.includes(shellClass)
        && whiteBackground.test(rule.declarations)
      ));

      expect(hasWhiteLightRule, `${route.name} 缺少 light 白色背景规则`).toBe(true);
    }

    for (const shellClass of [".ladder-deck-shell", ".arena-hero-ranking", ".card-preview-window-shell"]) {
      const hasWhiteLightRule = rules.some((rule) => (
        rule.selector.includes('data-tracker-theme="light"')
        && rule.selector.includes(shellClass)
        && whiteBackground.test(rule.declarations)
      ));
      expect(hasWhiteLightRule, `${shellClass} 缺少 light 白色背景规则`).toBe(true);
    }
  });
});

describe("game-only overlay visibility", () => {
  it("defaults showOnlyInGame to true", () => {
    expect(
      (DEFAULT_TRACKER_SETTINGS.overlay as unknown as Record<string, unknown>).showOnlyInGame,
    ).toBe(true);
  });

  it("stays hidden when the tracker opens, shows in Hearthstone, and hides after leaving Hearthstone", async () => {
    const fixture = makeOverlayHost(trackerState(false));
    const controller = new AutomaticOverlayController(fixture.host);

    await controller.refresh();
    expect(fixture.createOverlayWindow).not.toHaveBeenCalled();
    expect(fixture.showOverlayWindow).not.toHaveBeenCalled();

    fixture.setFrontmostAppName("Hearthstone");
    await controller.refresh();
    expect(fixture.createOverlayWindow).toHaveBeenCalledOnce();
    expect(fixture.showOverlayWindow).toHaveBeenCalledOnce();

    fixture.setFrontmostAppName("Finder");
    await controller.refresh();
    expect(fixture.hideOverlayWindow).toHaveBeenCalledOnce();
  });

  it("wires showOnlyInGame to Hearthstone frontmost detection in the desktop process", () => {
    const source = readFileSync(join(process.cwd(), "src/main/main.ts"), "utf8");
    expect(source).toContain("trackerSettings.overlay.showOnlyInGame");
    expect(source).toContain("isHearthstoneFrontmost(appName)");
    expect(source).toContain("isFrontmostAppAllowed: (appName) => isOverlayFrontmostAllowed(");
    expect(source).toContain("previewWindowWasVisible");
    expect(source).toContain("overlaySettingsPreviewSession.isActive()");
    expect(source).toContain("continuingPreview && overlaySettingsPreviewWindows.friendly");
    expect(source).toContain("automaticOverlayController.start()");
    expect(source).toContain("automaticOpponentOverlayController.start()");
  });
});
