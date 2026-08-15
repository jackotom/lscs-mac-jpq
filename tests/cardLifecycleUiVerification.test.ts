import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), "utf8");

describe("card lifecycle Electron QA verification", () => {
  it("registers the project-Electron verification command", () => {
    const packageJson = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["verify:card-lifecycle-ui"])
      .toBe("node scripts/verify-card-lifecycle-ui.mjs");
  });

  it("defines nine isolated, hard-asserted scenarios without user data or another browser", () => {
    const script = read("scripts/verify-card-lifecycle-ui.mjs");
    const sources = `${script}\n${read("scripts/card-lifecycle-qa-environment.mjs")}`;
    for (const scenario of [
      "friendly-short",
      "friendly-tall",
      "friendly-insertions",
      "opponent-secret",
      "opponent-unknown-hand",
      "inline-normal",
      "inline-pinned",
      "external-normal",
      "external-pinned"
    ]) {
      expect(script).toContain(scenario);
    }
    expect(sources).toContain("mkdtemp");
    expect(sources).toContain("QA_USER_DATA_DIR");
    expect(sources).toContain("node_modules/.bin/electron");
    expect(sources).toContain("targetHeight = Math.min(900");
    expect(sources).toContain("tallWorkArea.height");
    expect(sources).toContain("actualScrollableSelectors");
    expect(sources).toContain("designatedScrollOwners");
    expect(sources).toContain("consoleErrorCount");
    expect(sources).toContain("outcomeRows");
    expect(sources).toContain("KeyboardEvent");
    expect(sources).not.toMatch(/\b(?:playwright|puppeteer|open|chrome|egolite)\b/i);
    expect(sources).not.toMatch(/(?:Library\/Logs\/Hearthstone|Documents\/text\/炉石传说|process\.env\.(?:HOME|USERPROFILE))/);
    expect(script).toContain('join(userData, "Power.log")');
    expect(sources).toContain('QA_LOCK_LOG_PATH: "1"');
    expect(script).toMatch(
      /assert\.equal\(\s*inspection\.trackerState\?\.logPath,\s*isolatedPowerLog/
    );
    expect(script).toMatch(
      /assert\.deepEqual\(\s*inspection\.inheritedNodeEnvironmentKeys,\s*\[\]/
    );
    expect(script).toMatch(
      /async function verifyFriendlyTall\(\) \{\s*if \(workAreas\.length === 0\) \{\s*throw new Error/
    );
  });

  it("sanitizes inherited QA and development environment before every Electron launch", () => {
    const sources = [
      read("scripts/verify-card-lifecycle-ui.mjs"),
      read("scripts/card-lifecycle-qa-environment.mjs")
    ].join("\n");
    expect(sources).toContain("/^QA_/");
    expect(sources).toContain("/^NODE_/");
    expect(sources).toContain("VITE_DEV_SERVER_URL");
    expect(sources).toContain("ELECTRON_RUN_AS_NODE");
    expect(sources).not.toContain("...process.env,");
  });

  it("drops every inherited NODE variable without restoring selected exceptions", async () => {
    const moduleUrl = pathToFileURL(
      join(root, "scripts/card-lifecycle-qa-environment.mjs")
    ).href;
    const environmentModule = await import(moduleUrl) as {
      createNodeEnvironmentUnsetArguments: (
        baseEnvironment: Record<string, string>
      ) => string[];
      createChildEnvironment: (
        baseEnvironment: Record<string, string>,
        extraEnvironment: Record<string, string>,
        userData: string,
        isolatedPowerLog: string,
        inspectPath: string
      ) => Record<string, string>;
    };
    const poisonedNodeEnvironment = {
      PATH: "/safe/bin",
      NODE_V8_COVERAGE: "/private/user-coverage",
      NODE_EXTRA_CA_CERTS: "/private/user-ca.pem",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      NODE_OPTIONS: "--require=/private/injected.cjs",
      NODE_PATH: "/private/node_modules"
    };
    const childEnvironment = environmentModule.createChildEnvironment(
      poisonedNodeEnvironment,
      { QA_OPEN_OVERLAY: "1" },
      "/tmp/isolated-user-data",
      "/tmp/isolated-user-data/Power.log",
      "/tmp/isolated-user-data/inspection.json"
    );
    expect(childEnvironment.PATH).toBe("/safe/bin");
    expect(Object.keys(childEnvironment).filter((key) => /^NODE_/.test(key))).toEqual([]);
    expect(
      environmentModule.createNodeEnvironmentUnsetArguments(poisonedNodeEnvironment)
    ).toEqual([
      "-u", "NODE_EXTRA_CA_CERTS",
      "-u", "NODE_OPTIONS",
      "-u", "NODE_PATH",
      "-u", "NODE_TLS_REJECT_UNAUTHORIZED",
      "-u", "NODE_V8_COVERAGE"
    ]);
  });

  it("owns and cleans only the detached Electron process group", () => {
    const script = read("scripts/verify-card-lifecycle-ui.mjs");
    expect(script).toContain("detached: true");
    expect(script).toContain('signalProcessGroup(processGroupId, "SIGTERM")');
    expect(script).toContain('signalProcessGroup(processGroupId, "SIGKILL")');
    expect(script).toContain("process.kill(-processGroupId, signal)");
    expect(script).not.toMatch(/\bpkill\b|\bkillall\b/);
  });

  it.each([
    ["unknown", "not-a-real-scenario", "未知"],
    ["blank", "   ", "不能为空"]
  ])("rejects an %s scenario filter before launching Electron", (_label, filter, message) => {
    const result = spawnSync(process.execPath, ["scripts/verify-card-lifecycle-ui.mjs"], {
      cwd: root,
      env: { ...process.env, QA_SCENARIO_FILTER: filter },
      encoding: "utf8",
      timeout: 5_000
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(message);
  });

  it("collects the complete computed-layout inspection and uses production pinning", () => {
    const main = read("src/main/main.ts");
    const overlayStyles = read("src/renderer/overlayStyles.css");
    for (const key of [
      "viewport",
      "layoutMode",
      "page",
      "expandedKeys",
      "shellRect",
      "mainRect",
      "footerRect",
      "visibleCardRowRects",
      "shellScrollSize",
      "mainScrollSize",
      "designatedScrollOwners",
      "actualScrollableSelectors",
      "consoleErrorCount",
      "preview"
    ]) {
      expect(main).toContain(key);
    }
    expect(main).toContain('process.env.QA_PIN_CARD_PREVIEW === "1"');
    expect(main).toContain('[aria-label="打开二级工作台"]');
    expect(main).toContain('[aria-label="打开卡牌资料"], [aria-label="打开卡牌数据库"]');
    expect(main).toContain("setCardPreviewPinned(true)");
    expect(main).toContain("new KeyboardEvent");
    expect(main).toContain('code: "KeyQ"');
    expect(main).toContain("getComputedStyle");
    expect(main).toContain("scrollHeight > element.clientHeight");
    expect(main).toContain("element.scrollWidth > element.clientWidth");
    expect(main).not.toMatch(
      /horizontalOverflowSelectors:[\s\S]{0,300}\/\(auto\|scroll\)\/\.test\(style\.overflowX\)/
    );
    expect(main).toContain('webContents.on("console-message"');
    expect(main).toContain("getQaConsoleErrorCount(cardPreviewWindow)");
    expect(main.indexOf("installQaConsoleErrorListener(window)"))
      .toBeLessThan(main.indexOf("await loadRendererPage(window,"));
    expect(main.indexOf("installQaConsoleErrorListener(cardPreviewWindow)"))
      .toBeLessThan(main.indexOf('await loadRendererPage(cardPreviewWindow, { "card-preview": "1" })'));
    expect(overlayStyles).toMatch(
      /\.overlay-card-groups:has\(> \.card-tracking-layout\)\s*\{[^}]*height:\s*100%;[^}]*max-height:\s*100%;[^}]*overflow:\s*hidden;/
    );
    expect(overlayStyles).toMatch(
      /\.card-tracking-layout\s*\{[^}]*height:\s*100%;[^}]*max-height:\s*100%;/
    );
    expect(overlayStyles).toMatch(
      /\.card-tracking-main\s*\{[^}]*overflow-y:\s*auto;/
    );
  });

  it("hard-asserts one preview scroll shell and zero result subtree scroll for every preview scenario", () => {
    const script = read("scripts/verify-card-lifecycle-ui.mjs");
    expect(script).toMatch(
      /assert\.deepEqual\(\s*preview\.actualScrollableSelectors,\s*\["\.card-preview-root"\]/
    );
    expect(script).toContain(
      "assert.deepEqual(preview.resultScrollableSelectors, []"
    );
    expect(script).toContain(
      "assert.equal(preview.consoleErrorCount, 0"
    );
    expect(script).toContain("assertPreviewScrollContract(name, preview)");
    expect(script.match(/assertPreviewScrollContract\(name, preview\)/g)).toHaveLength(3);
  });

  it("renders the Kel'Thuzad QA preview from the real pre-reveal tracker count", () => {
    const script = read("scripts/verify-card-lifecycle-ui.mjs");
    const main = read("src/main/main.ts");
    const kelthuzadPreviewBlock = main.slice(
      main.indexOf('process.env.QA_KELTHUZAD_CARD_PREVIEW === "1"'),
      main.indexOf('process.env.QA_TIME_FINS_CARD_PREVIEW === "1"')
    );

    expect(script).toContain("cardId=REV_845 player=2");
    expect(script).toContain("cardId=CORE_REV_845 player=2");
    expect(script).toContain("/复活 2 个/");
    expect(script).toContain("/会复活（2）/");
    expect(kelthuzadPreviewBlock).toContain("tracker.getState().opponentHand?.find");
    expect(kelthuzadPreviewBlock).toContain("details: qaKelthuzadDetails");
    expect(kelthuzadPreviewBlock).not.toContain("totalCount: 5");
  });

  it("reports the tallest available real-window case as verified", () => {
    const report = read(".superpowers/sdd/task-9-report.md");
    expect(report).toContain("验收已完成");
    expect(report).toContain("100×834");
    expect(report).toContain("9 个");
    expect(report).not.toContain("环境阻塞、未验证");
  });
});
