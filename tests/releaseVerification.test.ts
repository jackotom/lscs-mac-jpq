import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

describe("release verification entrypoint", () => {
  it("keeps the visible app version aligned with package metadata", () => {
    const packageJson = JSON.parse(read("package.json")) as { version: string };
    const packageLock = JSON.parse(read("package-lock.json")) as { version: string; packages: { "": { version: string } } };
    const appSource = read("src/renderer/App.tsx");
    const packageScript = read("scripts/package-mac-arm64.sh");
    const releaseScript = read("scripts/verify-release.sh");

    expect(appSource).toContain(`<small>v${packageJson.version}</small>`);
    expect(packageJson.version).toBe("0.6.6");
    expect(packageLock.version).toBe(packageJson.version);
    expect(packageLock.packages[""]?.version).toBe(packageJson.version);
    expect(packageScript).toContain('app_version="$(node -p');
    expect(packageScript).toContain('--app-version="$app_version"');
    expect(packageScript).toContain('--build-version="$app_version"');
    expect(releaseScript).toContain("CFBundleShortVersionString");
    expect(releaseScript).toContain("CFBundleVersion");
  });

  it("exposes one command for the complete release gate", () => {
    const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:release"]).toBe("bash scripts/verify-release.sh");
  });

  it("regenerates the checksum for every newly packaged archive", () => {
    const packageScript = read("scripts/package-mac-arm64.sh");

    expect(packageScript).toContain('shasum -a 256 "$(basename "$target_zip")"');
    expect(packageScript).toContain('mv "$publish_checksum" "$target_checksum"');
  });

  it("fails closed while checking tests, build, replay, screenshots, signing, architecture, and launch", () => {
    const script = read("scripts/verify-release.sh");

    expect(script).toContain("set -euo pipefail");
    expect(script).toContain("npm test");
    expect(script).toContain("npm run typecheck");
    expect(script).toContain("npm run build");
    expect(script).toContain("fixtures/logs/session-2026-07-10");
    expect(script).toContain("fixtures/logs/auto-match-session");
    expect(script).toContain("fixtures/logs/constructed-duplicate-create");
    expect(script).toContain("constructed-duplicate-replay");
    expect(script).toContain("牌库中暂无卡牌");
    expect(script).toContain("opponentGlobalEffects");
    expect(script).toContain("fixtures/logs/arena-session");
    expect(script).toContain("arena-redraft-partial-replay");
    expect(script).toContain("arena-redraft-exact-replay");
    expect(script).toContain("arena-playing-replay");
    expect(script).toContain("Decks.after-redraft.log");
    expect(script).toContain("unresolvedCount");
    expect(script).toContain('["选取率", "卡牌", "影响"]');
    expect(script).toContain('arena?.status !== "playing"');
    expect(script).toContain('body.includes("牌库 (29)")');
    expect(script).toContain('body.includes("等待开局")');
    expect(script).toContain('body.includes("影响全局")');
    expect(script).toContain("日志缺失的竞技场牌");
    expect(script).toContain("未解析竞技场牌");
    expect(script).toContain("QA_LOG_PATH");
    expect(script).toContain("QA_OPEN_OVERLAY");
    expect(script).toContain("QA_OPEN_OPPONENT_OVERLAY");
    expect(script).toContain("QA_OPEN_ARENA_CHOICE_OVERLAY");
    expect(script).toContain("QA_OPEN_LADDER_DECK_OVERLAY");
    expect(script).toContain("QA_OPEN_BOARD_ATTACK_OVERLAY");
    expect(script).toContain("codesign --verify --deep --strict");
    expect(script).toContain("NSScreenCaptureUsageDescription");
    expect(script).toContain("lipo -archs");
    expect(script).toContain("launched_pid=$!");
  });

  it("always reaps the exact QA Electron process and rejects visible CSS source", () => {
    const script = read("scripts/verify-release.sh");

    expect(script).toContain("cleanup_active_qa_process");
    expect(script).toContain("trap cleanup_active_qa_process EXIT");
    expect(script).toContain("active_qa_pid=$!");
    expect(script).toContain('wait "$active_qa_pid"');
    expect(script).toContain('kill -9 "$pid"');
    expect(script).not.toContain("pkill");
    expect(script).toContain('/\\.card-detail-(?:copy|heading|image)\\s*\\{/');
  });

  it("keeps isolated QA runs out of Dock before ready and cleans up failed starts", () => {
    const mainSource = read("src/main/main.ts");
    const activationPolicy = mainSource.indexOf('app.setActivationPolicy("accessory")');
    const readyHandler = mainSource.indexOf("app.whenReady()");

    expect(activationPolicy).toBeGreaterThan(-1);
    expect(readyHandler).toBeGreaterThan(-1);
    expect(activationPolicy).toBeLessThan(readyHandler);
    expect(mainSource).not.toContain("app.exit(1)");
    expect(mainSource.match(/process\.exitCode = 1;/g)).toHaveLength(2);
  });

  it("keeps release evidence while packaging and supports the system Bash 3 empty array", () => {
    const packageScript = read("scripts/package-mac-arm64.sh");
    const releaseScript = read("scripts/verify-release.sh");

    expect(packageScript).toContain('${electron_zip_args[@]+"${electron_zip_args[@]}"}');
    expect(packageScript).toContain('"$output_dir/release-verification"');
    expect(packageScript).toMatch(/release-verification[\s\S]{0,160}continue/);
    expect(releaseScript).toContain("发布验证证据在打包时被清理");
    expect(releaseScript).toContain("scenario\\tduration_ms\\tevidence");
  });

  it("rejects exact Arena QA output when the isolated card cache did not resolve every card", () => {
    const script = read("scripts/verify-release.sh");

    expect(script).toContain("Unknown card");
    expect(script).toContain("TEST_ARENA_");
    expect(script).toContain("trackerCards");
    expect(script).toContain("knownExactCard");
    expect(script).toContain("JSON.stringify");
  });

  it("replays every Arena redraft step from 30 through 35 candidates", () => {
    const script = read("scripts/verify-release.sh");

    expect(script).toContain("for candidate_count in 30 31 32 33 34 35; do");
    expect(script).toContain("/^arena-redraft-(35|34|33|32|31|30)-replay$/");
    expect(script).toContain("candidatesWithCompleteData !== expectedCandidateCount");
    expect(script).toContain('body.includes("?")');
    expect(script).toContain('body.includes("—")');
  });

  it("captures the packaged Arena hero ranking and validates the three-window layout", () => {
    const script = read("scripts/verify-release.sh");
    const mainSource = read("src/main/main.ts");

    expect(script).toContain("QA_OPEN_ARENA_HERO_RANKING_OVERLAY");
    expect(script).toContain("QA_OPEN_THREE_WINDOW_LAYOUT");
    expect(script).toContain("arena-hero-ranking-overlay");
    expect(script).toContain("three-window-layout");
    expect(script).toContain("qaWindowLayout");
    expect(script).toContain("windowsOverlap");
    expect(script).toContain("hero.bounds.width !== 100");
    expect(script).toContain("opponent.bounds.width !== 250");
    expect(script).toContain("friendly.bounds.width !== 100");
    expect(mainSource).toContain('"qa-arena-hero-ranking": "1"');
    expect(mainSource).toContain("qaMainWindowVisible");
    expect(script).toContain("report.qaMainWindowVisible !== false");
  });

  it("expects the split friendly-attack route in packaged board-attack QA", () => {
    const script = read("scripts/verify-release.sh");

    expect(script).toContain('"board-attack-overlay": "friendly-attack-overlay=1"');
    expect(script).not.toContain('"board-attack-overlay": "board-attack-overlay=1"');
  });

  it("captures the packaged smart-counter overlay through its dedicated QA route", () => {
    const script = read("scripts/verify-release.sh");
    const mainSource = read("src/main/main.ts");

    expect(script).toContain("run_capture smart-counter-overlay fixtures/logs/session-2026-07-10 QA_OPEN_SMART_COUNTER_OVERLAY");
    expect(script).toContain('"smart-counter-overlay": "smart-counter-overlay=1"');
    expect(script).toContain('if [[ "$name" == "smart-counter-overlay" ]]');
    expect(script).toContain('QA_APPLY_TRACKER_SETTINGS_EFFECTS="$qa_apply_tracker_settings_effects"');
    expect(mainSource).toContain("loginItemVerified: shouldSkipLaunchAtLoginUpdateDuringQaCapture(process.env)");
    expect(script).toContain('require_file "$screenshots_dir/smart-counter-overlay.png"');
    expect(script).toContain('require_file "$inspections_dir/smart-counter-overlay.json"');
  });

  it("requires Arena choice evidence with all four card metrics", () => {
    const script = read("scripts/verify-release.sh");
    const mainSource = read("src/main/main.ts");

    expect(script).toContain('require_file "$screenshots_dir/arena-choice-overlay.png"');
    expect(script).toContain('require_file "$inspections_dir/arena-choice-overlay.json"');
    expect(script).toContain('scenario === "arena-choice-overlay"');
    expect(script).toContain('["抽到影响", "对套牌影响", "选取率", "6+胜选取率"]');
    expect(script).toContain('["1.85", "-1.75", "36.4%", "40.2%", "-2.40", "3.10", "0.00"]');
    expect(mainSource).toContain("arenaChoiceMetrics");
    expect(script).toContain("report.arenaChoiceMetrics");
    expect(script).toMatch(/if \(scenario === "arena-choice-overlay"\) \{[\s\S]*?report\.arenaChoiceMetrics/);
    expect(script).toContain("items[0].y === items[1].y");
    expect(script).toContain("items[0].x === items[2].x");
  });

  it("keeps positive, negative, and neutral impact examples in Arena choice QA", () => {
    const appSource = read("src/renderer/App.tsx");

    expect(appSource).toContain("drawnImpact: 1.85");
    expect(appSource).toContain("deckImpact: -1.75");
    expect(appSource).toContain("drawnImpact: -2.4");
    expect(appSource).toContain("deckImpact: 3.1");
    expect(appSource).toContain("drawnImpact: 0");
    expect(appSource).toContain("deckImpact: 0");
  });

  it("rejects packaged QA output when isolated defaults drift", () => {
    const script = read("scripts/verify-release.sh");
    const mainSource = read("src/main/main.ts");

    expect(script).toContain("report.trackerSettings?.general?.startMinimized !== false");
    expect(script).toContain('report.trackerSettings?.overlay?.position !== "right"');
    expect(script).toContain("report.trackerSettings?.overlay?.showFriendlyAttack !== false");
    expect(script).toContain("report.trackerSettings?.overlay?.showOpponentAttack !== false");
    expect(mainSource).toContain("trackerSettings: rendererInspection.trackerSettings ?? trackerSettings");
  });

  it("ties the manual, global-switch, fold, and bounds contracts to the release gate", () => {
    const script = read("scripts/verify-release.sh");

    expect(script).toContain("tests/mainWindowVisibility.test.ts");
    expect(script).toContain("tests/automaticOverlayController.test.ts");
    expect(script).toContain("tests/opponentOverlayWindowController.test.ts");
    expect(script).toContain("tests/trackerSettingsStore.test.ts");
    expect(script).toContain("tests/overlayWindowBounds.test.ts");
  });

  it("documents generated evidence and manual-only screen recording acceptance", () => {
    const acceptance = read("docs/commercial-acceptance.md");

    expect(acceptance).toContain("npm run verify:release");
    expect(acceptance).toContain("outputs/release-verification");
    expect(acceptance).toContain("录屏权限仍需人工确认");
  });

  it("isolates QA user data before constructing persistent services", () => {
    const releaseScript = read("scripts/verify-release.sh");
    const mainSource = read("src/main/main.ts");
    const qaPathSetup = mainSource.indexOf('app.setPath("userData", process.env.QA_USER_DATA_DIR)');
    const firstPersistentService = Math.min(
      mainSource.indexOf("new CollectionDeckService()"),
      mainSource.indexOf("new TrackerService("),
      mainSource.indexOf("new CardDataService()")
    );

    expect(qaPathSetup).toBeGreaterThan(-1);
    expect(firstPersistentService).toBeGreaterThan(-1);
    expect(qaPathSetup).toBeLessThan(firstPersistentService);
    for (const constructor of ["new CollectionDeckService()", "new TrackerService(", "new CardDataService()"]) {
      expect(qaPathSetup).toBeLessThan(mainSource.indexOf(constructor));
    }
    expect(releaseScript.match(/QA_SKIP_LOG_CONFIG_REPAIR=1/g)).toHaveLength(3);
    expect(releaseScript.match(/QA_SKIP_ARENA_SCREEN_RECOGNITION=1/g)).toHaveLength(3);
    expect(releaseScript).toContain('rm -rf "$qa_user_data"');
    expect(releaseScript.indexOf('rm -rf "$qa_user_data"')).toBeLessThan(
      releaseScript.indexOf('mkdir -p "$qa_user_data"')
    );
    expect(releaseScript).toContain('launch_user_data="$evidence_dir/user-data/launch-check"');
    expect(releaseScript).toContain('rm -rf "$launch_user_data"');
    expect(releaseScript).toContain('mkdir -p "$launch_user_data"');
    expect(releaseScript).toContain('QA_USER_DATA_DIR="$launch_user_data"');
  });
});
