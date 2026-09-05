import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const main = fs.readFileSync(path.resolve(import.meta.dirname, "../src/main/main.ts"), "utf8");

describe("transient overlay window lifecycle", () => {
  it("releases one-shot renderer windows instead of keeping them resident", () => {
    for (const name of [
      "boardAttackOverlayWindow",
      "ladderDeckOverlayWindow",
      "arenaChoiceOverlayWindow",
      "cardPreviewWindow"
    ]) {
      expect(main).not.toMatch(new RegExp(`${name}\\?*\\.hide\\(`));
    }
    expect(main.match(/releaseTransientWindow\(/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("only hides deck tracker windows on temporary Hearthstone focus loss", () => {
    const friendlyHostStart = main.indexOf("const automaticOverlayController");
    const opponentHostStart = main.indexOf("const automaticOpponentOverlayController");
    const helperStart = main.indexOf("function isDeckTrackerEnabled");
    const friendlyHost = main.slice(friendlyHostStart, opponentHostStart);
    const opponentHost = main.slice(opponentHostStart, helperStart);

    expect(friendlyHost).toMatch(
      /hideOverlayWindow:\s*async \(\) => \{[\s\S]*?overlayWindow\.hide\(\)/
    );
    expect(friendlyHost).not.toContain("releaseOverlayWindow");
    expect(opponentHost).toMatch(
      /hideOverlayWindow:\s*async \(\) => \{[\s\S]*?opponentOverlayWindow\.hide\(\)/
    );
    expect(opponentHost).not.toContain("releaseOpponentOverlayWindow");
  });

  it("creates the arena choice renderer only when the overlay is visible", () => {
    expect(main).not.toContain("if (trackerSettings.overlay.enabled) await createArenaChoiceOverlayWindow();");
    expect(main).toContain("if (trackerSettings.overlay.enabled) startArenaChoiceOverlayMonitor();");
    expect(main).toMatch(
      /refreshArenaChoiceOverlayWindow[\s\S]*?shouldShowArenaChoiceOverlay[\s\S]*?createArenaChoiceOverlayWindow/
    );
  });

  it("keeps the opponent window collapsed after a background release and restore", () => {
    expect(main).toContain("opponentOverlayRestoreCollapsed");
    expect(main).toMatch(
      /createOpponentOverlayWindow[\s\S]*?opponentOverlayRestoreCollapsed[\s\S]*?collapseOpponentOverlayWindow/
    );
  });

  it("invalidates stopped arena refreshes and persists opponent bounds before release", () => {
    expect(main).toContain("arenaChoiceOverlayGeneration");
    expect(main).toContain("arenaHeroRankingGeneration");
    expect(main).toContain("await releaseOpponentOverlayWindow()");
    expect(main).toContain("await opponentOverlayBoundsPersistence.flush");
  });

  it("rechecks live secret state before showing the dedicated secret window", () => {
    const start = main.indexOf("async function refreshBoardAttackOverlayWindow");
    const end = main.indexOf("async function refreshAuxiliaryOverlayWindow", start);
    const refreshSource = main.slice(start, end);

    expect(refreshSource).toContain("trackerSettings.overlay.secretPrediction");
    expect(refreshSource).toContain("state.opponentSecrets?.length");
    expect(refreshSource).toContain("createSecretOverlayWindow");
    expect(refreshSource).toContain("releaseSecretOverlayWindow");
  });

  it("turns off only the dedicated secret window without closing the opponent tracker", () => {
    const start = main.indexOf("previous.overlay.secretPrediction");
    const settingsSection = main.slice(
      start,
      main.indexOf("previous.overlay.smartCardCounters", start)
    );
    expect(settingsSection).toContain("releaseSecretOverlayWindow");
    expect(settingsSection).not.toContain("releaseOpponentOverlayWindow");
  });

  it("flushes final friendly bounds before close and application quit", () => {
    expect(main).toContain("overlayBoundsPersistence");
    expect(main).toMatch(/cleanup: async \(\) =>[\s\S]*?await releaseOverlayWindow\(\)/);
    expect(main).toMatch(
      /closeFriendlyOverlay:\s*\(\) => releaseOverlayWindow\(overlayWindow\)/
    );
    expect(main).toMatch(
      /automaticOverlayController\.suppressCurrentContext\(\);[\s\S]*?await releaseOverlayWindow\(overlayWindow\)/
    );
    expect(main).not.toContain("overlayBoundsSaveTimer");
  });

  it("waits for an in-flight opponent creation before releasing it", () => {
    const releaseStart = main.indexOf("async function releaseOpponentOverlayWindow");
    const releaseSource = main.slice(
      releaseStart,
      main.indexOf("async function loadOpponentOverlayWindowState", releaseStart)
    );
    expect(releaseSource).toContain("opponentOverlayWindowCreationPromise");
    expect(releaseSource).toMatch(
      /await opponentOverlayWindowCreationPromise\.catch[\s\S]*?window = opponentOverlayWindow/
    );
  });

  it("closes friendly and opponent windows even when final bounds persistence fails", () => {
    for (const [releaseName, nextName] of [
      ["releaseOverlayWindow", "saveOverlayWindowBounds"],
      ["releaseOpponentOverlayWindow", "loadOpponentOverlayWindowState"]
    ]) {
      const releaseStart = main.indexOf(`async function ${releaseName}`);
      const releaseSource = main.slice(
        releaseStart,
        main.indexOf(`async function ${nextName}`, releaseStart)
      );
      expect(releaseSource).toMatch(/try \{[\s\S]*?await [\s\S]*?\.flush[\s\S]*?finally \{[\s\S]*?window\.close\(\)/);
    }
  });
});
