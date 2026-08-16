import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const main = fs.readFileSync(path.resolve(import.meta.dirname, "../src/main/main.ts"), "utf8");

const fixedOverlays = [
  {
    window: "friendlyAttackOverlayWindow",
    create: "createFriendlyAttackOverlayWindow",
    release: "releaseFriendlyAttackOverlayWindow",
    setting: "showFriendlyAttack",
    query: "friendly-attack-overlay"
  },
  {
    window: "opponentAttackOverlayWindow",
    create: "createOpponentAttackOverlayWindow",
    release: "releaseOpponentAttackOverlayWindow",
    setting: "showOpponentAttack",
    query: "opponent-attack-overlay"
  },
  {
    window: "secretOverlayWindow",
    create: "createSecretOverlayWindow",
    release: "releaseSecretOverlayWindow",
    setting: "secretPrediction",
    query: "secret-overlay"
  }
] as const;

function functionSource(name: string): string {
  const start = main.indexOf(`function ${name}`);
  if (start < 0) return "";
  const tail = main.slice(start + 10);
  const nextMatch = /\n(?:async\s+)?function\s/u.exec(tail);
  const next = nextMatch ? start + 10 + nextMatch.index : -1;
  return main.slice(start, next < 0 ? undefined : next);
}

describe("independent auxiliary-overlay window lifecycle", () => {
  it.each(fixedOverlays)("owns a separate $window BrowserWindow and renderer query", (overlay) => {
    expect(main).toContain(`let ${overlay.window}`);
    expect(main).toContain(`function ${overlay.create}`);
    expect(main).toContain(`function ${overlay.release}`);
    expect(main).toContain(`"${overlay.query}": "1"`);
  });

  it.each(fixedOverlays)("releases $window by closing it and clearing only its own reference", (overlay) => {
    const source = functionSource(overlay.release);

    expect(source).toContain(overlay.window);
    expect(source).toMatch(/\.close\(\)|releaseTransientWindow\(/);
    expect(source).toMatch(new RegExp(`${overlay.window}\\s*=\\s*undefined`));
    for (const other of fixedOverlays.filter((candidate) => candidate.window !== overlay.window)) {
      expect(source).not.toContain(`${other.window} = undefined`);
    }
  });

  it.each(fixedOverlays)("closes only the $setting window when that switch turns off", (overlay) => {
    const settingsEffects = functionSource("applyTrackerSettingsEffects");
    const changedSetting = new RegExp(
      `previous\\.overlay\\.${overlay.setting}\\s*!==\\s*trackerSettings\\.overlay\\.${overlay.setting}`
    );

    expect(settingsEffects).toMatch(changedSetting);
    expect(settingsEffects).toContain(overlay.release);
  });

  it("includes fixed windows and every smart-counter window in shared appearance and cleanup", () => {
    const windowList = functionSource("overlayWindows");
    for (const overlay of fixedOverlays) {
      expect(windowList).toContain(overlay.window);
      expect(main).toContain(overlay.release);
    }
    expect(windowList).toContain("smartCounterOverlayWindows.values()");
    expect(main).toContain("releaseSmartCounterOverlayWindow");
  });

  it("keeps the secret window click-through so it cannot swallow Hearthstone input", () => {
    const createSecret = functionSource("createSecretOverlayWindow");
    const createAuxiliary = functionSource("createAuxiliaryOverlayWindow");

    expect(createSecret).not.toMatch(/\.secret-overlay"\s*,\s*true/u);
    expect(createAuxiliary).not.toContain("receiveMouseEvents");
    expect(createAuxiliary).not.toContain("setIgnoreMouseEvents(false)");
  });

  it("trusts an auxiliary renderer before its initial page load starts IPC", () => {
    const createAuxiliary = functionSource("createAuxiliaryOverlayWindow");
    const trustedContents = functionSource("getTrustedWebContents");
    const registration = createAuxiliary.indexOf("trustedAuxiliaryWebContents.add(webContents)");
    const initialLoad = createAuxiliary.indexOf("await loadRendererPage(window, query)");

    expect(registration).toBeGreaterThanOrEqual(0);
    expect(initialLoad).toBeGreaterThan(registration);
    expect(createAuxiliary).toContain('webContents.once("destroyed"');
    expect(trustedContents).toContain("...trustedAuxiliaryWebContents");
  });

  it("does not read BrowserWindow.webContents again after that WebContents is destroyed", () => {
    const createAuxiliary = functionSource("createAuxiliaryOverlayWindow");
    const destroyedListenerStart = createAuxiliary.indexOf('webContents.once("destroyed"');
    const destroyedListenerEnd = createAuxiliary.indexOf("installQaConsoleErrorListener", destroyedListenerStart);
    const destroyedListener = createAuxiliary.slice(destroyedListenerStart, destroyedListenerEnd);

    expect(createAuxiliary).toContain("const webContents = window.webContents");
    expect(destroyedListenerStart).toBeGreaterThanOrEqual(0);
    expect(destroyedListener).toContain("trustedAuxiliaryWebContents.delete(webContents)");
    expect(destroyedListener).toContain("auxiliaryOverlayKindsByWebContents.delete(webContents)");
    expect(destroyedListener).not.toContain("window.webContents");
  });

  it("gates the production auxiliary monitor behind the shared QA-overlay capture policy", () => {
    const settingsEffects = functionSource("applyTrackerSettingsEffects");

    expect(settingsEffects).toContain("shouldRunBoardAttackOverlayMonitor(process.env, showAnyAuxiliaryOverlay)");
    expect(settingsEffects).toContain(
      "if (shouldRunBoardAttackOverlayMonitor(process.env, showAnyAuxiliaryOverlay)) startBoardAttackOverlayMonitor()"
    );
  });

  it("owns one BrowserWindow per smart-counter id", () => {
    expect(main).toMatch(
      /const smartCounterOverlayWindows\s*=\s*new Map<string,\s*BrowserWindow>\(\)/
    );
    const createSource = functionSource("createSmartCounterOverlayWindow");
    expect(createSource).toMatch(/counterId:\s*string/);
    expect(createSource).toContain("smartCounterOverlayWindows.get(counterId)");
    expect(createSource).toContain("smartCounterOverlayWindows.set(counterId");
    expect(createSource).toContain('"smart-counter-overlay": "1"');
    expect(createSource).toContain('"smart-counter-id": counterId');
  });

  it("can close one smart counter without touching sibling windows", () => {
    const releaseSource = functionSource("releaseSmartCounterOverlayWindow");
    expect(releaseSource).toMatch(/counterId:\s*string/);
    expect(releaseSource).toContain("smartCounterOverlayWindows.get(counterId)");
    expect(releaseSource).toMatch(/window[^\n]*\.close\(\)/);
    expect(releaseSource).toContain("smartCounterOverlayWindows.delete(counterId)");
    expect(releaseSource).toContain("smartCounterOverlayGenerations.delete(counterId)");
    expect(releaseSource).not.toContain("smartCounterOverlayGenerations.set(counterId");
    expect(releaseSource).not.toContain("smartCounterOverlayWindows.clear()");
  });

  it("filters hidden ids and synchronizes each active smart counter independently", () => {
    const refreshSource = functionSource("refreshSmartCounterOverlayWindows");
    expect(refreshSource).toContain("hiddenSmartCounterIds");
    expect(refreshSource).toMatch(/counters\.filter[\s\S]*?counter\.id/);
    expect(refreshSource).toContain("createSmartCounterOverlayWindow");
    expect(refreshSource).toContain("releaseSmartCounterOverlayWindow");
  });
});
