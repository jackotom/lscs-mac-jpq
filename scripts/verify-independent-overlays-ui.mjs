import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isElectronChild = process.env.QA_INDEPENDENT_OVERLAYS_CHILD === "1";

if (isElectronChild) {
  void runElectronChild();
} else {
  await runParent();
}

async function runParent() {
  const electronPath = (await import("electron")).default;
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "hearthstone-independent-overlays-"));
  const reportPath = path.join(temporaryRoot, "report.json");
  await writeFile(path.join(temporaryRoot, "package.json"), `${JSON.stringify({
    name: "hearthstone-independent-overlays-qa",
    private: true,
    type: "module",
    main: "main.mjs"
  })}\n`, "utf8");
  await writeFile(
    path.join(temporaryRoot, "main.mjs"),
    `import ${JSON.stringify(pathToFileURL(fileURLToPath(import.meta.url)).href)};\n`,
    "utf8"
  );
  const child = spawn(electronPath, [temporaryRoot], {
    cwd: projectRoot,
    detached: true,
    env: cleanEnvironment(process.env, {
      QA_INDEPENDENT_OVERLAYS_CHILD: "1",
      QA_INDEPENDENT_OVERLAYS_ROOT: temporaryRoot,
      QA_INDEPENDENT_OVERLAYS_REPORT: reportPath,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1"
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  const processGroupId = child.pid;
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });

  try {
    const exitCode = await waitForChild(child, 45_000);
    assert.equal(exitCode, 0, `独立悬浮窗 Electron 验收失败\n${output.slice(-4000)}`);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.passed, true, JSON.stringify(report, null, 2));
    const mainSource = await readFile(path.join(projectRoot, "src/main/main.ts"), "utf8");
    const settingsEffectsStart = mainSource.indexOf("async function applyTrackerSettingsEffects");
    const settingsEffectsEnd = mainSource.indexOf("function overlayWindows", settingsEffectsStart);
    const settingsEffects = mainSource.slice(settingsEffectsStart, settingsEffectsEnd);
    report.sourceContracts = {
      oneBrowserWindowPerCounter: mainSource.includes("new Map<string, BrowserWindow>()"),
      routeCarriesCounterId: mainSource.includes('"smart-counter-id": counterId'),
      singleHideClosesMatchingWindow: settingsEffects.includes(
        "if (hidden.has(counterId)) releaseSmartCounterOverlayWindow(counterId)"
      ),
      masterOffClosesAll: settingsEffects.includes("releaseAllSmartCounterOverlayWindows()")
    };
    assert.equal(
      Object.values(report.sourceContracts).every(Boolean),
      true,
      `智能计数设置开关契约不完整：${JSON.stringify(report.sourceContracts)}`
    );
    assert.equal(await waitForProcessGroupExit(processGroupId, 2_000), true, "验收 Electron 进程组退出后仍有残留");
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`验收证据：${temporaryRoot}\n`);
  } catch (error) {
    await terminateProcessGroup(processGroupId);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\n${output.slice(-4000)}`);
  }
}

async function runElectronChild() {
  const { app, BrowserWindow, screen } = await import("electron");
  process.stdout.write("QA Electron 主进程已加载\n");
  app.on("window-all-closed", () => undefined);
  const { writeFile } = await import("node:fs/promises");
  const evidenceRoot = requiredEnvironment("QA_INDEPENDENT_OVERLAYS_ROOT");
  const reportPath = requiredEnvironment("QA_INDEPENDENT_OVERLAYS_REPORT");
  const userData = path.join(evidenceRoot, "user-data");
  app.setPath("userData", userData);
  app.commandLine.appendSwitch("disable-gpu-sandbox");

  const report = {
    passed: false,
    display: undefined,
    windows: [],
    closeSequence: [],
    opponentSecretDuplicate: undefined,
    smartCounterSwitches: undefined,
    screenshots: [],
    findings: []
  };

  try {
    await app.whenReady();
    process.stdout.write("QA Electron 已 ready\n");
    const [{
      getAuxiliaryOverlayBounds,
      getSecretOverlayBounds,
      getSmartCounterOverlayBounds,
      getBoardAttackOverlayWindowOptions,
      configureBoardAttackOverlayWindow
    }] =
      await Promise.all([
        import(pathToFileURL(path.join(projectRoot, "dist-electron/main/boardAttackOverlay.js")).href)
      ]);
    const display = screen.getPrimaryDisplay();
    report.display = display.bounds;
    const indexPath = path.join(projectRoot, "dist/index.html");
    const specs = [
      {
        id: "friendly-attack",
        title: "QA 我方场攻",
        query: { "friendly-attack-overlay": "1", "qa-opponent-demo": "1" },
        selector: ".single-attack-overlay",
        expectedText: "7"
      },
      {
        id: "opponent-attack",
        title: "QA 对手场攻",
        query: { "opponent-attack-overlay": "1", "qa-opponent-demo": "1" },
        selector: ".single-attack-overlay",
        expectedText: "12"
      },
      {
        id: "secret",
        title: "QA 奥秘预测",
        query: { "secret-overlay": "1", "qa-secret-dense": "1" },
        selector: ".secret-overlay",
        expectedText: "绿洲盟军",
        possibleCandidateCounts: [10]
      },
      {
        id: "smart-dragon",
        boundsKind: "smart-counter",
        smartIndex: 0,
        smartCounterId: "qa-friendly-dragons",
        title: "QA 龙牌计数",
        query: {
          "smart-counter-overlay": "1",
          "smart-counter-id": "qa-friendly-dragons",
          "qa-opponent-demo": "1"
        },
        selector: ".smart-counter-overlay",
        expectedText: "3/5"
      },
      {
        id: "smart-void-soul",
        boundsKind: "smart-counter",
        smartIndex: 1,
        smartCounterId: "qa-opponent-void-souls",
        title: "QA 虚空灵魂计数",
        query: {
          "smart-counter-overlay": "1",
          "smart-counter-id": "qa-opponent-void-souls",
          "qa-opponent-demo": "1"
        },
        selector: ".smart-counter-overlay",
        expectedText: "4"
      }
    ];
    const records = [];

    for (const spec of specs) {
      const bounds = spec.smartCounterId
        ? getSmartCounterOverlayBounds(display.bounds, spec.smartIndex)
        : spec.id === "secret"
          ? getSecretOverlayBounds(display.bounds, spec.possibleCandidateCounts)
          : getAuxiliaryOverlayBounds(display.bounds, spec.boundsKind ?? spec.id);
      const window = new BrowserWindow({
        ...getBoardAttackOverlayWindowOptions(bounds, ""),
        title: spec.title,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: true
        }
      });
      configureBoardAttackOverlayWindow(window);
      let focusEvents = 0;
      let consoleErrorCount = 0;
      window.on("focus", () => { focusEvents += 1; });
      window.webContents.on("console-message", (details, legacyLevel) => {
        if (details.level === "error" || legacyLevel === 3) consoleErrorCount += 1;
      });
      await window.loadFile(indexPath, { query: spec.query });
      await waitForRenderer(window, spec.selector);
      window.showInactive();
      if (spec.id === "secret") await waitForSecretArtwork(window);
      await delay(250);
      const inspection = await inspectWindow(window, spec.selector);
      const screenshotPath = path.join(evidenceRoot, `${spec.id}.png`);
      await writeFile(screenshotPath, (await window.capturePage()).toPNG());
      const actualBounds = window.getBounds();
      const record = {
        id: spec.id,
        title: spec.title,
        bounds: actualBounds,
        expectedBounds: bounds,
        visible: window.isVisible(),
        focused: window.isFocused(),
        focusable: window.isFocusable(),
        focusEvents,
        consoleErrorCount,
        ...inspection,
        screenshotPath
      };
      recordCheck(report, spec.id, "BrowserWindow 尺寸或位置不正确", sameBounds(actualBounds, bounds));
      recordCheck(report, spec.id, "窗口未显示", record.visible === true);
      recordCheck(report, spec.id, "窗口抢占了焦点", record.focused === false);
      recordCheck(report, spec.id, "窗口不应允许获得焦点", record.focusable === false);
      recordCheck(report, spec.id, "显示期间触发了 focus", record.focusEvents === 0);
      recordCheck(report, spec.id, "渲染控制台有错误", record.consoleErrorCount === 0);
      recordCheck(report, spec.id, "根节点数量不正确", record.rootCount === 1);
      recordCheck(report, spec.id, "演示数据未渲染", new RegExp(spec.expectedText).test(record.bodyText));
      recordCheck(report, spec.id, "文档背景不是透明的", record.transparentDocument === true);
      recordCheck(
        report,
        spec.id,
        `存在横向溢出：${record.horizontalOverflowSelectors.join(", ")}`,
        record.horizontalOverflowSelectors.length === 0
      );
      if (spec.smartCounterId) {
        recordCheck(report, spec.id, "单项智能计数窗只能渲染一个计数器", record.smartCounterCount === 1);
        recordCheck(report, spec.id, "智能计数卡图溢出圆形容器", record.smartArtworkContained === true);
      }
      if (spec.id === "secret") {
        recordCheck(report, spec.id, "奥秘滚动内容容器缺失", record.secretBodyCount === 1);
        recordCheck(report, spec.id, "密集演示数据的奥秘槽数量不是 1", record.secretSlotCount === 1);
        recordCheck(report, spec.id, "密集演示数据的候选数量不是 10", record.secretCandidateCount === 10);
        recordCheck(report, spec.id, "密集演示数据的末项不正确", record.secretLastCandidateText === "绿洲盟军");
        recordCheck(
          report,
          spec.id,
          "不是每个可选奥秘都有卡图容器",
          record.secretArtworkCount === record.secretCandidateCount
        );
        recordCheck(
          report,
          spec.id,
          "可选奥秘缺少卡图或加载失败占位",
          record.secretArtworkMediaCount === record.secretCandidateCount
        );
        recordCheck(report, spec.id, "奥秘卡图 img 缺少来源", record.secretImageSourcesValid === true);
        recordCheck(report, spec.id, "奥秘卡图仍处于未加载状态", record.secretUnsettledImageCount === 0);
        recordCheck(
          report,
          spec.id,
          "密集演示的奥秘卡图没有全部真实加载",
          record.secretLoadedImageCount === record.secretCandidateCount
        );
        recordCheck(report, spec.id, "奥秘卡图没有铺满横向候选行", record.secretArtworkSizesValid === true);
        recordCheck(report, spec.id, "奥秘卡图溢出候选行或自身容器", record.secretArtworkContained === true);
        recordCheck(report, spec.id, "奥秘内容容器存在横向溢出", record.secretBodyHasHorizontalOverflow === false);
        recordCheck(report, spec.id, "奥秘标题没有固定在窗口顶部", record.secretHeaderStayedFixed === true);
        recordCheck(report, spec.id, "奥秘标题高度没有贴合参考图", record.secretCompactHeaderHeight === true);
        recordCheck(report, spec.id, "奥秘候选行高没有贴合参考图", record.secretCompactRowHeights === true);
        recordCheck(report, spec.id, "奥秘候选缺少费用窄栏", record.secretCostColumnCount === record.secretCandidateCount);
        recordCheck(report, spec.id, "奥秘候选没有保持单列", record.secretSingleColumnLayout === true);
        recordCheck(report, spec.id, "奥秘窗缺少左上问号徽章", record.secretQuestionBadgeCount === 1);
        recordCheck(report, spec.id, "奥秘牌条本体不是参考图的 124px", record.secretPanelWidthMatchesReference === true);
        recordCheck(report, spec.id, "仍有奥秘候选落在可视区域外", record.secretAllCandidatesVisible === true);
        recordCheck(report, spec.id, "最后一个奥秘候选不可见", record.secretLastCandidateVisible === true);
      }
      records.push({ spec, window, record });
      report.windows.push(record);
      report.screenshots.push(screenshotPath);
    }

    const opponentWindow = new BrowserWindow({
      width: 250,
      height: 170,
      show: false,
      frame: false,
      transparent: true,
      focusable: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    await opponentWindow.loadFile(indexPath, {
      query: { "opponent-overlay": "1", "qa-opponent-demo": "1" }
    });
    await waitForRenderer(opponentWindow, ".opponent-overlay-shell");
    report.opponentSecretDuplicate = await opponentWindow.webContents.executeJavaScript(`(() => ({
      secretOverlayCount: document.querySelectorAll(".secret-overlay").length,
      secretSlotCount: document.querySelectorAll(".opponent-secret-slot").length,
      containsCandidate: document.body.innerText.includes("法术反制")
    }))()`);
    recordCheck(
      report,
      "opponent-overlay",
      "普通对手记牌窗仍重复显示奥秘候选",
      JSON.stringify(report.opponentSecretDuplicate) === JSON.stringify({
        secretOverlayCount: 0,
        secretSlotCount: 0,
        containsCandidate: false
      })
    );
    opponentWindow.destroy();

    const smartRecords = records.filter(({ spec }) => spec.smartCounterId);
    const [firstSmart, secondSmart] = smartRecords;
    firstSmart.window.close();
    await delay(80);
    const secondStayedVisible = !secondSmart.window.isDestroyed() && secondSmart.window.isVisible();
    report.smartCounterSwitches = {
      singleClosed: firstSmart.spec.id,
      singleDestroyed: firstSmart.window.isDestroyed(),
      otherStayedVisible: secondStayedVisible,
      allClosedAfterCloseAll: false
    };
    recordCheck(report, firstSmart.spec.id, "关闭一个智能计数窗时另一个也受影响", secondStayedVisible);

    for (const current of smartRecords) {
      if (!current.window.isDestroyed()) current.window.close();
    }
    await delay(80);
    report.smartCounterSwitches.allClosedAfterCloseAll = smartRecords.every(({ window }) => window.isDestroyed());
    recordCheck(
      report,
      "smart-counter-close-all",
      "关闭全部智能计数测试窗口后仍有窗口存活",
      report.smartCounterSwitches.allClosedAfterCloseAll
    );

    const regularRecords = records.filter(({ spec }) => !spec.smartCounterId);
    for (let index = 0; index < regularRecords.length; index += 1) {
      const current = regularRecords[index];
      current.window.close();
      await delay(80);
      const otherWindowsIntact = regularRecords
        .filter((_, candidateIndex) => candidateIndex > index)
        .every(({ window }) => !window.isDestroyed() && window.isVisible());
      report.closeSequence.push({
        closed: current.spec.id,
        destroyed: current.window.isDestroyed(),
        otherWindowsIntact
      });
      recordCheck(report, current.spec.id, "close 后未销毁", current.window.isDestroyed() === true);
      recordCheck(report, current.spec.id, "关闭时影响了其他悬浮窗", otherWindowsIntact === true);
    }

    assert.deepEqual(report.findings, [], `独立悬浮窗发现 ${report.findings.length} 个问题`);
    report.passed = true;
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    app.quit();
  } catch (error) {
    report.error = error instanceof Error ? error.stack ?? error.message : String(error);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8").catch(() => undefined);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.destroy();
    }
    app.exit(1);
  }
}

async function inspectWindow(window, rootSelector) {
  return await window.webContents.executeJavaScript(`(() => {
    const selectorFor = (element) => {
      if (element.id) return "#" + element.id;
      const classes = Array.from(element.classList).slice(0, 2).join(".");
      return classes ? element.tagName.toLowerCase() + "." + classes : element.tagName.toLowerCase();
    };
    const all = [document.documentElement, document.body, ...document.querySelectorAll("*")];
    const artPairs = Array.from(document.querySelectorAll(".smart-counter-art")).map((art) => {
      const image = art.querySelector("img");
      if (!image) return true;
      const outer = art.getBoundingClientRect();
      const inner = image.getBoundingClientRect();
      return inner.left >= outer.left - 0.5 && inner.top >= outer.top - 0.5 &&
        inner.right <= outer.right + 0.5 && inner.bottom <= outer.bottom + 0.5;
    });
    const secretCandidates = Array.from(document.querySelectorAll(".secret-overlay-candidates > li"));
    const secretArtwork = secretCandidates
      .map((candidate) => candidate.querySelector(".secret-overlay-art"))
      .filter(Boolean);
    const secretArtworkMedia = secretCandidates.filter((candidate) => {
      const art = candidate.querySelector(".secret-overlay-art");
      const image = art?.querySelector("img[src]:not([src=''])");
      return Boolean((image?.complete && image.naturalWidth > 0) || art?.querySelector(".secret-overlay-art-fallback"));
    });
    const secretImages = secretArtwork.flatMap((art) => Array.from(art.querySelectorAll("img")));
    const secretArtworkSizes = secretArtwork.map((art) => {
      const bounds = art.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    });
    const secretArtworkContained = secretArtwork.every((art) => {
      const artBounds = art.getBoundingClientRect();
      const rowBounds = art.closest("li")?.getBoundingClientRect();
      const cardBounds = art.parentElement?.getBoundingClientRect();
      const image = art.querySelector("img");
      const imageBounds = image?.getBoundingClientRect();
      const insideArtwork = (inner, outer) => inner.left >= outer.left - 1.5 && inner.top >= outer.top - 1.5 &&
        inner.right <= outer.right + 1.5 && inner.bottom <= outer.bottom + 1.5;
      return Boolean(rowBounds && cardBounds) &&
        insideArtwork(cardBounds, rowBounds) &&
        insideArtwork(artBounds, cardBounds) &&
        (!imageBounds || insideArtwork(imageBounds, artBounds));
    });
    const secretBody = document.querySelector(".secret-overlay-body");
    const secretOverlay = document.querySelector(".secret-overlay");
    const secretHeader = document.querySelector(".secret-overlay-header");
    const secretSlots = Array.from(document.querySelectorAll(".secret-overlay-slot"));
    const secretCandidateLists = Array.from(document.querySelectorAll(".secret-overlay-candidates"));
    const secretCosts = Array.from(document.querySelectorAll(".secret-overlay-cost"));
    const inside = (inner, outer) => inner.left >= outer.left - 0.5 && inner.top >= outer.top - 0.5 &&
      inner.right <= outer.right + 0.5 && inner.bottom <= outer.bottom + 0.5;
    const secretBodyBounds = secretBody?.getBoundingClientRect();
    const secretOverlayBounds = secretOverlay?.getBoundingClientRect();
    const secretHeaderBounds = secretHeader?.getBoundingClientRect();
    const secretCandidateVisibility = secretCandidates.map((candidate) =>
      Boolean(secretBodyBounds && inside(candidate.getBoundingClientRect(), secretBodyBounds))
    );
    return {
      location: window.location.href,
      rootCount: document.querySelectorAll(${JSON.stringify(rootSelector)}).length,
      bodyText: document.body.innerText.replace(/\\s+/g, " ").trim(),
      transparentDocument: getComputedStyle(document.documentElement).backgroundColor === "rgba(0, 0, 0, 0)" &&
        getComputedStyle(document.body).backgroundColor === "rgba(0, 0, 0, 0)",
      horizontalOverflowSelectors: [...new Set(all.filter((element) => element.scrollWidth > element.clientWidth)
        .map(selectorFor))],
      smartCounterCount: document.querySelectorAll(".smart-counter-item").length,
      smartArtworkContained: artPairs.every(Boolean),
      secretBodyCount: document.querySelectorAll(".secret-overlay-body").length,
      secretSlotCount: secretSlots.length,
      secretCandidateCount: secretCandidates.length,
      secretLastCandidateText: secretCandidates.at(-1)?.querySelector(".secret-overlay-name")?.textContent?.trim() ?? "",
      secretArtworkCount: secretArtwork.length,
      secretArtworkMediaCount: secretArtworkMedia.length,
      secretImageCount: secretImages.length,
      secretFallbackCount: document.querySelectorAll(".secret-overlay-art-fallback").length,
      secretImageSources: secretImages.map((image) => image.getAttribute("src") ?? ""),
      secretImageSourcesValid: secretImages.every((image) => Boolean(image.getAttribute("src")?.trim())),
      secretLoadedImageCount: secretImages.filter((image) => image.complete && image.naturalWidth > 0).length,
      secretUnsettledImageCount: secretImages.filter((image) => !image.complete || image.naturalWidth === 0).length,
      secretArtworkSizes,
      secretArtworkSizesValid: secretArtworkSizes.length === secretCandidates.length &&
        secretArtworkSizes.every(({ width, height }) => width >= 100 && width <= 106 && height >= 16 && height <= 18),
      secretArtworkContained,
      secretBodyHasHorizontalOverflow: secretBody ? secretBody.scrollWidth > secretBody.clientWidth : true,
      secretBodyHasVerticalOverflow: secretBody ? secretBody.scrollHeight > secretBody.clientHeight : true,
      secretHeaderStayedFixed: Boolean(secretHeaderBounds && secretOverlayBounds &&
        getComputedStyle(secretHeader).position === "sticky" &&
        Math.abs(secretHeaderBounds.top - secretOverlayBounds.top) <= 1.5),
      secretCompactHeaderHeight: Boolean(secretHeaderBounds && Math.abs(secretHeaderBounds.height - 18) <= 0.5),
      secretCompactRowHeights: secretCandidates.length > 0 && secretCandidates.every((candidate) =>
        Math.abs(candidate.getBoundingClientRect().height - 17) <= 0.5
      ),
      secretCostColumnCount: secretCosts.length,
      secretQuestionBadgeCount: document.querySelectorAll(".secret-overlay-badge").length,
      secretPanelWidthMatchesReference: Boolean(secretOverlayBounds && Math.abs(secretOverlayBounds.width - 124) <= 0.5),
      secretSingleColumnLayout: secretCandidateLists.length > 0 && secretCandidateLists.every((list) =>
        getComputedStyle(list).gridTemplateColumns.trim().split(/\s+/).length === 1
      ),
      secretAllCandidatesVisible: secretCandidateVisibility.length === secretCandidates.length &&
        secretCandidateVisibility.every(Boolean),
      secretLastCandidateVisible: secretCandidateVisibility.at(-1) === true
    };
  })()`);
}

async function waitForRenderer(window, selector) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const ready = await window.webContents.executeJavaScript(
      `document.documentElement.dataset.rendererReady === "true" && Boolean(document.querySelector(${JSON.stringify(selector)}))`
    );
    if (ready) return;
    await delay(50);
  }
  throw new Error(`渲染超时：${selector}`);
}

async function waitForSecretArtwork(window) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const state = await window.webContents.executeJavaScript(`(() => {
      const candidates = Array.from(document.querySelectorAll(".secret-overlay-candidates > li"));
      return {
        candidateCount: candidates.length,
        settled: candidates.length > 0 && candidates.every((candidate) => {
          const artwork = candidate.querySelector(".secret-overlay-art");
          const image = artwork?.querySelector("img[src]:not([src=''])");
          return Boolean((image?.complete && image.naturalWidth > 0) ||
            artwork?.querySelector(".secret-overlay-art-fallback"));
        })
      };
    })()`);
    if (state.candidateCount > 0 && state.settled) return;
    await delay(50);
  }
  throw new Error("奥秘卡图在 10 秒内既未加载成功，也未显示失败占位");
}

function cleanEnvironment(base, extra) {
  return {
    ...Object.fromEntries(Object.entries(base).filter(([key]) =>
      !/^NODE_/.test(key) && !/^QA_/.test(key) && !/^VITE_/.test(key) && key !== "ELECTRON_RUN_AS_NODE"
    )),
    ...extra
  };
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`缺少环境变量：${name}`);
  return value;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sameBounds(left, right) {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function recordCheck(report, id, message, passed) {
  if (!passed) report.findings.push({ id, message });
}

function waitForChild(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Electron 验收超时")), timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (signal) reject(new Error(`Electron 被信号 ${signal} 终止`));
      else resolve(code);
    });
  });
}

function isProcessGroupAlive(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ESRCH") return false;
    if (error && typeof error === "object" && error.code === "EPERM") return true;
    throw error;
  }
}

async function waitForProcessGroupExit(processGroupId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (isProcessGroupAlive(processGroupId) && Date.now() < deadline) await delay(50);
  return !isProcessGroupAlive(processGroupId);
}

async function terminateProcessGroup(processGroupId) {
  if (!processGroupId || !isProcessGroupAlive(processGroupId)) return;
  process.kill(-processGroupId, "SIGTERM");
  if (await waitForProcessGroupExit(processGroupId, 1_500)) return;
  process.kill(-processGroupId, "SIGKILL");
  await waitForProcessGroupExit(processGroupId, 1_500);
}
