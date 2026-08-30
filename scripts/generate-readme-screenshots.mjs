import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createChildEnvironment,
  createNodeEnvironmentUnsetArguments
} from "./card-lifecycle-qa-environment.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const electronPath = join(projectRoot, "node_modules/.bin/electron");
const docsDirectory = join(projectRoot, "docs");
const screenshotDirectory = join(docsDirectory, "screenshots");
const temporaryRoot = await mkdtemp(join(tmpdir(), "hearthstone-readme-screenshots-"));
const renderedDirectory = join(temporaryRoot, "rendered");

const scenarios = [
  {
    name: "home-dashboard",
    width: 1280,
    height: 760,
    mainWindowVisible: true,
    environment: {
      QA_HOME_DEMO: "1",
      QA_MAIN_WIDTH: "1280",
      QA_MAIN_HEIGHT: "760"
    }
  },
  {
    name: "live-workbench",
    width: 1280,
    height: 760,
    mainWindowVisible: true,
    environment: {
      QA_HOME_DEMO: "1",
      QA_MAIN_VIEW: "打开二级工作台",
      QA_MAIN_WIDTH: "1280",
      QA_MAIN_HEIGHT: "760"
    }
  },
  {
    name: "friendly-overlay",
    width: 320,
    height: 640,
    mainWindowVisible: false,
    boundsFile: "overlay-window-bounds.json",
    environment: {
      QA_OPEN_OVERLAY: "1",
      QA_FRIENDLY_OVERLAY_DEMO: "1"
    }
  },
  {
    name: "opponent-overlay",
    width: 500,
    height: 340,
    mainWindowVisible: false,
    boundsFile: "opponent-overlay-window-bounds.json",
    environment: {
      QA_OPEN_OPPONENT_OVERLAY: "1",
      QA_CLICK_TEXTS: "历史|已使用"
    }
  }
];

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

function signalProcessGroup(processGroupId, signal) {
  try {
    process.kill(-processGroupId, signal);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ESRCH") return;
    throw error;
  }
}

