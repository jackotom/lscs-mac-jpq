import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

function source(relativePath: string) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

describe("window experience configuration", () => {
  it("allows the main window to reach the supported narrow history layout", () => {
    expect(source("src/main/main.ts")).toMatch(
      /async function createWindow[\s\S]*?new BrowserWindow\(\{[\s\S]*?minWidth:\s*640,[\s\S]*?minHeight:\s*620,/
    );
  });

  it("brings the main window forward only when opened instead of pinning it", () => {
    const main = source("src/main/main.ts");

    expect(main).not.toMatch(/window\.setAlwaysOnTop\(trackerSettings\.general\.(?:alwaysOnTop|focusOnOpen)\)/);
    expect(main).not.toMatch(/mainWindow\.setAlwaysOnTop\(trackerSettings\.general\.(?:alwaysOnTop|focusOnOpen)\)/);
    expect(main).toMatch(
      /const focusWhenReady = options\.focusWhenReady \?\? shouldFocusMainWindowOnLaunch\(\s*process\.env,\s*trackerSettings\.general\.focusOnOpen\s*\)/
    );
    expect(main).toContain("presentMainWindow(window, focusWhenReady");
    expect(main).toMatch(
      /presentMainWindow\(\s*mainWindow,\s*trackerSettings\.general\.focusOnOpen/
    );
  });

  it("passes the saved minimized preference into the launch decision once", () => {
    const main = source("src/main/main.ts");
    expect(main).toContain(
      "shouldShowMainWindowOnLaunch(process.env, trackerSettings.general.startMinimized)"
    );
    expect(main).not.toContain("shouldShowMainWindowOnLaunch(process.env) || !trackerSettings.general.startMinimized");
  });

  it("keeps the normal deck overlay narrow while allowing the compact height floor", () => {
    expect(source("src/main/main.ts")).toMatch(
      /createOverlayWindow[\s\S]*?minWidth:\s*Math\.min\(100,\s*savedBounds\.width\)[\s\S]*?minHeight:\s*Math\.min\(200,\s*savedBounds\.height\)/
    );
  });

  it("uses the screenshot's narrow-tall hero ranking default and keeps the compact floor", () => {
    const main = source("src/main/main.ts");
    const bounds = source("src/main/overlayWindowBounds.ts");

    expect(bounds).toMatch(
      /arenaHeroDefaultWidth = 100[\s\S]*?arenaHeroDefaultHeight = 560[\s\S]*?arenaHeroLeftInset = 0/
    );
    expect(main).toMatch(
      /createArenaHeroRankingWindow[\s\S]*?minWidth:\s*Math\.min\(100,\s*width\)[\s\S]*?minHeight:\s*Math\.min\(200,\s*height\)/
    );
  });

  it("places first-run overlays on their requested sides without overlapping", () => {
    const bounds = source("src/main/overlayWindowBounds.ts");

    expect(bounds).toMatch(/const opponentEdgeGap = 24;/);
    expect(bounds).toMatch(
      /getDefaultOpponentOverlayWindowBounds[\s\S]*?heroBounds\.x \+ heroBounds\.width \+ opponentEdgeGap/
    );
    expect(bounds).toMatch(
      /getDefaultOverlayWindowBounds[\s\S]*?x:\s*workArea\.x \+ workArea\.width - width/
    );
  });

  it("reuses the friendly overlay when automatic and explicit opening race", () => {
    const main = source("src/main/main.ts");
    expect(main).toContain("overlayWindowCreationPromise");
    expect(main).toContain("opponentOverlayWindowCreationPromise");
    expect(main).toMatch(
      /if \(overlayWindowCreationPromise\)[\s\S]*?await overlayWindowCreationPromise/
    );
    expect(main).toMatch(
      /if \(opponentOverlayWindowCreationPromise\)[\s\S]*?await opponentOverlayWindowCreationPromise/
    );
  });

  it("uses first-run defaults only when no saved overlay bounds exist", () => {
    const main = source("src/main/main.ts");
    expect(main).toMatch(/return normalized\.x === undefined \? getDefaultOverlayWindowBounds\(display\) : normalized/);
    expect(main).toContain("normalizeOpponentOverlayWindowBounds(undefined, workAreas, fallbackWorkArea)");
  });

  it("does not allow expanded opponent windows to use collapsed dimensions", () => {
    const main = source("src/main/main.ts");
    expect(main).toMatch(/createdWindow\.setMinimumSize\(100,\s*150\)/);
  });

  it("repairs undersized saved opponent bounds", () => {
    const main = source("src/main/main.ts");
    expect(main).toContain("normalizeOpponentOverlayWindowBounds");
  });

  it("applies configured positioning only to the friendly tracker", () => {
    const main = source("src/main/main.ts");
    expect(main).toMatch(
      /function applyConfiguredOverlayPositions[\s\S]*?const window = overlayWindow;/
    );
    expect(main).not.toMatch(
      /function applyConfiguredOverlayPositions[\s\S]*?\[overlayWindow,\s*opponentOverlayWindow\]/
    );
  });

  it("keeps secret presentation independent from the folded opponent tracker", () => {
    const main = source("src/main/main.ts");
    const section = main.slice(
      main.indexOf("async function refreshBoardAttackOverlayWindow"),
      main.indexOf("async function refreshAuxiliaryOverlayWindow")
    );
    expect(section).toContain("createSecretOverlayWindow");
    expect(section).toContain("releaseSecretOverlayWindow");
    expect(section).not.toContain("expandOpponentOverlayWindow");
    expect(section).not.toContain("createOpponentOverlayWindow");
  });

  it("keeps automatic overlay paths inactive while leaving explicit opponent opening focusable", () => {
    const main = source("src/main/main.ts");
    const presenter = source("src/main/opponentSecretOverlayPresenter.ts");
    const friendlyAutomatic = main.slice(
      main.indexOf("const automaticOverlayController"),
      main.indexOf("const automaticOpponentOverlayController")
    );
    const opponentAutomatic = main.slice(
      main.indexOf("const automaticOpponentOverlayController"),
      main.indexOf("function isDeckTrackerEnabled")
    );
    const explicitOpponentToggle = main.slice(
      main.indexOf('secureHandle("tracker:toggle-opponent-overlay"'),
      main.indexOf('secureHandle("tracker:show-card-preview"')
    );

    expect(presenter).toContain("ensureWindow({ showWhenReady: false })");
    expect(presenter).not.toMatch(/\.show\(/);
    expect(presenter).not.toMatch(/\.focus\(/);
    expect(friendlyAutomatic).toContain("reassertOverlayWindowPresentation(");
    expect(friendlyAutomatic).toContain("useQaAccessoryActivationPolicy");
    expect(friendlyAutomatic).not.toMatch(/overlayWindow\.(?:show|focus)\(/);
    expect(opponentAutomatic).toContain("reassertOverlayWindowPresentation(");
    expect(opponentAutomatic).toContain("useQaAccessoryActivationPolicy");
    expect(opponentAutomatic).not.toMatch(/opponentOverlayWindow\.(?:show|focus)\(/);
    expect(opponentAutomatic).not.toContain("expandOpponentOverlayWindow");
    expect(explicitOpponentToggle).toContain("expandOpponentOverlayWindow(true)");
    expect(explicitOpponentToggle).toContain("showWhenReady: true");
  });

  it("routes active secrets through a dedicated no-focus window", () => {
    const main = source("src/main/main.ts");
    const monitor = main.slice(
      main.indexOf("async function refreshBoardAttackOverlayWindow"),
      main.indexOf("async function refreshAuxiliaryOverlayWindow")
    );

    expect(monitor).toContain("trackerSettings.overlay.secretPrediction");
    expect(monitor).toContain("state.opponentSecrets?.length");
    expect(monitor).toContain("createSecretOverlayWindow");
    expect(monitor).not.toMatch(/\.show\(/);
    expect(monitor).not.toMatch(/\.focus\(/);
  });

  it("shows the hero ranking loading window before waiting for network data", () => {
    const main = source("src/main/main.ts");
    expect(main).toMatch(
      /refreshArenaHeroRankingWindow[\s\S]*?window\.showInactive\(\)[\s\S]*?refreshArenaHeroRankingData/
    );
    expect(main).toMatch(
      /createArenaHeroRankingWindow[\s\S]*?const createdWindow = arenaHeroRankingWindow[\s\S]*?await loadRendererPage\(createdWindow, query\)/
    );
  });

  it("reads back login-item state instead of trusting the write", () => {
    const main = source("src/main/main.ts");
    expect(main).toContain("applyLaunchAtLoginSetting(app");
    expect(main).not.toContain("app.setLoginItemSettings({ openAtLogin: trackerSettings.general.launchAtLogin });");
  });

  it("does not abort startup when macOS rejects a saved login-item preference", () => {
    const main = source("src/main/main.ts");
    expect(main).toMatch(
      /await applyTrackerSettingsEffects\(\s*undefined,\s*\{\s*loginItemVerified:\s*shouldSkipLaunchAtLoginUpdateDuringQaCapture\(process\.env\)\s*\}\s*\)\.catch\(async \(error\) =>[\s\S]*?reportDiagnosticError\("应用开机启动设置失败[^"]*"/
    );
  });

  it("allows hidden renderer windows to throttle", () => {
    const main = source("src/main/main.ts");
    expect(main).not.toMatch(/backgroundThrottling:\s*false/);
  });

  it("provides visible keyboard focus for main toolbar controls", () => {
    expect(source("src/renderer/styles.css")).toMatch(/\.top-actions button:focus-visible/);
    expect(source("src/renderer/styles.css")).toMatch(/\.settings-mode-tabs button:focus-visible/);
    expect(source("src/renderer/styles.css")).toMatch(/\.settings-switches button:focus-visible/);
  });

  it("keeps all friendly overlay header controls in the 100px layout", () => {
    expect(source("src/renderer/overlayStyles.css")).toMatch(
      /grid-template-columns:\s*minmax\(\d+px,\s*1fr\)\s*6px\s*17px\s*17px/
    );
  });

  it("marks synergy rows without changing the 20px narrow-overlay rhythm", () => {
    const styles = source("src/renderer/overlayStyles.css");

    expect(styles).toMatch(
      /\.overlay-compact-card-row\.is-synergy-related\s*\{[\s\S]*?background:\s*rgba\(196,\s*132,\s*38,\s*0\.16\)/
    );
    expect(styles).toMatch(
      /\.overlay-compact-card-row\.is-synergy-related::before\s*\{[\s\S]*?inset:\s*0;[\s\S]*?inset 2px 0 0[\s\S]*?inset -2px 0 0/
    );
    expect(styles).toMatch(
      /\.overlay-compact-card-row\.is-synergy-related::after\s*\{[\s\S]*?width:\s*12px;[\s\S]*?height:\s*12px;[\s\S]*?content:\s*attr\(data-synergy-marker\);/
    );
    expect(styles).toMatch(
      /\.overlay-compact-card-row\.is-synergy-related:has\(\.overlay-card-quantity\)::after\s*\{\s*right:\s*19px;/
    );
    expect(styles).toMatch(
      /\.overlay-compact-card-row\.is-synergy-related:hover[\s\S]*?\.overlay-compact-card-row\.is-synergy-related:focus-visible[\s\S]*?box-shadow:\s*inset 2px 0 0 #79c0e6/
    );
    expect(styles).toMatch(
      /\.overlay-compact-card-row:hover::before,[\s\S]*?\.overlay-compact-card-row:focus-visible::before\s*\{[\s\S]*?background:\s*rgba\(64,\s*119,\s*156,\s*0\.12\);[\s\S]*?box-shadow:\s*inset 2px 0 0 #79c0e6/
    );
    expect(styles).toMatch(
      /\.overlay-compact-card-row\s*\{[\s\S]*?height:\s*20px;[\s\S]*?overflow:\s*hidden;/
    );
  });

  it("keeps the opponent title, status, and collapse control in the 100px layout", () => {
    const styles = source("src/renderer/opponentOverlayStyles.css");
    expect(styles).toMatch(
      /@media \(max-width: 120px\)[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*6px\s*17px/
    );
    expect(styles).toMatch(
      /@media \(max-width: 120px\)[\s\S]*?\.overlay-header button[\s\S]*?width:\s*17px[\s\S]*?height:\s*17px/
    );
  });

  it("keeps overlay window controls large enough to target", () => {
    expect(source("src/renderer/overlayStyles.css")).toMatch(/\.overlay-header button[\s\S]*?width:\s*28px[\s\S]*?min-height:\s*28px/);
    expect(source("src/renderer/opponentOverlayStyles.css")).toMatch(/\.overlay-header button[\s\S]*?width:\s*28px[\s\S]*?height:\s*28px/);
    expect(source("src/renderer/ladderDeckRecommendationStyles.css")).toMatch(/\.ladder-deck-close[\s\S]*?width:\s*28px[\s\S]*?height:\s*28px/);
  });

  it("keeps arena choice labels legible at narrow widths", () => {
    const styles = source("src/renderer/arenaChoiceOverlayStyles.css");
    expect(styles).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.arena-choice-overlay-metric > span \{\s*font-size:\s*9px/);
    expect(styles).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.arena-choice-overlay-metric > strong \{\s*font-size:\s*10px/);
  });

  it("keeps the arena hero ranking draggable and readable at its narrow size", () => {
    const styles = source("src/renderer/arenaHeroRankingStyles.css");

    expect(styles).toMatch(
      /\.arena-hero-ranking\s*\{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?grid-template-rows:\s*auto minmax\(0,\s*1fr\);[\s\S]*?overflow:\s*hidden;/
    );
    expect(styles).toMatch(
      /\.arena-hero-ranking__header\s*\{[\s\S]*?cursor:\s*grab;[\s\S]*?-webkit-app-region:\s*drag;[\s\S]*?-webkit-user-select:\s*none;/
    );
    expect(styles).toMatch(
      /\.arena-hero-ranking__header button\s*\{[\s\S]*?-webkit-app-region:\s*no-drag;/
    );
    expect(styles).toMatch(
      /\.arena-hero-ranking__list\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;/
    );
    expect(styles).toMatch(
      /@media \(max-width: 230px\)[\s\S]*?\.arena-hero-ranking__list li\s*\{[\s\S]*?grid-template-columns:\s*22px minmax\(0,\s*1fr\) 42px;/
    );
    expect(styles).toMatch(
      /@media \(max-width: 230px\)[\s\S]*?\.arena-hero-ranking__sample\s*\{\s*display:\s*none;/
    );
    const smallestWidthStyles = styles.slice(
      styles.indexOf("@media (max-width: 190px)"),
      styles.indexOf("@media (max-height: 320px)")
    );
    expect(smallestWidthStyles).toMatch(
      /\.arena-hero-ranking__list li\s*\{[\s\S]*?grid-template-columns:\s*\d+px minmax\(0,\s*1fr\) \d+px;/
    );
    expect(smallestWidthStyles).not.toMatch(
      /\.arena-hero-ranking__rank\s*\{[^}]*display:\s*none;/
    );
    expect(styles).toMatch(
      /@media \(max-height: 230px\)[\s\S]*?\.arena-hero-ranking__header\s*\{[\s\S]*?min-height:\s*34px;[\s\S]*?\.arena-hero-ranking__list li\s*\{[\s\S]*?min-height:\s*29px;/
    );
  });

  it("keeps the Arena pregame stats table readable without widening the 100px overlay", () => {
    const styles = source("src/renderer/overlayStyles.css");

    expect(styles).toMatch(
      /\.overlay-shell:has\(\.overlay-arena-stats\)\s*\{[\s\S]*?grid-template-rows:\s*20px minmax\(0,\s*1fr\);[\s\S]*?min-width:\s*0;[\s\S]*?overflow-x:\s*hidden;/
    );
    expect(styles).toMatch(
      /\.overlay-arena-stats-header,[\s\S]*?\.overlay-arena-stats-row\s*\{[\s\S]*?grid-template-columns:\s*clamp\(27px,\s*23%,\s*44px\) minmax\(0,\s*1fr\) clamp\(32px,\s*26%,\s*46px\);/
    );
    expect(styles).toMatch(/\.overlay-arena-stats-list\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;/);
    expect(styles).toMatch(/\.overlay-arena-stat-card\s*\{[\s\S]*?grid-template-columns:\s*14px minmax\(0,\s*1fr\);[\s\S]*?overflow:\s*hidden;/);
    expect(styles).toMatch(/\.overlay-arena-stat-pick\.is-positive,[\s\S]*?color:\s*var\(--arena-stats-green\);/);
    expect(styles).toMatch(/\.overlay-arena-stat-impact\.is-negative\s*\{[\s\S]*?color:\s*var\(--arena-stats-red\);/);
    expect(styles).toMatch(/@media \(max-width: 120px\)[\s\S]*?\.overlay-arena-stats-row\s*\{[\s\S]*?grid-template-columns:\s*27px minmax\(0,\s*1fr\) 32px;/);
  });
});
