import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createChildEnvironment,
  createNodeEnvironmentUnsetArguments
} from "./card-lifecycle-qa-environment.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const electronPath = join(projectRoot, "node_modules/.bin/electron");
const fixturePath = join(projectRoot, "fixtures/card-tracking/full-hand-burn.log");
const scenarioNames = [
  "friendly-short",
  "friendly-tall",
  "friendly-insertions",
  "opponent-secret",
  "opponent-unknown-hand",
  "opponent-used-artwork",
  "opponent-kelthuzad-preview",
  "friendly-fins-preview",
  "inline-normal",
  "inline-pinned",
  "external-normal",
  "external-pinned"
];
const rawScenarioFilter = process.env.QA_SCENARIO_FILTER;
if (rawScenarioFilter !== undefined && rawScenarioFilter.trim() === "") {
  throw new Error("QA_SCENARIO_FILTER 不能为空");
}
const scenarioFilter = rawScenarioFilter?.trim();
if (scenarioFilter && !scenarioNames.includes(scenarioFilter)) {
  throw new Error(`未知 QA_SCENARIO_FILTER：${scenarioFilter}`);
}

const fixtureText = await readFile(fixturePath, "utf8");
const insertionFixtureText = [
  fixtureText,
  "D 14:00:24.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=MAIN_ACTION",
  "D 14:00:24.100 GameState.DebugPrintPower() - FULL_ENTITY - Updating [entityName=天空主母 id=219 zone=PLAY zonePos=1 cardId=SOURCE_001 player=1] CardID=SOURCE_001",
  ...Array.from({ length: 5 }, (_, index) => {
    const entityId = 300 + index;
    return [
      `D 14:00:25.00${index} GameState.DebugPrintPower() - FULL_ENTITY - Creating ID=${entityId} CardID=`,
      `D 14:00:25.00${index} GameState.DebugPrintPower() -     tag=ZONE value=DECK`,
      `D 14:00:25.00${index} GameState.DebugPrintPower() -     tag=CONTROLLER value=1`,
      `D 14:00:25.00${index} GameState.DebugPrintPower() - TAG_CHANGE Entity=${entityId} tag=DISPLAYED_CREATOR value=219`,
      `D 14:00:25.00${index} GameState.DebugPrintPower() - SHOW_ENTITY - Updating Entity=${entityId} CardID=TOKEN_001`,
      `D 14:00:25.00${index} GameState.DebugPrintPower() -     tag=ZONE value=DECK`
    ].join("\n");
  }),
  "D 14:00:26.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=星界碎片 id=300 zone=DECK zonePos=0 cardId=TOKEN_001 player=1] tag=ZONE_POSITION value=1"
].join("\n");
const kelthuzadFixtureText = [
  fixtureText,
  "D 14:00:23.100 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=不稳定的骷髅 id=241 zone=PLAY cardId=REV_845 player=2] tag=ZONE value=GRAVEYARD",
  "D 14:00:23.100 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=不稳定的骷髅 id=241 zone=PLAY cardId=REV_845 player=2] tag=ZONE value=GRAVEYARD",
  "D 14:00:23.200 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=不稳定的骷髅 id=242 zone=PLAY cardId=CORE_REV_845 player=2] tag=ZONE value=GRAVEYARD",
  "D 14:00:23.200 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=不稳定的骷髅 id=242 zone=PLAY cardId=CORE_REV_845 player=2] tag=ZONE value=GRAVEYARD",
  "D 14:00:24.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=天定之灾克尔苏加德 id=240 zone=DECK cardId=REV_514 player=2] tag=ZONE value=HAND"
].join("\n");
const finsFixtureText = [
  "D 15:02:59.000 GameState.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED",
  "D 15:02:59.100 GameState.DebugPrintGame() - PlayerID=1, PlayerName=本地玩家",
  "D 15:02:59.200 GameState.DebugPrintGame() - PlayerID=2, PlayerName=UNKNOWN HUMAN PLAYER",
  "D 15:03:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=起手牌甲 id=40 zone=DECK cardId=START_A player=1] tag=ZONE value=HAND",
  "D 15:03:00.100 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=被换掉的牌 id=41 zone=DECK cardId=MULLIGAN_B player=1] tag=ZONE value=HAND",
  "D 15:03:00.200 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=起手牌乙 id=42 zone=DECK cardId=START_C player=1] tag=ZONE value=HAND",
  "D 15:03:00.300 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=幸运币 id=46 zone=DECK cardId=TIME_COIN1 player=1] tag=ZONE value=HAND",
  "D 15:03:00.400 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=NEXT_STEP value=MAIN_READY",
  "D 15:03:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=被换掉的牌 id=41 zone=HAND cardId=MULLIGAN_B player=1] tag=ZONE value=DECK",
  "D 15:03:01.100 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=换入的起手牌 id=43 zone=DECK cardId=START_D player=1] tag=ZONE value=HAND",
  "D 15:03:02.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=MAIN_READY",
  "D 15:03:03.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=超时空鳍侠 id=44 zone=DECK cardId=TIME_706 player=1] tag=ZONE value=HAND",
  "D 15:03:04.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=MAIN_ACTION"
].join("\n");
const temporaryRoot = await mkdtemp(join(tmpdir(), "hearthstone-card-lifecycle-ui-"));
const failures = [];
let workArea;
let workAreas = [];