async function waitForProcessGroupExit(processGroupId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (isProcessGroupAlive(processGroupId) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  return !isProcessGroupAlive(processGroupId);
}

async function terminateProcessGroup(processGroupId) {
  if (!processGroupId || !isProcessGroupAlive(processGroupId)) return;
  signalProcessGroup(processGroupId, "SIGTERM");
  if (await waitForProcessGroupExit(processGroupId, 1_500)) return;
  signalProcessGroup(processGroupId, "SIGKILL");
  assert.equal(
    await waitForProcessGroupExit(processGroupId, 1_500),
    true,
    `Electron 进程组 ${processGroupId} 未能清理`
  );
}

async function prepareScenario(scenario) {
  const userData = join(temporaryRoot, scenario.name);
  await mkdir(userData, { recursive: true });
  const isolatedPowerLog = join(userData, "Power.log");
  await writeFile(
    isolatedPowerLog,
    [
      "D 20:00:00.000 GameState.DebugPrintPower() - CREATE_GAME",
      "D 20:00:00.100 GameState.DebugPrintGame() - PlayerID=1, PlayerName=本地玩家",
      "D 20:00:00.200 GameState.DebugPrintGame() - PlayerID=2, PlayerName=Opponent"
    ].join("\n") + "\n",
    "utf8"
  );
  if (scenario.boundsFile) {
    await writeFile(
      join(userData, scenario.boundsFile),
      `${JSON.stringify({ x: 0, y: 0, width: scenario.width, height: scenario.height })}\n`,
      "utf8"
    );
  }
  return { userData, isolatedPowerLog };
}

async function runScenario(scenario) {
  const { userData, isolatedPowerLog } = await prepareScenario(scenario);
  const screenshotPath = join(renderedDirectory, `${scenario.name}.png`);
  const inspectPath = join(userData, "inspection.json");
  await mkdir(renderedDirectory, { recursive: true });

  const child = spawn("/usr/bin/env", [
    ...createNodeEnvironmentUnsetArguments(process.env),
    electronPath,
    projectRoot
  ], {
    cwd: projectRoot,
    env: createChildEnvironment(
      process.env,
      {
        ...scenario.environment,
        QA_SCREENSHOT_PATH: screenshotPath,
        QA_TRACKER_THEME: "light",
        QA_OVERLAY_THEME: "light"
      },
      userData,
      isolatedPowerLog,
      inspectPath
    ),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const processGroupId = child.pid;
  assert.ok(processGroupId, `${scenario.name}: 无法取得 Electron 进程组`);
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  let timeout;

  try {
    const exitCode = await Promise.race([
      new Promise((resolveExit, rejectExit) => {
        child.once("error", rejectExit);
        child.once("exit", (code, signal) => {
          if (signal) rejectExit(new Error(`${scenario.name}: Electron 被信号 ${signal} 终止`));
          else resolveExit(code);
        });
      }),
      new Promise((_, rejectTimeout) => {
        timeout = setTimeout(
          () => rejectTimeout(new Error(`${scenario.name}: Electron 截图超过 30 秒`)),
          30_000
        );
      })
    ]);
    assert.equal(exitCode, 0, `${scenario.name}: Electron 退出码应为 0\n${output.slice(-2_000)}`);

    const inspection = JSON.parse(await readFile(inspectPath, "utf8"));
    const png = await readFile(screenshotPath);
    assertCommonScenario(scenario, inspection, isolatedPowerLog);
    assertScenarioContent(scenario.name, inspection);
    assertPng(scenario, png);
    return { name: scenario.name, screenshotPath, png };
  } finally {
    clearTimeout(timeout);
    await terminateProcessGroup(processGroupId);
  }
}

function assertCommonScenario(scenario, inspection, isolatedPowerLog) {
  assert.equal(inspection.hasApi, true, `${scenario.name}: 必须通过桌面接口运行`);
  assert.match(inspection.location, /^file:\/\//, `${scenario.name}: 只能加载本地页面`);
  assert.equal(inspection.consoleErrorCount, 0, `${scenario.name}: 界面不能有控制台错误`);
  assert.equal(inspection.qaDockVisible, true, `${scenario.name}: 进程运行时必须保留 Dock 指示`);
  assert.equal(
    inspection.qaMainWindowVisible,
    scenario.mainWindowVisible,
    `${scenario.name}: 主窗口显隐状态错误`
  );
  assert.deepEqual(
    inspection.inheritedNodeEnvironmentKeys,
    [],
    `${scenario.name}: 不能继承 NODE_* 环境变量`
  );
  assert.equal(
    inspection.trackerState?.logPath,
    isolatedPowerLog,
    `${scenario.name}: 只能读取本场临时日志`
  );
  assert.deepEqual(
    { width: inspection.bounds.width, height: inspection.bounds.height },
    { width: scenario.width, height: scenario.height },
    `${scenario.name}: 窗口尺寸必须固定`
  );
  assert.deepEqual(
    inspection.viewport,
    { width: scenario.width, height: scenario.height },
    `${scenario.name}: 页面尺寸必须固定`
  );
  assert.deepEqual(
    inspection.horizontalOverflowSelectors,
    [],
    `${scenario.name}: 不能出现横向溢出`
  );
  assert.equal(inspection.clipboardText, "", `${scenario.name}: 截图不能读取剪贴板`);
  const bodyText = String(inspection.bodyText ?? "");
  assert.doesNotMatch(bodyText, /\/Users\/|@\w+\.|Token|Bearer|BEGIN [A-Z ]+PRIVATE KEY/iu);
}

function assertScenarioContent(name, inspection) {
  const bodyText = String(inspection.bodyText ?? "");
  if (name === "home-dashboard") {
    assert.match(bodyText, /对局正在记录/);
    assert.match(bodyText, /冰霜法/);
    assert.doesNotMatch(bodyText, /学徒猎人|炉石已确认这套牌/);
  } else if (name === "live-workbench") {
    assert.match(bodyText, /实时日志/);
    assert.match(bodyText, /我方牌库/);
    assert.match(bodyText, /实时事件流/);
    assert.doesNotMatch(bodyText, /\/QA\//);
  } else if (name === "friendly-overlay") {
    assert.equal(inspection.layoutMode, "tall");
    assert.equal(inspection.page, "current");
    assert.deepEqual(inspection.expandedKeys, ["deck", "hand"]);
    assert.ok(inspection.visibleCardRowRects.length >= 16, "我方悬浮窗应显示完整示例牌表");
    assert.match(bodyText, /寒冰箭/);
    assert.match(bodyText, /火球术/);
    assert.doesNotMatch(bodyText, /测试卡/);
  } else if (name === "opponent-overlay") {
    assert.equal(inspection.layoutMode, "opponent");
    assert.equal(inspection.page, "history");
    assert.deepEqual(inspection.expandedKeys, ["used"]);
    assert.ok(inspection.visibleCardRowRects.length >= 1, "对手悬浮窗应显示已使用卡牌");
    assert.ok(
      inspection.visibleOpponentUsedArtworkRects.length >= 1,
      "对手已使用历史应显示卡图"
    );
    assert.match(bodyText, /伺机待发/);
  }
}

function assertPng(scenario, png) {
  assert.ok(png.length > 10_000, `${scenario.name}: PNG 内容过小`);
  assert.deepEqual(
    [...png.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    `${scenario.name}: 输出不是 PNG`
  );
  const pixelWidth = png.readUInt32BE(16);
  const pixelHeight = png.readUInt32BE(20);
  const scaleFactor = pixelWidth / scenario.width;
  assert.ok([1, 2, 3].includes(scaleFactor), `${scenario.name}: PNG 缩放倍率异常`);
  assert.equal(pixelHeight / scenario.height, scaleFactor, `${scenario.name}: PNG 宽高缩放不一致`);
  assertPngHasNoTextMetadata(scenario.name, png);
  const raw = png.toString("latin1");
  assert.ok(!raw.includes("/Users/"), `${scenario.name}: PNG 含本机路径`);
}

function assertPngHasNoTextMetadata(name, png) {
  const forbiddenChunks = new Set(["tEXt", "zTXt", "iTXt", "eXIf"]);
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    assert.ok(!forbiddenChunks.has(type), `${name}: PNG 含 ${type} 元数据`);
    offset += 12 + length;
    if (type === "IEND") break;
  }
  assert.equal(offset, png.length, `${name}: PNG 块结构不完整`);
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function publishScreenshotSet(results) {
  await mkdir(docsDirectory, { recursive: true });
  const stagingDirectory = await mkdtemp(join(docsDirectory, ".screenshots-stage-"));
  const backupDirectory = join(docsDirectory, `.screenshots-backup-${process.pid}`);
  try {
    const manifestLines = [];
    for (const result of results) {
      const filename = `${result.name}.png`;
      await copyFile(result.screenshotPath, join(stagingDirectory, filename));
      manifestLines.push(`${createHash("sha256").update(result.png).digest("hex")}  ${filename}`);
    }
    await writeFile(join(stagingDirectory, "SHA256SUMS"), `${manifestLines.sort().join("\n")}\n`, "utf8");

    const hadPreviousSet = await pathExists(screenshotDirectory);
    if (hadPreviousSet) await rename(screenshotDirectory, backupDirectory);
    try {
      await rename(stagingDirectory, screenshotDirectory);
    } catch (error) {
      if (hadPreviousSet && await pathExists(backupDirectory)) {
        await rename(backupDirectory, screenshotDirectory);
      }
      throw error;
    }
    await rm(backupDirectory, { recursive: true, force: true });
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
    await rm(backupDirectory, { recursive: true, force: true });
  }
}

try {
  const results = [];
  for (const scenario of scenarios) {
    const result = await runScenario(scenario);
    results.push(result);
    process.stdout.write(`通过 ${scenario.name}\n`);
  }
  await publishScreenshotSet(results);
  process.stdout.write(`README 截图已更新：${screenshotDirectory}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