const cardCache = {
  source: "脱敏生命周期 QA 卡牌库",
  version: "card-lifecycle-ui-1",
  fetchedAt: new Date().toISOString(),
  cards: [
    {
      dbfId: 103270,
      cardId: "TOY_372",
      name: "匣中古神",
      collectible: 1,
      type: "SPELL",
      cost: 7,
      text: "随机施放5个法术。".repeat(120)
    },
    { dbfId: 1, cardId: "BURNED_CARD", name: "烧毁测试牌", collectible: 1, type: "SPELL", cost: 1 },
    { dbfId: 2, cardId: "FRIEND_USE", name: "普通使用牌", collectible: 1, type: "SPELL", cost: 2 },
    { dbfId: 3, cardId: "SOURCE_001", name: "天空主母", collectible: 1, type: "MINION", cost: 6 },
    { dbfId: 4, cardId: "TOKEN_001", name: "星界碎片", collectible: 0, type: "SPELL", cost: 2 },
    {
      dbfId: 79767,
      cardId: "REV_514",
      name: "天定之灾克尔苏加德",
      collectible: 1,
      type: "MINION",
      cost: 8,
      text: "战吼：复活你的不稳定的骷髅。战场上放不下的骷髅会立即爆炸。（复活 个）"
    },
    { dbfId: 79798, cardId: "REV_845", name: "不稳定的骷髅", collectible: 0, type: "MINION", cost: 2 },
    { dbfId: 79799, cardId: "CORE_REV_845", name: "不稳定的骷髅", collectible: 0, type: "MINION", cost: 2 },
    {
      dbfId: 120774,
      cardId: "TIME_706",
      name: "超时空鳍侠",
      collectible: 1,
      type: "MINION",
      cost: 2,
      text: "战吼：将你的手牌替换为你的起始手牌。在你的回合结束时换回。"
    },
    { dbfId: 200001, cardId: "START_A", name: "起手牌甲", collectible: 1, type: "SPELL", cost: 1 },
    { dbfId: 200002, cardId: "MULLIGAN_B", name: "被换掉的牌", collectible: 1, type: "MINION", cost: 2 },
    { dbfId: 200003, cardId: "START_C", name: "起手牌乙", collectible: 1, type: "WEAPON", cost: 3 },
    { dbfId: 200004, cardId: "START_D", name: "换入的起手牌", collectible: 1, type: "SPELL", cost: 4 },
    { dbfId: 200005, cardId: "TIME_COIN1", name: "幸运币", collectible: 0, type: "SPELL", cost: 0 },
    ...Array.from({ length: 15 }, (_, index) => ({
      dbfId: 200 + index,
      cardId: `RANDOM_SPELL_${index + 1}`,
      name: `随机法术${index + 1}`,
      collectible: 1,
      type: "SPELL",
      cost: (index % 10) + 1,
      text: `脱敏法术说明${index + 1}。`
    }))
  ]
};
const qaDeckText = [
  "2x 烧毁测试牌",
  "2x 普通使用牌",
  "2x 匣中古神",
  ...Array.from({ length: 6 }, (_, index) => `1x 随机法术${index + 1}`)
].join("\n");

async function prepareUserData(name, bounds, opponent = false, powerLogText = fixtureText) {
  const userData = join(temporaryRoot, name);
  await mkdir(userData, { recursive: true });
  const isolatedPowerLog = join(userData, "Power.log");
  await writeFile(isolatedPowerLog, powerLogText, "utf8");
  await writeFile(
    join(userData, "hearthstone-cards.zhCN.blizzard.json"),
    `${JSON.stringify(cardCache)}\n`,
    "utf8"
  );
  if (bounds) {
    await writeFile(
      join(userData, opponent ? "opponent-overlay-window-bounds.json" : "overlay-window-bounds.json"),
      `${JSON.stringify(bounds)}\n`,
      "utf8"
    );
  }
  return { userData, isolatedPowerLog };
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

async function runElectronScenario(
  name,
  extraEnvironment = {},
  bounds,
  opponent = false,
  powerLogText = fixtureText
) {
  const { userData, isolatedPowerLog } = await prepareUserData(name, bounds, opponent, powerLogText);
  const inspectPath = join(userData, "inspection.json");
  const child = spawn("/usr/bin/env", [
    ...createNodeEnvironmentUnsetArguments(process.env),
    electronPath,
    projectRoot
  ], {
    cwd: projectRoot,
    env: createChildEnvironment(
      process.env,
      extraEnvironment,
      userData,
      isolatedPowerLog,
      inspectPath
    ),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const processGroupId = child.pid;
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  let timeout;
  try {
    const exitCode = await Promise.race([
      new Promise((resolveExit, rejectExit) => {
        child.once("error", rejectExit);
        child.once("exit", (code, signal) => {
          if (signal) rejectExit(new Error(`${name} Electron 被信号 ${signal} 终止`));
          else resolveExit(code);
        });
      }),
      new Promise((_, rejectTimeout) => {
        timeout = setTimeout(() => rejectTimeout(new Error(`${name} Electron 验证超时`)), 30_000);
      })
    ]);
    assert.equal(exitCode, 0, `${name} Electron 退出码应为 0\n${output.slice(-2000)}`);
    const inspection = JSON.parse(await readFile(inspectPath, "utf8"));
    assert.equal(
      inspection.trackerState?.logPath,
      isolatedPowerLog,
      `${name}: 只能读取本场临时 Power.log`
    );
    assert.deepEqual(
      inspection.inheritedNodeEnvironmentKeys,
      [],
      `${name}: Electron 不能继承任何 NODE_* 环境变量`
    );
    return inspection;
  } finally {
    clearTimeout(timeout);
    await terminateProcessGroup(processGroupId);
  }
}

function assertCommon(name, inspection) {
  assert.equal(inspection.consoleErrorCount, 0, `${name}: 控制台不能有错误`);
  assertNoHorizontalOverflow(name, inspection);
  assert.deepEqual(
    inspection.designatedScrollOwners,
    ["card-tracking-main"],
    `${name}: 只能指定主内容区滚动；${JSON.stringify({
      location: inspection.location,
      layoutMode: inspection.layoutMode,
      bodyText: inspection.bodyText,
      trackerState: {
        status: inspection.trackerState?.status,
        trackerMode: inspection.trackerState?.trackerMode,
        gameActive: inspection.trackerState?.gameActive,
        logPath: inspection.trackerState?.logPath,
        arena: inspection.trackerState?.arena
      }
    })}`
  );
  assert.ok(
    !inspection.actualScrollableSelectors.some((selector) => selector.includes("overlay-shell")),
    `${name}: 外壳不能滚动`
  );
  assert.ok(
    inspection.shellScrollSize.scrollHeight <= inspection.shellScrollSize.clientHeight,
    `${name}: 外壳内容不能溢出`
  );
  assert.ok(
    inspection.shellScrollSize.scrollWidth <= inspection.shellScrollSize.clientWidth,
    `${name}: 外壳不能横向滚动`
  );
}

function assertNoHorizontalOverflow(name, inspection) {
  assert.deepEqual(
    inspection.horizontalOverflowSelectors,
    [],
    `${name}: 任意元素都不能横向溢出`
  );
}

function assertExactWindow(name, inspection, width, height) {
  assert.deepEqual(
    { width: inspection.bounds.width, height: inspection.bounds.height },
    { width, height },
    `${name}: BrowserWindow 尺寸必须精确`
  );
  assert.deepEqual(inspection.viewport, { width, height }, `${name}: viewport 必须精确`);
}

async function verifyFriendlyShort() {
  const inspection = await runElectronScenario(
    "friendly-short",
    {
      QA_OPEN_OVERLAY: "1",
      QA_DECK_TEXT: qaDeckText
    },
    { x: 0, y: 0, width: 100, height: 200 }
  );
  workArea = inspection.workArea;
  workAreas = inspection.workAreas;
  assertExactWindow("friendly-short", inspection, 100, 200);
  assertCommon("friendly-short", inspection);
  assert.equal(inspection.layoutMode, "short");
  assert.equal(inspection.page, "current");
  assert.deepEqual(inspection.expandedKeys, ["deck"]);
  assert.deepEqual(
    inspection.actualScrollableSelectors,
    ["main.card-tracking-main"],
    `friendly-short: 强制溢出只能由主内容区滚动；${JSON.stringify({
      mainScrollSize: inspection.mainScrollSize,
      shellRect: inspection.shellRect,
      shellComputed: inspection.shellComputed,
      visibleRows: inspection.visibleCardRowRects.length,
      bodyText: inspection.bodyText
    })}`
  );
  assert.ok(inspection.visibleCardRowRects.length >= 3, "friendly-short: 牌库至少三行");
  const third = inspection.visibleCardRowRects[2];
  assert.ok(third.top >= inspection.mainRect.top && third.bottom <= inspection.mainRect.bottom, "friendly-short: 第三行必须在主内容区");
  assert.ok(third.bottom <= inspection.footerRect.top, "friendly-short: 第三行不能盖住底栏");
}

async function verifyFriendlyTall() {
  if (workAreas.length === 0) {
    throw new Error("无法读取任何显示器 workArea，不能验证 tall 布局");
  }
  const tallWorkArea = workAreas
    .slice()
    .sort((left, right) => right.height - left.height)[0];
  const targetHeight = Math.min(900, tallWorkArea.height);
  if (targetHeight < 400) {
    throw new Error(`当前环境无法验证 tall 布局：所有显示器 workArea=${JSON.stringify(workAreas)}`);
  }
  const inspection = await runElectronScenario(
    "friendly-tall",
    {
      QA_OPEN_OVERLAY: "1",
      QA_DECK_TEXT: qaDeckText
    },
    { x: tallWorkArea.x, y: tallWorkArea.y, width: 100, height: targetHeight }
  );
  assertExactWindow("friendly-tall", inspection, 100, targetHeight);
  assertCommon("friendly-tall", inspection);
  assert.equal(inspection.layoutMode, "tall");
  assert.equal(inspection.page, "current");
  assert.deepEqual(inspection.expandedKeys, ["deck", "hand"]);
}

async function verifyFriendlyInsertions() {
  const targetWorkArea = workAreas
    .slice()
    .sort((left, right) => right.height - left.height)[0] ?? { x: 0, y: 0, height: 600 };
  const targetHeight = Math.min(600, targetWorkArea.height);
  const inspection = await runElectronScenario(
    "friendly-insertions",
    {
      QA_OPEN_OVERLAY: "1"
    },
    { x: targetWorkArea.x, y: targetWorkArea.y, width: 100, height: targetHeight },
    false,
    insertionFixtureText
  );
  assertExactWindow("friendly-insertions", inspection, 100, targetHeight);
  assertCommon("friendly-insertions", inspection);
  assert.match(inspection.bodyText, /天空主母创建\s*5张卡牌/);
  assert.match(inspection.bodyText, /置顶：\s*星界碎片/);
  assert.match(inspection.bodyText, /星界碎片/);
  assert.ok(!/卡牌[ABCDＡＢＣＤ]/.test(inspection.bodyText), "friendly-insertions: 禁止显示伪造卡牌名");
}

async function verifyOpponentSecret() {
  const inspection = await runElectronScenario(
    "opponent-secret",
    { QA_OPEN_OPPONENT_OVERLAY: "1" },
    {
      x: workArea?.x ?? 0,
      y: workArea?.y ?? 0,
      width: 250,
      height: 170
    },
    true
  );
  assertExactWindow("opponent-secret", inspection, 250, 170);
  assertCommon("opponent-secret", inspection);
  assert.equal(inspection.layoutMode, "opponent");
  assert.deepEqual(inspection.expandedKeys, ["secret"]);
}

async function verifyOpponentUnknownHand() {
  const inspection = await runElectronScenario(
    "opponent-unknown-hand",
    {
      QA_OPEN_OPPONENT_OVERLAY: "1",
      QA_OPPONENT_REAL_STATE: "1",
      QA_OPEN_TRACKING_GROUP: "hand"
    },
    {
      x: workArea?.x ?? 0,
      y: workArea?.y ?? 0,
      width: 250,
      height: 170
    },
    true
  );
  assertExactWindow("opponent-unknown-hand", inspection, 250, 170);
  assertCommon("opponent-unknown-hand", inspection);
  assert.deepEqual(inspection.expandedKeys, ["hand"]);
  assert.deepEqual(inspection.unknownHandRows, ["未公开 ×1"]);
}

async function verifyOpponentUsedArtwork() {
  const inspection = await runElectronScenario(
    "opponent-used-artwork",
    {
      QA_OPEN_OPPONENT_OVERLAY: "1",
      QA_CLICK_TEXTS: "历史|已使用"
    },
    {
      x: workArea?.x ?? 0,
      y: workArea?.y ?? 0,
      width: 250,
      height: 300
    },
    true
  );
  assertExactWindow("opponent-used-artwork", inspection, 250, 300);
  assertCommon("opponent-used-artwork", inspection);
  assert.equal(inspection.page, "history");
  assert.deepEqual(inspection.expandedKeys, ["used"]);
  assert.ok(
    inspection.visibleOpponentUsedArtworkRects.length >= 1,
    "opponent-used-artwork: 对手已使用历史必须显示卡图"
  );
}

async function verifyOpponentKelthuzadPreview() {
  const overlayScreenshotPath = join(
    projectRoot,
    "outputs/release-verification/opponent-kelthuzad-overlay.png"
  );
  const previewScreenshotPath = join(
    projectRoot,
    "outputs/release-verification/opponent-kelthuzad-preview.png"
  );
  const inspection = await runElectronScenario(
    "opponent-kelthuzad-preview",
    {
      QA_OPEN_OPPONENT_OVERLAY: "1",
      QA_OPPONENT_REAL_STATE: "1",
      QA_SHOW_CARD_PREVIEW: "1",
      QA_KELTHUZAD_CARD_PREVIEW: "1",
      QA_OPEN_TRACKING_GROUP: "hand",
      QA_SCREENSHOT_PATH: overlayScreenshotPath,
      QA_CARD_PREVIEW_SCREENSHOT_PATH: previewScreenshotPath
    },
    {
      x: workArea?.x ?? 0,
      y: workArea?.y ?? 0,
      width: 250,
      height: 300
    },
    true,
    kelthuzadFixtureText
  );
  assertExactWindow("opponent-kelthuzad-preview", inspection, 250, 300);
  assertCommon("opponent-kelthuzad-preview", inspection);
  assert.match(inspection.bodyText, /天定之灾克尔苏加德/);
  assert.equal(
    inspection.trackerState?.cardTracking?.contextDetailsBySideAndCardKey?.opponent?.["id:rev_514"]
      ?.gameContextSections?.[0]?.totalCount,
    2,
    "克尔苏加德尚未公开自身标签时，必须按同侧骷髅死亡记录得到 2"
  );
  assert.equal(
    inspection.preview.visible,
    true,
    `克尔苏加德详情应显示；${JSON.stringify({
      bodyText: inspection.bodyText,
      expandedKeys: inspection.expandedKeys,
      preview: inspection.preview
    })}`
  );
  assert.match(inspection.preview.text, /复活 2 个/);
  assert.match(inspection.preview.text, /会复活（2）/);
  assert.doesNotMatch(inspection.preview.text, /复活\s*个/);
  assert.equal(inspection.preview.consoleErrorCount, 0, "克尔苏加德详情不能有控制台错误");
}

async function verifyFriendlyFinsPreview() {
  const previewScreenshotPath = join(
    projectRoot,
    "outputs/release-verification/friendly-fins-preview.png"
  );
  const inspection = await runElectronScenario(
    "friendly-fins-preview",
    {
      QA_OPEN_OVERLAY: "1",
      QA_SHOW_CARD_PREVIEW: "1",
      QA_TIME_FINS_CARD_PREVIEW: "1",
      QA_OPEN_TRACKING_GROUP: "hand",
      QA_CARD_PREVIEW_SCREENSHOT_PATH: previewScreenshotPath
    },
    {
      x: workArea?.x ?? 0,
      y: workArea?.y ?? 0,
      width: 250,
      height: 320
    },
    false,
    finsFixtureText
  );
  assertExactWindow("friendly-fins-preview", inspection, 250, 320);
  assertCommon("friendly-fins-preview", inspection);
  assert.equal(inspection.qaDockVisible, false, "隔离验收不能在 Dock 留下测试图标");
  assert.deepEqual(
    inspection.trackerState?.cardTracking?.contextDetailsBySideAndCardKey?.friendly?.["id:time_706"]
      ?.gameContextSections?.[0]?.cards?.map((card) => card.name),
    ["起手牌甲", "起手牌乙", "换入的起手牌"],
    "真实日志状态必须保存换牌后的三张起始牌，并排除换掉的牌和幸运币"
  );
  assert.equal(inspection.preview.visible, true, "超时空鳍侠详情应显示");
  assert.match(inspection.preview.text, /我的起始手牌（3）/);
  assert.match(inspection.preview.text, /起手牌甲/);
  assert.match(inspection.preview.text, /起手牌乙/);
  assert.match(inspection.preview.text, /换入的起手牌/);
  assert.doesNotMatch(inspection.preview.text, /关联牌（0）|暂无关联牌资料|被换掉的牌|幸运币/);
  assert.equal(inspection.preview.consoleErrorCount, 0, "超时空鳍侠详情不能有控制台错误");
}

function assertNormalPreview(name, preview) {
  assertPreviewScrollContract(name, preview);
  assert.equal(preview.visible, true, `${name}: 预览应显示`);
  assert.equal(preview.pinned, false, `${name}: 普通预览不能固定`);
  assert.equal(preview.poolExpanded, false, `${name}: 普通预览不能显示候选池`);
  assert.equal(preview.poolRows, 0, `${name}: 普通预览不能渲染候选池行`);
  assert.equal(preview.continueButton, false, `${name}: 普通预览不能显示继续按钮`);
}

function assertPinnedPreview(name, preview, withOutcomes) {
  assertPreviewScrollContract(name, preview);
  assert.equal(preview.visible, true, `${name}: 固定预览应显示`);
  assert.equal(preview.pinned, true, `${name}: 必须通过真实固定逻辑`);
  assert.equal(preview.poolExpanded, true, `${name}: 固定预览应展开候选池`);
  assert.equal(preview.poolRows, 12, `${name}: 首批候选池必须显示 12 张`);
  assert.equal(preview.continueButton, true, `${name}: 候选池必须有继续按钮`);
  assert.equal(preview.afterUnpinHidden, true, `${name}: 取消固定并离开后必须自动隐藏`);
  if (withOutcomes) assertOutcomeDetails(name, preview);
}

function assertPreviewScrollContract(name, preview) {
  assert.equal(preview.consoleErrorCount, 0, `${name}: 详情窗口控制台不能有错误`);
  assert.deepEqual(
    preview.actualScrollableSelectors,
    [".card-preview-root"],
    `${name}: 详情只能由外壳滚动；${JSON.stringify({
      scrollSize: preview.scrollSize,
      text: preview.text?.slice(0, 240)
    })}`
  );
  assert.deepEqual(preview.resultScrollableSelectors, [], `${name}: 结果子树不能形成滚动区`);
}

function assertOutcomeDetails(name, preview) {
  assert.deepEqual(preview.outcomeRows, [5, 10], `${name}: 五连和双倍结果数量必须精确`);
  assert.equal(preview.duplicateSpellCount, 2, `${name}: 重复法术必须保留两次`);
  assert.equal(preview.nestedOutcomeGroups, 1, `${name}: 嵌套古神层级必须保留`);
  assert.deepEqual(preview.designatedScrollOwners, [], `${name}: 结果子树不能声明滚动所有者`);
  assert.deepEqual(preview.resultScrollableSelectors, [], `${name}: 结果子树不能形成第二滚动区`);
}

async function verifyInline(name, pinned) {
  const inspection = await runElectronScenario(name, {
    QA_OPEN_CARD_LIBRARY: "1",
    QA_CARD_LIBRARY_SEARCH: "匣中古神",
    QA_HOVER_CARD: "1",
    ...(pinned ? { QA_INLINE_PIN_KEYBOARD_EVENT: "KeyboardEvent" } : {})
  });
  assert.equal(inspection.consoleErrorCount, 0, `${name}: 控制台不能有错误`);
  if (pinned) assertPinnedPreview(name, inspection.preview, false);
  else assertNormalPreview(name, inspection.preview);
}

async function verifyExternal(name, pinned) {
  const inspection = await runElectronScenario(
    name,
    {
      QA_OPEN_OVERLAY: "1",
      QA_SHOW_CARD_PREVIEW: "1",
      ...(pinned ? { QA_PIN_CARD_PREVIEW: "1" } : {})
    },
    {
      x: workArea?.x ?? 0,
      y: workArea?.y ?? 0,
      width: 300,
      height: 600
    }
  );
  assert.equal(inspection.consoleErrorCount, 0, `${name}: 控制台不能有错误`);
  if (pinned) assertPinnedPreview(name, inspection.preview, true);
  else {
    assertNormalPreview(name, inspection.preview);
    assertOutcomeDetails(name, inspection.preview);
  }
}

const verifications = [
  ["friendly-short", verifyFriendlyShort],
  ["friendly-tall", verifyFriendlyTall],
  ["friendly-insertions", verifyFriendlyInsertions],
  ["opponent-secret", verifyOpponentSecret],
  ["opponent-unknown-hand", verifyOpponentUnknownHand],
  ["opponent-used-artwork", verifyOpponentUsedArtwork],
  ["opponent-kelthuzad-preview", verifyOpponentKelthuzadPreview],
  ["friendly-fins-preview", verifyFriendlyFinsPreview],
  ["inline-normal", () => verifyInline("inline-normal", false)],
  ["inline-pinned", () => verifyInline("inline-pinned", true)],
  ["external-normal", () => verifyExternal("external-normal", false)],
  ["external-pinned", () => verifyExternal("external-pinned", true)]
];

try {
  assert.deepEqual(verifications.map(([name]) => name), scenarioNames);
  for (const [name, verify] of verifications) {
    if (scenarioFilter && name !== scenarioFilter) continue;
    try {
      await verify();
      process.stdout.write(`通过 ${name}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${name}: ${message}`);
      process.stderr.write(`失败 ${name}: ${message}\n`);
    }
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

if (failures.length > 0) {
  throw new AggregateError(failures.map((message) => new Error(message)), `生命周期 UI 验证失败：${failures.length} 项`);
}

process.stdout.write(scenarioFilter ? `指定场景 ${scenarioFilter} 通过\n` : `${scenarioNames.length} 个生命周期 Electron 场景全部通过\n`);
