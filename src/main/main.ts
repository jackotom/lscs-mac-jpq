import { app, BrowserWindow, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, systemPreferences, Tray } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { autoRepairLogConfigOnStartup, ensureLogConfig, inspectLogConfig } from "./logConfig.js";
import { discoverLogCandidates } from "./logDiscovery.js";
import { TrackerService } from "./trackerService.js";
import {
  ArenaScreenRecognizer,
  ScreenCaptureError,
  cleanupStaleScreenCaptures,
  resolveArenaOcrHelperPath
} from "./arenaScreenRecognition.js";
import { CollectionDeckService } from "./collectionDeckService.js";
import { CardDataService } from "./cardDataService.js";
import { shouldShowArenaChoiceOverlay } from "./arenaChoiceOverlayVisibility.js";
import { AutomaticOverlayController } from "./automaticOverlayController.js";
import { getFrontmostAppName, isHearthstoneFrontmost, isHearthstoneOrTrackerFrontmost } from "./frontmostApp.js";
import { resolveFrontmostAppHelperPath } from "./frontmostApp.js";
import { CardPreviewVisibilityGate } from "./cardPreviewVisibility.js";
import {
  isQaOverlayCapture,
  presentMainWindow,
  shouldFocusMainWindowOnLaunch,
  shouldHandleAppActivate,
  shouldPreventAutomatedCaptureClose,
  shouldRunBoardAttackOverlayMonitor,
  shouldShowMainWindowOnLaunch
} from "./mainWindowVisibility.js";
import {
  hideQaDockAfterLaunch,
  requestQaQuit,
  shouldApplyTrackerSettingsEffectsDuringQaCapture,
  shouldSkipLaunchAtLoginUpdateDuringQaCapture,
  shouldUseQaAccessoryActivationPolicy,
  waitForQaRendererSettled
} from "./qaCaptureTiming.js";
import {
  getAnchoredOverlayWindowBounds,
  getDefaultArenaHeroRankingWindowBounds,
  getDefaultOpponentOverlayWindowBounds,
  getDefaultOverlayWindowBounds,
  normalizeOpponentOverlayWindowBounds,
  normalizeOverlayWindowBounds
} from "./overlayWindowBounds.js";
import {
  didOverlayPreviewControlsChange,
  OverlaySettingsPreviewSession,
  shouldAllowOverlayDuringSettingsPreview
} from "./overlaySettingsPreviewSession.js";
import {
  type AuxiliaryOverlayKind,
  configureBoardAttackOverlayWindow,
  getAuxiliaryOverlayBounds,
  getBoardAttackOverlayWindowOptions,
  getHeroHealthOverlayBounds,
  getSecretOverlayBounds,
  getSmartCounterOverlayBounds,
  setAuxiliaryOverlayMouseInteractive,
  shouldShowBoardAttackOverlay
} from "./boardAttackOverlay.js";
import { registerAuxiliaryOverlayIpc } from "./auxiliaryOverlayIpc.js";
import {
  AuxiliaryOverlayWindowStateStore,
  getSmartCounterIdFromOverlayKind,
  getSmartCounterOverlayKind,
  getSecretOverlayVisibleBounds,
  moveAuxiliaryOverlayBounds,
  type AuxiliaryOverlayBounds,
  type AuxiliaryOverlayPoint,
  type AuxiliaryOverlayWorkArea,
  type MovableAuxiliaryOverlayKind
} from "./auxiliaryOverlayWindowState.js";
import { registerFriendlyOverlayIpc } from "./friendlyOverlayIpc.js";
import { registerOpponentOverlayIpc } from "./opponentOverlayIpc.js";
import { OpponentOverlayWindowState } from "./opponentOverlayWindowState.js";
import { OpponentOverlayWindowController } from "./opponentOverlayWindowController.js";
import {
  HEARTHSTONE_DISPLAY_CAPTURE_TYPES,
  HEARTHSTONE_WINDOW_CAPTURE_TYPES,
  selectHearthstoneWindowCaptureSource,
  selectTargetDisplayCaptureSource
} from "./screenCaptureSource.js";
import { LadderDeckRecommendationService } from "./ladderDeckRecommendationService.js";
import { LadderDeckOverlayController, resolveLadderDeckMode } from "./ladderDeckOverlayController.js";
import { getLadderDeckOverlayBounds } from "./ladderDeckOverlayBounds.js";
import { assertTrustedIpcEvent, configureSecureNavigation, createSecureWebPreferences } from "./electronSecurity.js";
import { resolveTrustedDevServerUrl } from "./rendererPage.js";
import { AppQuitController } from "./appQuitController.js";
import { AppRunState } from "./appRunState.js";
import { DEFAULT_TRACKER_SETTINGS, parseTrackerSettings, TrackerSettingsStore } from "./trackerSettingsStore.js";
import { createCardLibraryErrorResult, listCardLibrary } from "../shared/cardDatabase.js";
import { DiagnosticLogger } from "./diagnosticLogger.js";
import { ArenaHeroStatsService } from "./arenaHeroStatsService.js";
import { HomeNewsService } from "./homeNewsService.js";
import { WindowBoundsPersistence } from "./windowBoundsPersistence.js";
import { applyLaunchAtLoginSetting } from "./launchAtLogin.js";
import {
  configureOverlayWorkspaceWindow,
  getOverlayWindowPlatformOptions,
  reassertOverlayWindowPresentation
} from "./overlayWindowWorkspace.js";
import {
  formatStartupHealthFailures,
  runStartupHealthCheck
} from "./startupHealthCheck.js";
import type { CardLibraryResult, CardPreviewRequest, CollectionDeck, CollectionDeckScanResult, PublicTrackerState, TrackerSettings } from "../shared/types.js";
import type { LadderMode } from "../shared/ladderDeckRecommendation.js";
import { ArenaRunStore } from "./arenaRunStore.js";
import { ArenaInsightsService } from "./arenaInsightsService.js";
import { CollectionInsightsStore } from "./collectionInsightsStore.js";
import { CollectionInsightsService, parseCollectionCsvIpcInput } from "./collectionInsightsService.js";
import { createAppPermissionManager } from "./appPermissions.js";

if (process.env.QA_USER_DATA_DIR) {
  app.setPath("userData", process.env.QA_USER_DATA_DIR);
  app.setPath("logs", path.join(process.env.QA_USER_DATA_DIR, "logs"));
}

const useQaAccessoryActivationPolicy = shouldUseQaAccessoryActivationPolicy(process.env, process.platform);
if (useQaAccessoryActivationPolicy) {
  app.setActivationPolicy("accessory");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadRendererPage(
  window: BrowserWindow,
  query: Readonly<Record<string, string>> = {}
): Promise<void> {
  const devUrl = resolveTrustedDevServerUrl(
    process.env.VITE_DEV_SERVER_URL,
    app.isPackaged,
    query
  );
  if (devUrl) {
    await window.loadURL(devUrl);
    return;
  }
  await window.loadFile(path.join(__dirname, "../../dist/index.html"), { query });
}

const diagnosticLogger = new DiagnosticLogger(app.getPath("logs"));
const appRunState = new AppRunState(app.getPath("userData"));
process.on("uncaughtExceptionMonitor", (error) => {
  diagnosticLogger.error("主进程未捕获异常", error);
});
process.on("unhandledRejection", (reason) => {
  diagnosticLogger.error("主进程未处理的异步失败", reason);
});
const collectionDecks = new CollectionDeckService();
const screenRecordingSettingsUrl =
  "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture";
const appPermissionManager = createAppPermissionManager({
  getScreenCaptureStatus: () => systemPreferences.getMediaAccessStatus("screen"),
  requestScreenCapture: async () => {
    await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1, height: 1 },
      fetchWindowIcons: false
    });
  },
  openScreenRecordingSettings: async () => {
    await shell.openExternal(screenRecordingSettingsUrl);
  }
});
const arenaScreenRecognizer = process.env.QA_SKIP_ARENA_SCREEN_RECOGNITION === "1"
  ? { recognize: async () => ({ status: "ok" as const, texts: [] }) }
  : new ArenaScreenRecognizer(undefined, captureHearthstoneDisplay);
const arenaInsights = new ArenaInsightsService(new ArenaRunStore());
const collectionInsights = new CollectionInsightsService(new CollectionInsightsStore());
const tracker = new TrackerService(collectionDecks, arenaScreenRecognizer, undefined, arenaInsights);
const trackerSettingsStore = new TrackerSettingsStore(app.getPath("userData"));
const auxiliaryOverlayWindowStateStore = new AuxiliaryOverlayWindowStateStore(app.getPath("userData"));
let trackerSettings: TrackerSettings = DEFAULT_TRACKER_SETTINGS;
const cardLibraryData = new CardDataService();
const homeNews = new HomeNewsService();
let cardLibraryMetadata: { source?: string; version?: string } = {};
let mainWindow: BrowserWindow | undefined;
let overlayWindow: BrowserWindow | undefined;
let overlayWindowCreationPromise: Promise<BrowserWindow> | undefined;
let opponentOverlayWindow: BrowserWindow | undefined;
let opponentOverlayWindowCreationPromise: Promise<BrowserWindow> | undefined;
let friendlyAttackOverlayWindow: BrowserWindow | undefined;
let opponentAttackOverlayWindow: BrowserWindow | undefined;
let friendlyHealthOverlayWindow: BrowserWindow | undefined;
let opponentHealthOverlayWindow: BrowserWindow | undefined;
let secretOverlayWindow: BrowserWindow | undefined;
let secretOverlayExpandedBounds: AuxiliaryOverlayBounds | undefined;
const smartCounterOverlayWindows = new Map<string, BrowserWindow>();
const trustedAuxiliaryWebContents = new Set<Electron.WebContents>();
const auxiliaryOverlayKindsByWebContents = new Map<Electron.WebContents, MovableAuxiliaryOverlayKind>();
const auxiliaryOverlayDragSessions = new Map<MovableAuxiliaryOverlayKind, {
  readonly window: BrowserWindow;
  readonly initialBounds: AuxiliaryOverlayBounds;
  readonly initialPointer: AuxiliaryOverlayPoint;
  readonly workArea: AuxiliaryOverlayWorkArea;
}>();
const smartCounterOverlayGenerations = new Map<string, symbol>();
let ladderDeckOverlayWindow: BrowserWindow | undefined;
let arenaChoiceOverlayWindow: BrowserWindow | undefined;
let arenaHeroRankingWindow: BrowserWindow | undefined;
let cardPreviewWindow: BrowserWindow | undefined;
let cardPreviewSourceWindow: BrowserWindow | undefined;
let statusTray: Tray | undefined;
let cardPreviewPinned = false;
let arenaChoiceOverlayMonitor: NodeJS.Timeout | undefined;
let arenaChoiceOverlayRefreshInFlight = false;
let arenaChoiceOverlayGeneration = 0;
let arenaHeroRankingMonitor: NodeJS.Timeout | undefined;
let arenaHeroRankingRefreshInFlight = false;
let arenaHeroRankingGeneration = 0;
let arenaHeroRankingDataWindow: BrowserWindow | undefined;
let arenaHeroRankingSuppressed = false;
let arenaHeroRankingInteractionActiveUntil = 0;
let arenaHeroRankingBoundsSaveTimer: NodeJS.Timeout | undefined;
let arenaHeroRankingBoundsWriteQueue: Promise<void> = Promise.resolve();
let cardPreviewAutoHideTimer: NodeJS.Timeout | undefined;
let cardPreviewVisibilityMonitor: NodeJS.Timeout | undefined;
let cardPreviewVisibilityRefreshInFlight = false;
let lastCardPreviewRequestKey: string | undefined;
let cardPreviewRequestSerial = 0;
let overlayInteractionActiveUntil = 0;
let opponentOverlayInteractionActiveUntil = 0;
let ladderDeckOverlayInteractionActiveUntil = 0;
let auxiliaryOverlayInteractionActiveUntil = 0;
let initialBackgroundWindowReady = false;
let initialLaunchActivateObserved = false;
let mainWindowUserActivationAllowedAfterMs = Number.POSITIVE_INFINITY;
let qaCaptureShutdownRequested = false;
let lastCaptureDiagnostic: string | undefined;
let boardAttackOverlayMonitor: NodeJS.Timeout | undefined;
let boardAttackOverlayRefreshInFlight = false;
const auxiliaryOverlayGenerations: Record<AuxiliaryOverlayKind, number> = {
  "friendly-attack": 0,
  "opponent-attack": 0,
  "friendly-health": 0,
  "opponent-health": 0,
  secret: 0,
  "smart-counter": 0
};
let cachedHearthstoneDisplay: { readonly id: number; readonly expiresAt: number } | undefined;
let opponentOverlayWindowState: OpponentOverlayWindowState | undefined;
let opponentOverlayRestoreCollapsed = false;
const overlayBoundsPersistence = new WindowBoundsPersistence(
  saveOverlayWindowBounds,
  250,
  (error) => reportDiagnosticError("保存我方窗口位置失败", error)
);
const opponentOverlayBoundsPersistence = new WindowBoundsPersistence(
  saveOpponentOverlayBounds,
  180,
  (error) => reportDiagnosticError("保存对手窗口位置失败", error)
);
const opponentOverlayWindowController = new OpponentOverlayWindowController({
  getWindow: () => opponentOverlayWindow,
  getState: () => opponentOverlayWindowState,
  saveExpandedBounds: (bounds) => opponentOverlayBoundsPersistence.flush(bounds)
});
const ladderDeckRecommendations = new LadderDeckRecommendationService();
const arenaHeroStats = new ArenaHeroStatsService(app.getPath("userData"));
let currentLadderDeckCode: string | undefined;
const appQuitController = new AppQuitController({
  cleanup: async () => {
    diagnosticLogger.info("开始退出清理");
    await appRunState.markPhase("stopping").catch((error) => {
      diagnosticLogger.warn("保存退出阶段失败", error);
    });
    automaticOverlayController.stop();
    automaticOpponentOverlayController.stop();
    stopBoardAttackOverlayMonitor();
    await releaseOverlayWindow();
    stopArenaChoiceOverlayMonitor();
    stopArenaHeroRankingMonitor();
    await releaseOpponentOverlayWindow();
    await arenaHeroRankingBoundsWriteQueue;
    stopCardPreviewVisibilityMonitor();
    ladderDeckOverlayController.stop();
    hideCardPreviewWindow();
    statusTray?.destroy();
    statusTray = undefined;
    await tracker.dispose();
    await appRunState.markClean().catch((error) => {
      diagnosticLogger.warn("保存正常退出状态失败", error);
    });
    diagnosticLogger.info("退出清理完成");
  },
  quit: () => app.quit(),
  onError: (error) => reportDiagnosticError("退出清理失败，将继续退出。", error)
});

const cardPreviewWidth = 280;
const cardPreviewHeight = 520;
const cardPreviewMinHeight = 160;
const cardPreviewGap = 10;
const cardPreviewAutoHideMs = 10000;
const mainWindowActivateGraceMs = 1_500;
const cardPreviewVisibilityIntervalMs = 150;
const arenaHeroRankingInteractionGraceMs = 1_200;
const auxiliaryOverlayInteractionGraceMs = 1_200;
const overlaySettingsPreviewGraceMs = 2_000;
const overlaySettingsPreviewSession = new OverlaySettingsPreviewSession(overlaySettingsPreviewGraceMs);
let overlaySettingsPreviewWindows = {
  friendly: false,
  opponent: false,
  ladder: false,
  arenaHeroRanking: false
};
const cardPreviewVisibilityGate = new CardPreviewVisibilityGate();
const cardPreviewPinAccelerator = "Alt+Q";

const ladderDeckOverlayController = new LadderDeckOverlayController({
  getState: () => tracker.getState(),
  getFrontmostAppName,
  hasWindow: () => Boolean(ladderDeckOverlayWindow && !ladderDeckOverlayWindow.isDestroyed()),
  isVisible: () => Boolean(ladderDeckOverlayWindow && !ladderDeckOverlayWindow.isDestroyed() && ladderDeckOverlayWindow.isVisible()),
  isAnyOverlayFocused: () => isAnyInteractiveOverlayFocused(),
  isAnyOverlayInteractionActive: () => isAnyOverlayInteractionActive(),
  isFrontmostAppAllowed: (appName) => isOverlayFrontmostAllowed(
    appName,
    overlaySettingsPreviewWindows.ladder
  ),
  createWindow: async () => { await createLadderDeckOverlayWindow({ showWhenReady: false }); },
  updateMode: updateLadderDeckOverlayMode,
  showInactive: () => {
    if (!ladderDeckOverlayWindow || ladderDeckOverlayWindow.isDestroyed()) return;
    const bounds = getLadderDeckOverlayBounds(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea);
    if (!bounds) return;
    ladderDeckOverlayWindow.setBounds(bounds);
    ladderDeckOverlayWindow.showInactive();
  },
  hide: () => releaseTransientWindow(ladderDeckOverlayWindow)
});

async function captureHearthstoneDisplay() {
  if (!appPermissionManager.isScreenCaptureGranted()) {
    throw new ScreenCaptureError(
      "permission-denied",
      "需要允许炉石记牌器录制屏幕，才能自动识别当前模式和套牌。"
    );
  }
  try {
    const displays = screen.getAllDisplays();
    const targetDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const thumbnailSize = displays.reduce(
      (size, display) => ({
        width: Math.max(size.width, Math.round(display.bounds.width * display.scaleFactor)),
        height: Math.max(size.height, Math.round(display.bounds.height * display.scaleFactor))
      }),
      { width: 1, height: 1 }
    );
    const windowSources = await desktopCapturer.getSources({
      types: [...HEARTHSTONE_WINDOW_CAPTURE_TYPES],
      thumbnailSize
    });
    let source = selectHearthstoneWindowCaptureSource(windowSources);
    if (!source || source.thumbnail.isEmpty()) {
      const displaySources = await desktopCapturer.getSources({
        types: [...HEARTHSTONE_DISPLAY_CAPTURE_TYPES],
        thumbnailSize
      });
      source = selectTargetDisplayCaptureSource(displaySources, targetDisplay.id);
    }
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error("无法读取炉石所在屏幕。");
    }
    lastCaptureDiagnostic = undefined;
    return source.thumbnail.toPNG();
  } catch (error) {
    const diagnostic = error instanceof Error ? error.message : String(error);
    if (diagnostic !== lastCaptureDiagnostic) {
      lastCaptureDiagnostic = diagnostic;
      diagnosticLogger.warn("炉石窗口截图失败", error);
    }
    if (!appPermissionManager.isScreenCaptureGranted()) {
      throw new ScreenCaptureError(
        "permission-denied",
        "需要允许炉石记牌器录制屏幕，才能自动识别当前模式和套牌。"
      );
    }
    throw new ScreenCaptureError(
      "capture-failed",
      `暂时无法读取炉石画面，正在自动重试：${error instanceof Error ? error.message : String(error)}`
    );
  }
}

const automaticOverlayController = new AutomaticOverlayController({
  getState: () => tracker.getState(),
  getFrontmostAppName,
  hasOverlayWindow: () => Boolean(overlayWindow && !overlayWindow.isDestroyed()),
  isOverlayVisible: () => Boolean(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()),
  isOverlayFocused: () => isAnyInteractiveOverlayFocused(),
  isOverlayInteractionActive: () => isAnyOverlayInteractionActive(),
  isFrontmostAppAllowed: (appName) => isOverlayFrontmostAllowed(
    appName,
    overlaySettingsPreviewWindows.friendly
  ),
  createOverlayWindow: async () => {
    await createOverlayWindow({ showWhenReady: false });
  },
  showOverlayWindow: () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      reassertOverlayWindowPresentation(
        overlayWindow,
        !trackerSettings.overlay.hideInFullscreen,
        useQaAccessoryActivationPolicy
      );
    }
  },
  hideOverlayWindow: async () => {
    hideCardPreviewWindow();
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.hide();
    }
  },
  isEnabled: () => shouldManageTrackerOverlay(
    "friendlyDeckTracker"
  ),
  shouldHideWhenDisabled: () =>
    trackerSettings.general.gameDetection === "automatic" || !isDeckTrackerEnabled("friendlyDeckTracker")
});

const automaticOpponentOverlayController = new AutomaticOverlayController({
  getState: () => tracker.getState(),
  getFrontmostAppName,
  hasOverlayWindow: () => Boolean(opponentOverlayWindow && !opponentOverlayWindow.isDestroyed()),
  isOverlayVisible: () => Boolean(opponentOverlayWindow && !opponentOverlayWindow.isDestroyed() && opponentOverlayWindow.isVisible()),
  isOverlayFocused: () => isAnyInteractiveOverlayFocused(),
  isOverlayInteractionActive: () => isAnyOverlayInteractionActive(),
  isFrontmostAppAllowed: (appName) => isOverlayFrontmostAllowed(
    appName,
    overlaySettingsPreviewWindows.opponent
  ),
  createOverlayWindow: async () => { await createOpponentOverlayWindow({ showWhenReady: false }); },
  showOverlayWindow: () => {
    if (opponentOverlayWindow && !opponentOverlayWindow.isDestroyed()) {
      reassertOverlayWindowPresentation(
        opponentOverlayWindow,
        !trackerSettings.overlay.hideInFullscreen,
        useQaAccessoryActivationPolicy
      );
    }
  },
  hideOverlayWindow: async () => {
    opponentOverlayRestoreCollapsed = opponentOverlayWindowState?.isCollapsed() ?? false;
    if (opponentOverlayWindow && !opponentOverlayWindow.isDestroyed()) {
      opponentOverlayWindow.hide();
    }
  },
  isEnabled: () => shouldManageTrackerOverlay(
    "opponentDeckTracker"
  ),
  shouldHideWhenDisabled: () =>
    trackerSettings.general.gameDetection === "automatic" || !isDeckTrackerEnabled("opponentDeckTracker")
});

function isDeckTrackerEnabled(
  setting: "friendlyDeckTracker" | "opponentDeckTracker"
) {
  return trackerSettings.overlay.enabled && trackerSettings.ladder[setting];
}

function shouldManageTrackerOverlay(
  setting: "friendlyDeckTracker" | "opponentDeckTracker"
) {
  return isDeckTrackerEnabled(setting);
}

function isOverlayFrontmostAllowed(appName: string | undefined, previewWindowWasVisible = false) {
  return shouldAllowOverlayDuringSettingsPreview({
    showOnlyInGame: trackerSettings.overlay.showOnlyInGame,
    hearthstoneFrontmost: isHearthstoneFrontmost(appName),
    trackerFrontmost: isHearthstoneOrTrackerFrontmost(appName),
    previewActive: overlaySettingsPreviewSession.isActive(),
    previewWindowWasVisible,
    mainWindowFocused: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused())
  });
}

function isAnyInteractiveOverlayFocused() {
  return [overlayWindow, opponentOverlayWindow, ladderDeckOverlayWindow].some(
    (window) => Boolean(window && !window.isDestroyed() && window.isFocused())
  );
}

function isAnyOverlayInteractionActive() {
  const now = Date.now();
  return now < overlayInteractionActiveUntil ||
    now < opponentOverlayInteractionActiveUntil ||
    now < ladderDeckOverlayInteractionActiveUntil ||
    isAuxiliaryOverlayInteractionActive();
}

function markAuxiliaryOverlayInteraction(): void {
  auxiliaryOverlayInteractionActiveUntil = Date.now() + auxiliaryOverlayInteractionGraceMs;
}

function isAuxiliaryOverlayInteractionActive(): boolean {
  return auxiliaryOverlayDragSessions.size > 0 || Date.now() < auxiliaryOverlayInteractionActiveUntil;
}

const hasSingleInstanceLock = process.env.QA_ALLOW_MULTIPLE_INSTANCES === "1" || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  showMainWindow();
});

const qaConsoleErrorCounts = new WeakMap<BrowserWindow, number>();

function installQaConsoleErrorListener(window: BrowserWindow) {
  if (!process.env.QA_INSPECT_PATH) return;
  qaConsoleErrorCounts.set(window, 0);
  window.webContents.on("console-message", (details, legacyLevel) => {
    if (details.level === "error" || legacyLevel === 3) {
      qaConsoleErrorCounts.set(window, (qaConsoleErrorCounts.get(window) ?? 0) + 1);
    }
  });
}

function getQaConsoleErrorCount(window: BrowserWindow | undefined) {
  if (!window || window.isDestroyed()) return 0;
  return qaConsoleErrorCounts.get(window) ?? 0;
}

async function createWindow(options: { showWhenReady?: boolean; focusWhenReady?: boolean } = {}) {
  const showWhenReady = options.showWhenReady ??
    shouldShowMainWindowOnLaunch(process.env, trackerSettings.general.startMinimized);
  const focusWhenReady = options.focusWhenReady ?? shouldFocusMainWindowOnLaunch(
    process.env,
    trackerSettings.general.focusOnOpen
  );
  const qaHomeDemo = process.env.QA_HOME_DEMO === "1";
  const window = new BrowserWindow({
    width: readQaWindowDimension(process.env.QA_MAIN_WIDTH, 1180, 640, 2400),
    height: readQaWindowDimension(process.env.QA_MAIN_HEIGHT, 760, 620, 1800),
    minWidth: 640,
    minHeight: 620,
    show: false,
    title: "炉石 Mac 记牌器",
    backgroundColor: "#ffffff",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: createSecureWebPreferences(path.join(__dirname, "preload.cjs"))
  });
  installQaConsoleErrorListener(window);
  configureSecureNavigation(window);

  mainWindow = window;
  tracker.attachWindow(window);
  window.on("close", (event) => {
    if (shouldPreventAutomatedCaptureClose(process.env, qaCaptureShutdownRequested)) {
      event.preventDefault();
    }
  });
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = undefined;
    }
  });

  await loadRendererPage(window, qaHomeDemo ? { "qa-home-demo": "1" } : undefined);
  const qaZoom = readQaWindowDimension(process.env.QA_ZOOM_PERCENT, trackerSettings.appearance.zoom, 50, 200);
  window.webContents.setZoomFactor(qaZoom / 100);

  if (showWhenReady) {
    presentMainWindow(window, focusWhenReady, () => app.focus({ steal: true }));
  }

  await startTrackingAutomatically(process.env.QA_LOG_PATH ? { logPath: process.env.QA_LOG_PATH } : undefined);

  if (
    process.env.QA_OPEN_OVERLAY !== "1" &&
    process.env.QA_OPEN_OPPONENT_OVERLAY !== "1" &&
    process.env.QA_OPEN_ARENA_CHOICE_OVERLAY !== "1"
    && process.env.QA_OPEN_LADDER_DECK_OVERLAY !== "1"
    && process.env.QA_OPEN_BOARD_ATTACK_OVERLAY !== "1"
    && process.env.QA_OPEN_FRIENDLY_ATTACK_OVERLAY !== "1"
    && process.env.QA_OPEN_OPPONENT_ATTACK_OVERLAY !== "1"
    && process.env.QA_OPEN_FRIENDLY_HEALTH_OVERLAY !== "1"
    && process.env.QA_OPEN_OPPONENT_HEALTH_OVERLAY !== "1"
    && process.env.QA_OPEN_SECRET_OVERLAY !== "1"
    && process.env.QA_OPEN_SMART_COUNTER_OVERLAY !== "1"
    && process.env.QA_OPEN_ARENA_HERO_RANKING_OVERLAY !== "1"
    && process.env.QA_OPEN_THREE_WINDOW_LAYOUT !== "1"
  ) {
    await captureQaScreenshotIfRequested(window);
  }
}

function readQaWindowDimension(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    diagnosticLogger.info("应用启动");
    const previousRun = await appRunState.begin(app.getVersion()).catch((error) => {
      diagnosticLogger.warn("运行状态初始化失败，将继续启动", error);
      return { wasUnclean: false as const };
    });
    if (previousRun.wasUnclean) {
      diagnosticLogger.warn("检测到上次异常退出", {
        version: previousRun.version,
        startedAt: previousRun.startedAt,
        phase: previousRun.phase
      });
    }
    await appRunState.markPhase("startup-health").catch((error) => {
      diagnosticLogger.warn("保存启动检修阶段失败", error);
    });
    if (useQaAccessoryActivationPolicy) {
      await hideQaDockAfterLaunch(app.dock);
    }
    if (process.env.QA_ALLOW_MULTIPLE_INSTANCES !== "1") {
      try {
        await cleanupStaleScreenCaptures(undefined, Number.POSITIVE_INFINITY);
      } catch (error) {
        diagnosticLogger.warn("清理上次运行残留截图失败", error);
      }
    }
    const healthCheck = await runStartupHealthCheck({
      userDataDirectory: app.getPath("userData"),
      repairSettings: () => trackerSettingsStore.repairOnStartup(),
      repairLogConfig: () => autoRepairLogConfigOnStartup({
        environment: process.env
      }),
      requiredResources: [
        {
          name: "主界面文件",
          path: path.join(__dirname, "../../dist/index.html")
        },
        {
          name: "安全桥接文件",
          path: path.join(__dirname, "preload.cjs")
        },
        {
          name: "竞技场识别组件",
          path: resolveArenaOcrHelperPath(),
          executable: true
        },
        {
          name: "前台检测组件",
          path: resolveFrontmostAppHelperPath(),
          executable: true
        }
      ]
    });
    if (healthCheck.status === "blocked") {
      diagnosticLogger.error("启动自动检修未通过", healthCheck.failures);
      if (process.env.QA_USER_DATA_DIR) {
        console.error(formatStartupHealthFailures(healthCheck.failures));
        process.exitCode = 1;
        app.quit();
        return;
      }
      await dialog.showMessageBox({
        type: "error",
        title: "炉石记牌器无法启动",
        message: "启动检修未通过",
        detail: formatStartupHealthFailures(healthCheck.failures),
        buttons: ["退出软件"],
        defaultId: 0,
        noLink: true
      });
      app.quit();
      return;
    }
    trackerSettings = healthCheck.settings;
    if (process.env.QA_TRACKER_THEME === "light" || process.env.QA_TRACKER_THEME === "dark") {
      trackerSettings = {
        ...trackerSettings,
        appearance: { ...trackerSettings.appearance, theme: process.env.QA_TRACKER_THEME }
      };
    }
    if (process.env.QA_OVERLAY_THEME === "light" || process.env.QA_OVERLAY_THEME === "dark") {
      trackerSettings = {
        ...trackerSettings,
        overlay: { ...trackerSettings.overlay, theme: process.env.QA_OVERLAY_THEME }
      };
    }
    if (healthCheck.repairs.length > 0) {
      diagnosticLogger.info("启动自动检修已修复问题", healthCheck.repairs);
    }
    registerIpc();
    registerAppActivateHandler();
    await createWindow();
    await appRunState.markPhase("ready").catch((error) => {
      diagnosticLogger.warn("保存启动完成阶段失败", error);
    });
    if (shouldApplyTrackerSettingsEffectsDuringQaCapture(process.env)) {
      await applyTrackerSettingsEffects(undefined, {
        loginItemVerified: shouldSkipLaunchAtLoginUpdateDuringQaCapture(process.env)
      }).catch(async (error) => {
        reportDiagnosticError("应用开机启动设置失败，将继续启动。", error);
        await applyTrackerSettingsEffects(undefined, { loginItemVerified: true });
      });
    }
    initialBackgroundWindowReady = true;
    mainWindowUserActivationAllowedAfterMs = Date.now() + mainWindowActivateGraceMs;
    if (process.env.QA_OPEN_OPPONENT_OVERLAY === "1") {
      const window = await createOpponentOverlayWindow({
        showWhenReady: true,
        qaDemo: process.env.QA_OPPONENT_REAL_STATE !== "1"
      });
      await captureQaScreenshotIfRequested(window);
    } else if (process.env.QA_OPEN_OVERLAY === "1") {
      const friendlyOverlayQaDemo = process.env.QA_FRIENDLY_OVERLAY_DEMO === "1";
      const window = await createOverlayWindow({ qaDemo: friendlyOverlayQaDemo });
      await captureQaScreenshotIfRequested(window);
    } else if (process.env.QA_OPEN_ARENA_CHOICE_OVERLAY === "1") {
      const window = await createArenaChoiceOverlayWindow({ qaDemo: true });
      await captureQaScreenshotIfRequested(window);
    } else if (process.env.QA_OPEN_LADDER_DECK_OVERLAY === "1") {
      const mode = process.env.QA_LADDER_MODE === "wild" ? "wild" : "standard";
      const window = await createLadderDeckOverlayWindow({ showWhenReady: true, qaDemo: true, mode });
      await captureQaScreenshotIfRequested(window);
    } else if (
      process.env.QA_OPEN_BOARD_ATTACK_OVERLAY === "1" ||
      process.env.QA_OPEN_FRIENDLY_ATTACK_OVERLAY === "1"
    ) {
      const window = await createFriendlyAttackOverlayWindow(screen.getPrimaryDisplay().bounds, { qaDemo: true });
      if (!window) {
        throw new Error("我方场攻悬浮窗渲染验证失败");
      }
      window.showInactive();
      await captureQaScreenshotIfRequested(window);
    } else if (process.env.QA_OPEN_OPPONENT_ATTACK_OVERLAY === "1") {
      const window = await createOpponentAttackOverlayWindow(screen.getPrimaryDisplay().bounds, { qaDemo: true });
      if (!window) throw new Error("对手场攻悬浮窗渲染验证失败");
      window.showInactive();
      await captureQaScreenshotIfRequested(window);
    } else if (process.env.QA_OPEN_FRIENDLY_HEALTH_OVERLAY === "1") {
      const window = await createFriendlyHealthOverlayWindow(screen.getPrimaryDisplay().bounds, { qaDemo: true });
      if (!window) throw new Error("我方血量悬浮窗渲染验证失败");
      window.showInactive();
      await captureQaScreenshotIfRequested(window);
    } else if (process.env.QA_OPEN_OPPONENT_HEALTH_OVERLAY === "1") {
      const window = await createOpponentHealthOverlayWindow(screen.getPrimaryDisplay().bounds, { qaDemo: true });
      if (!window) throw new Error("对手血量悬浮窗渲染验证失败");
      window.showInactive();
      await captureQaScreenshotIfRequested(window);
    } else if (process.env.QA_OPEN_SECRET_OVERLAY === "1") {
      const window = await createSecretOverlayWindow(screen.getPrimaryDisplay().bounds, {
        qaDemo: true,
        possibleCandidateCounts: [1, 1]
      });
      if (!window) throw new Error("奥秘预测悬浮窗渲染验证失败");
      window.showInactive();
      await captureQaScreenshotIfRequested(window);
    } else if (process.env.QA_OPEN_SMART_COUNTER_OVERLAY === "1") {
      const window = await createSmartCounterOverlayWindow(
        "qa-friendly-dragons",
        screen.getPrimaryDisplay().bounds,
        0,
        { qaDemo: true }
      );
      if (!window) throw new Error("智能卡牌计数悬浮窗渲染验证失败");
      window.showInactive();
      await captureQaScreenshotIfRequested(window);
    } else if (process.env.QA_OPEN_ARENA_HERO_RANKING_OVERLAY === "1") {
      const window = await createArenaHeroRankingWindow({ qaDemo: true });
      window.showInactive();
      await captureQaScreenshotIfRequested(window);
    } else if (process.env.QA_OPEN_THREE_WINDOW_LAYOUT === "1") {
      const heroWindow = await createArenaHeroRankingWindow({ qaDemo: true });
      const opponentWindow = await createOpponentOverlayWindow({ showWhenReady: false, qaDemo: true });
      const friendlyOverlayQaDemo = process.env.QA_FRIENDLY_OVERLAY_DEMO === "1";
      const friendlyWindow = await createOverlayWindow({ showWhenReady: false, qaDemo: friendlyOverlayQaDemo });
      heroWindow.showInactive();
      opponentWindow.showInactive();
      friendlyWindow.showInactive();
      await captureQaScreenshotIfRequested(heroWindow);
    } else if (process.env.QA_EXIT_AFTER_SCREENSHOT !== "1") {
      if (trackerSettings.overlay.enabled) startArenaChoiceOverlayMonitor();
      if (trackerSettings.overlay.enabled) {
        automaticOverlayController.start();
        automaticOpponentOverlayController.start();
      }
      startCardPreviewVisibilityMonitor();
      if (trackerSettings.overlay.enabled) ladderDeckOverlayController.start();
      if (trackerSettings.overlay.enabled && trackerSettings.overlay.arenaHeroWinRateRanking) startArenaHeroRankingMonitor();
      await appRunState.markPhase("monitoring").catch((error) => {
        diagnosticLogger.warn("保存监听阶段失败", error);
      });
    }
  }).catch(async (error) => {
    const reason = error instanceof Error && error.message
      ? error.message
      : String(error);
    diagnosticLogger.error("启动过程发生无法自动修复的问题", error);
    if (process.env.QA_USER_DATA_DIR) {
      console.error(reason);
      process.exitCode = 1;
      app.quit();
      return;
    }
    await dialog.showMessageBox({
      type: "error",
      title: "炉石记牌器无法启动",
      message: "启动过程发生无法自动修复的问题",
      detail: `${reason}\n\n请重新安装最新版炉石记牌器；若仍失败，请保留错误信息后联系维护者。`,
      buttons: ["退出软件"],
      defaultId: 0,
      noLink: true
    });
    app.quit();
  });
}

function reportDiagnosticError(message: string, error: unknown) {
  diagnosticLogger.error(message, error);
  console.error(message, error);
}

function registerAppActivateHandler() {
  app.on("activate", () => {
    if (
      !shouldHandleAppActivate(
        initialBackgroundWindowReady,
        initialLaunchActivateObserved,
        Date.now(),
        mainWindowUserActivationAllowedAfterMs,
        isQaOverlayCapture(process.env)
      )
    ) {
      initialLaunchActivateObserved = true;
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      showMainWindow();
      return;
    }

    void createWindow({
      showWhenReady: true,
      focusWhenReady: trackerSettings.general.focusOnOpen
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  qaCaptureShutdownRequested = true;
  appQuitController.handleBeforeQuit(event);
});

function registerIpc() {
  const trustedIpcMain = {
    handle(channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown) {
      ipcMain.handle(channel, (event, ...args) => {
        assertTrustedIpcEvent(event, getTrustedWebContents());
        return handler(event, ...args);
      });
    }
  };
  registerFriendlyOverlayIpc(trustedIpcMain, {
    isFriendlyOverlaySender: (sender) => sender === overlayWindow?.webContents,
    suppressCurrentContext: () => automaticOverlayController.suppressCurrentContext(),
    closeFriendlyOverlay: () => releaseOverlayWindow(overlayWindow)
  });
  registerOpponentOverlayIpc(trustedIpcMain, opponentOverlayWindowController);
  registerAuxiliaryOverlayIpc(trustedIpcMain, {
    resolveKind: resolveMovableAuxiliaryOverlayKind,
    getSecretCollapsed: () => auxiliaryOverlayWindowStateStore.getSecretCollapsed(),
    setSecretCollapsed: setSecretOverlayCollapsed,
    setMouseInteractive: (kind, interactive) => {
      const window = getMovableAuxiliaryOverlayWindow(kind);
      if (!window || window.isDestroyed()) return;
      markAuxiliaryOverlayInteraction();
      setAuxiliaryOverlayMouseInteractive(window, interactive);
    },
    beginDrag: beginAuxiliaryOverlayDrag,
    moveDrag: moveAuxiliaryOverlayDrag,
    endDrag: endAuxiliaryOverlayDrag
  });
  const secureHandle = trustedIpcMain.handle.bind(trustedIpcMain);
  const assertMainWindowSender = (event: Electron.IpcMainInvokeEvent) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
      throw new Error("只有主工作台可以管理系统权限");
    }
  };
  secureHandle("tracker:get-permissions", (event) => {
    assertMainWindowSender(event);
    return appPermissionManager.getPermissions();
  });
  secureHandle("tracker:request-permission", async (event, permissionId: unknown) => {
    assertMainWindowSender(event);
    if (permissionId !== "screen-recording") {
      throw new Error("权限标识无效");
    }
    await appPermissionManager.requestPermission(permissionId);
    return appPermissionManager.getPermissions();
  });
  secureHandle("tracker:discover-logs", () => discoverLogCandidates());
  secureHandle("tracker:get-home-news", () => homeNews.load());
  secureHandle("tracker:get-arena-hero-win-rate-ranking", () => arenaHeroStats.load());
  secureHandle("tracker:open-home-news-item", async (_event, itemId: unknown) => {
    if (typeof itemId !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(itemId)) {
      throw new Error("资讯标识无效");
    }
    const result = await homeNews.load();
    const item = result.items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error("资讯不存在或已更新");
    await shell.openExternal(item.url);
  });
  secureHandle("tracker:get-state", () => tracker.getState());
  secureHandle("tracker:get-settings", () => trackerSettings);
  secureHandle("tracker:close-arena-hero-win-rate-ranking", (event) => {
    if (event.sender !== arenaHeroRankingWindow?.webContents) return;
    arenaHeroRankingSuppressed = true;
    releaseTransientWindow(arenaHeroRankingWindow);
  });
  secureHandle("tracker:replace-settings", async (_event, value: unknown) => {
    const candidate = parseTrackerSettings(value);
    if (!candidate) throw new Error("设置数据无效");
    const previous = trackerSettings;
    const launchAtLoginChanged = candidate.general.launchAtLogin !== previous.general.launchAtLogin;
    if (didOverlayPreviewControlsChange(previous.overlay, candidate.overlay)) {
      const continuingPreview = overlaySettingsPreviewSession.isActive();
      overlaySettingsPreviewWindows = {
        friendly: (continuingPreview && overlaySettingsPreviewWindows.friendly) ||
          Boolean(overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()),
        opponent: (continuingPreview && overlaySettingsPreviewWindows.opponent) ||
          Boolean(opponentOverlayWindow && !opponentOverlayWindow.isDestroyed() && opponentOverlayWindow.isVisible()),
        ladder: (continuingPreview && overlaySettingsPreviewWindows.ladder) ||
          Boolean(ladderDeckOverlayWindow && !ladderDeckOverlayWindow.isDestroyed() && ladderDeckOverlayWindow.isVisible()),
        arenaHeroRanking: (continuingPreview && overlaySettingsPreviewWindows.arenaHeroRanking) ||
          Boolean(arenaHeroRankingWindow && !arenaHeroRankingWindow.isDestroyed() && arenaHeroRankingWindow.isVisible())
      };
      overlaySettingsPreviewSession.extend();
    }
    if (launchAtLoginChanged) {
      applyLaunchAtLoginSetting(app, candidate.general.launchAtLogin);
    }
    try {
      trackerSettings = await trackerSettingsStore.replace(value);
    } catch (error) {
      if (launchAtLoginChanged) {
        try {
          applyLaunchAtLoginSetting(app, previous.general.launchAtLogin);
        } catch (rollbackError) {
          reportDiagnosticError("恢复开机启动设置失败", rollbackError);
        }
      }
      throw error;
    }
    await applyTrackerSettingsEffects(previous, { loginItemVerified: true });
    return trackerSettings;
  });
  secureHandle("tracker:restore-default-settings", async () => {
    const previous = trackerSettings;
    const launchAtLoginChanged = DEFAULT_TRACKER_SETTINGS.general.launchAtLogin !== previous.general.launchAtLogin;
    if (launchAtLoginChanged) {
      applyLaunchAtLoginSetting(app, DEFAULT_TRACKER_SETTINGS.general.launchAtLogin);
    }
    try {
      trackerSettings = await trackerSettingsStore.replace(DEFAULT_TRACKER_SETTINGS);
    } catch (error) {
      if (launchAtLoginChanged) {
        try {
          applyLaunchAtLoginSetting(app, previous.general.launchAtLogin);
        } catch (rollbackError) {
          reportDiagnosticError("恢复开机启动设置失败", rollbackError);
        }
      }
      throw error;
    }
    await applyTrackerSettingsEffects(previous, { loginItemVerified: true });
    return trackerSettings;
  });
  secureHandle("tracker:open-log-folder", async () => {
    const logDirectory = app.getPath("logs");
    await fs.mkdir(logDirectory, { recursive: true });
    const error = await shell.openPath(logDirectory);
    if (error) throw new Error(`打开日志目录失败：${error}`);
  });
  secureHandle("tracker:refresh-card-database", async () => {
    try {
      const result = await cardLibraryData.loadCardDatabase({ forceRefresh: true });
      if (!result.database) {
        return { status: "error" as const, error: result.warnings[0] ?? "卡牌数据库不可用", warnings: result.warnings };
      }
      cardLibraryMetadata = { source: result.source, version: result.version };
      return {
        status: result.warnings.length > 0 ? "stale" as const : "updated" as const,
        cardCount: result.cardCount ?? Object.keys(result.database).length,
        source: result.source,
        version: result.version,
        warnings: result.warnings
      };
    } catch (error) {
      return { status: "error" as const, error: formatLibraryError(error), warnings: [] };
    }
  });
  secureHandle("tracker:open-settings", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      await createWindow();
    }
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    showMainWindow();
    mainWindow.webContents.send("tracker:open-settings");
    return true;
  });
  secureHandle("tracker:get-match-history", () => tracker.getMatchHistory());
  const assertMainWorkbench = (event: Electron.IpcMainInvokeEvent) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
      throw new Error("只有主工作台可以访问档案与收藏数据");
    }
  };
  secureHandle("tracker:get-arena-insights", (event) => {
    assertMainWorkbench(event);
    return arenaInsights.getInsights();
  });
  secureHandle("tracker:record-arena-rewards", (event, runId: unknown, rewards: unknown) => {
    assertMainWorkbench(event);
    if (typeof runId !== "string" || !runId.trim() || !Array.isArray(rewards)) {
      throw new Error("竞技场奖励输入无效");
    }
    return arenaInsights.recordRewards(runId, rewards);
  });
  secureHandle("tracker:import-arena-runs", (event, runs: unknown) => {
    assertMainWorkbench(event);
    return arenaInsights.importRuns(runs);
  });
  secureHandle("tracker:export-arena-runs", (event) => {
    assertMainWorkbench(event);
    return arenaInsights.exportRuns();
  });
  secureHandle("tracker:get-collection-insights", (event) => {
    assertMainWorkbench(event);
    return collectionInsights.getInsights();
  });
  secureHandle("tracker:import-collection-snapshot", (event, snapshot: unknown) => {
    assertMainWorkbench(event);
    return collectionInsights.importSnapshot(snapshot);
  });
  secureHandle("tracker:import-collection-csv", (event, csvText: unknown) => {
    assertMainWorkbench(event);
    return collectionInsights.importCollectionCsv(parseCollectionCsvIpcInput(csvText));
  });
  secureHandle("tracker:record-pack-opening", (event, pack: unknown) => {
    assertMainWorkbench(event);
    return collectionInsights.recordPackOpening(pack);
  });
  secureHandle("tracker:update-cosmetics", (event, cosmetics: unknown) => {
    assertMainWorkbench(event);
    return collectionInsights.updateCosmetics(cosmetics);
  });
  secureHandle("tracker:get-ladder-deck-recommendation", async (event, mode: unknown) => {
    if (mode !== "standard" && mode !== "wild") throw new Error("天梯模式无效");
    const result = await ladderDeckRecommendations.get(mode);
    if ((event.sender === mainWindow?.webContents || event.sender === ladderDeckOverlayWindow?.webContents) &&
        (event.sender === mainWindow?.webContents || resolveLadderDeckMode(tracker.getState()) === mode)) {
      currentLadderDeckCode = result.status === "ready" ? result.recommendation.deckCode : undefined;
    }
    return result;
  });
  secureHandle("tracker:copy-ladder-deck-code", (event, deckCode: unknown) => {
    const isQaDeckCode = process.env.QA_OPEN_LADDER_DECK_OVERLAY === "1" && typeof deckCode === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(deckCode);
    const trustedSource = event.sender === ladderDeckOverlayWindow?.webContents || event.sender === mainWindow?.webContents;
    if (!trustedSource || typeof deckCode !== "string" || (!isQaDeckCode && deckCode !== currentLadderDeckCode)) {
      throw new Error("只能复制当前已加载的推荐卡组代码");
    }
    clipboard.writeText(deckCode);
  });
  secureHandle("tracker:close-ladder-deck-overlay", (event) => {
    if (event.sender !== ladderDeckOverlayWindow?.webContents) return;
    ladderDeckOverlayController.suppressCurrentMode();
    currentLadderDeckCode = undefined;
    ladderDeckOverlayWindow?.close();
  });
  secureHandle("tracker:list-card-library", async (_event, query: unknown): Promise<CardLibraryResult> => {
    try {
      const loaded = await cardLibraryData.loadCardDatabase(getConfiguredCardDatabaseLoadOptions());
      cardLibraryMetadata = {
        source: loaded.source ?? cardLibraryMetadata.source,
        version: loaded.version ?? cardLibraryMetadata.version
      };
      if (!loaded.database) {
        return {
          ...createCardLibraryErrorResult(query, "本地卡牌数据库不可用，请检查网络或稍后重试。", loaded.warnings),
          ...cardLibraryMetadata
        };
      }

      return {
        ...listCardLibrary(loaded.database, query),
        ...cardLibraryMetadata,
        warnings: loaded.warnings
      };
    } catch (error) {
      return createCardLibraryErrorResult(query, `读取本地卡牌数据库失败：${formatLibraryError(error)}`);
    }
  });
  secureHandle("tracker:import-deck", (_event, deckText: string) => tracker.importDeck(deckText));
  secureHandle("tracker:scan-import-collection-decks", (_event, options?: { logPath?: string }) =>
    syncCollectionDecksForTracker(options)
  );
  secureHandle("tracker:import-collection-deck", async (_event, deckId: string) => {
    const deck = await collectionDecks.getDeck(deckId);
    if (!deck) {
      throw new Error("未找到本地收藏套牌，请先扫描收藏套牌。");
    }

    return tracker.importDeck(deck.rawDeckString ?? deck.rawText);
  });
  secureHandle("tracker:ensure-log-config", () => ensureLogConfig());
  secureHandle("tracker:inspect-log-config", () => inspectLogConfig());
  secureHandle("tracker:toggle-overlay", async () => {
    if (!isDeckTrackerEnabled("friendlyDeckTracker")) return false;
    if (trackerSettings.overlay.showOnlyInGame && !isHearthstoneFrontmost(await getFrontmostAppName())) {
      if (overlayWindow && !overlayWindow.isDestroyed()) await releaseOverlayWindow(overlayWindow);
      return false;
    }
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      if (!overlayWindow.isVisible()) {
        automaticOverlayController.clearSuppression();
        overlayWindow.showInactive();
        return true;
      }
      automaticOverlayController.suppressCurrentContext();
      await releaseOverlayWindow(overlayWindow);
      return false;
    }

    automaticOverlayController.clearSuppression();
    await createOverlayWindow();
    return true;
  });
  secureHandle("tracker:toggle-opponent-overlay", async () => {
    if (!isDeckTrackerEnabled("opponentDeckTracker")) return false;
    if (trackerSettings.overlay.showOnlyInGame && !isHearthstoneFrontmost(await getFrontmostAppName())) {
      await releaseOpponentOverlayWindow();
      return false;
    }
    if (opponentOverlayWindow && !opponentOverlayWindow.isDestroyed()) {
      if (opponentOverlayWindowState?.isCollapsed()) {
        await expandOpponentOverlayWindow(true);
        return true;
      }
      await collapseOpponentOverlayWindow();
      return false;
    }

    await createOpponentOverlayWindow({ showWhenReady: true });
    return true;
  });
  secureHandle("tracker:show-card-preview", (event, request: CardPreviewRequest) =>
    showCardPreviewWindow(BrowserWindow.fromWebContents(event.sender), request)
  );
  secureHandle("tracker:hide-card-preview", (event) => {
    hideCardPreviewWindow(BrowserWindow.fromWebContents(event.sender));
  });
  secureHandle("tracker:minimize-main", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return false;
    }

    if (trackerSettings.general.minimizeToMenuBar) {
      ensureStatusTray();
      mainWindow.hide();
    } else {
      mainWindow.minimize();
    }
    return true;
  });
  secureHandle("tracker:start", (_event, options?: { logPath?: string; deckText?: string }) => startTrackingAutomatically(options));
  secureHandle("tracker:pause", () => tracker.pause());
  secureHandle("tracker:select-log-path", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择炉石日志文件或 Logs 目录",
      properties: ["openFile", "openDirectory"],
      filters: [{ name: "Log", extensions: ["log"] }]
    });
    return result.canceled ? undefined : result.filePaths[0];
  });
}

function getTrustedWebContents(): ReadonlySet<Electron.WebContents> {
  return new Set(
    [
      ...trustedAuxiliaryWebContents,
      ...[
      mainWindow,
      overlayWindow,
      opponentOverlayWindow,
      friendlyAttackOverlayWindow,
      opponentAttackOverlayWindow,
      friendlyHealthOverlayWindow,
      opponentHealthOverlayWindow,
      secretOverlayWindow,
      ...smartCounterOverlayWindows.values(),
      ladderDeckOverlayWindow,
      arenaChoiceOverlayWindow,
      arenaHeroRankingWindow,
      cardPreviewWindow
      ]
        .filter((window): window is BrowserWindow => Boolean(window && !window.isDestroyed()))
        .map((window) => window.webContents)
    ]
  );
}

function formatLibraryError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function applyTrackerSettingsEffects(
  previous?: TrackerSettings,
  options: { loginItemVerified?: boolean } = {}
): Promise<void> {
  if (!options.loginItemVerified) {
    applyLaunchAtLoginSetting(app, trackerSettings.general.launchAtLogin);
  }
  tracker.setMatchHistoryRetentionDays(trackerSettings.other.matchRetentionDays);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.setZoomFactor(trackerSettings.appearance.zoom / 100);
    mainWindow.webContents.send("tracker:settings:update", trackerSettings);
  }
  for (const window of overlayWindows()) {
    window.webContents.send("tracker:settings:update", trackerSettings);
  }

  syncStatusTray();
  applyOverlayWindowAppearance();
  if (trackerSettings.other.autoUpdateCards && trackerSettings.other.updateFrequency !== "manual") {
    void cardLibraryData.loadCardDatabase(getConfiguredCardDatabaseLoadOptions()).catch((error) => {
      if (trackerSettings.other.verboseLogs) console.error("卡牌数据库自动更新失败", error);
    });
  }

  if (previous && (
      previous.overlay.position !== trackerSettings.overlay.position ||
      previous.overlay.offsetX !== trackerSettings.overlay.offsetX ||
      previous.overlay.offsetY !== trackerSettings.overlay.offsetY)) {
    applyConfiguredOverlayPositions();
  }

  if (previous && previous.overlay.showFriendlyAttack !== trackerSettings.overlay.showFriendlyAttack &&
      !trackerSettings.overlay.showFriendlyAttack) {
    releaseFriendlyAttackOverlayWindow();
  }
  if (previous && previous.overlay.showOpponentAttack !== trackerSettings.overlay.showOpponentAttack &&
      !trackerSettings.overlay.showOpponentAttack) {
    releaseOpponentAttackOverlayWindow();
  }
  if (previous && previous.overlay.healthChange !== trackerSettings.overlay.healthChange &&
      !trackerSettings.overlay.healthChange) {
    releaseFriendlyHealthOverlayWindow();
    releaseOpponentHealthOverlayWindow();
  }
  if (previous && previous.overlay.secretPrediction !== trackerSettings.overlay.secretPrediction &&
      !trackerSettings.overlay.secretPrediction) {
    releaseSecretOverlayWindow();
  }
  if (previous && previous.overlay.smartCardCounters !== trackerSettings.overlay.smartCardCounters &&
      !trackerSettings.overlay.smartCardCounters) {
    releaseAllSmartCounterOverlayWindows();
  }
  if (previous && previous.overlay.hiddenSmartCounterIds !== trackerSettings.overlay.hiddenSmartCounterIds) {
    const hidden = new Set(trackerSettings.overlay.hiddenSmartCounterIds ?? []);
    for (const counterId of smartCounterOverlayWindows.keys()) {
      if (hidden.has(counterId)) releaseSmartCounterOverlayWindow(counterId);
    }
  }
  const showAnyAuxiliaryOverlay = trackerSettings.overlay.enabled && (
    trackerSettings.overlay.showFriendlyAttack ||
    trackerSettings.overlay.showOpponentAttack ||
    trackerSettings.overlay.healthChange ||
    trackerSettings.overlay.secretPrediction ||
    trackerSettings.overlay.smartCardCounters
  );
  if (shouldRunBoardAttackOverlayMonitor(process.env, showAnyAuxiliaryOverlay)) startBoardAttackOverlayMonitor();
  else stopBoardAttackOverlayMonitor();

  if (!isDeckTrackerEnabled("friendlyDeckTracker")) {
    automaticOverlayController.stop();
    hideCardPreviewWindow();
    await releaseOverlayWindow(overlayWindow);
  }
  if (!isDeckTrackerEnabled("opponentDeckTracker")) {
    automaticOpponentOverlayController.stop();
    await releaseOpponentOverlayWindow();
  }

  if (trackerSettings.overlay.enabled) {
    ladderDeckOverlayController.start();
    startArenaChoiceOverlayMonitor();
    if (initialBackgroundWindowReady) void refreshArenaChoiceOverlayWindow();
  } else {
    ladderDeckOverlayController.stop();
    releaseTransientWindow(ladderDeckOverlayWindow);
    stopArenaChoiceOverlayMonitor();
    releaseTransientWindow(arenaChoiceOverlayWindow);
    hideCardPreviewWindow();
  }
  if (trackerSettings.overlay.enabled && trackerSettings.overlay.arenaHeroWinRateRanking) {
    startArenaHeroRankingMonitor();
    if (initialBackgroundWindowReady) void refreshArenaHeroRankingWindow();
  } else {
    stopArenaHeroRankingMonitor();
  }
  if (trackerSettings.overlay.enabled) {
    automaticOverlayController.start();
    automaticOpponentOverlayController.start();
    await Promise.all([
      automaticOverlayController.refresh(),
      automaticOpponentOverlayController.refresh()
    ]);
  } else {
    automaticOverlayController.stop();
    automaticOpponentOverlayController.stop();
  }
}

function getConfiguredCardDatabaseLoadOptions() {
  const { autoUpdateCards, updateFrequency } = trackerSettings.other;
  if (!autoUpdateCards || updateFrequency === "manual") return { preferCache: true } as const;
  return {
    cacheMaxAgeMs: updateFrequency === "weekly" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000
  } as const;
}

function overlayWindows(): BrowserWindow[] {
  return [
    overlayWindow,
    opponentOverlayWindow,
    friendlyAttackOverlayWindow,
    opponentAttackOverlayWindow,
    friendlyHealthOverlayWindow,
    opponentHealthOverlayWindow,
    secretOverlayWindow,
    ...smartCounterOverlayWindows.values(),
    ladderDeckOverlayWindow,
    arenaChoiceOverlayWindow,
    arenaHeroRankingWindow,
    cardPreviewWindow
  ].filter((window): window is BrowserWindow => Boolean(window && !window.isDestroyed()));
}

function releaseTransientWindow(window: BrowserWindow | undefined): void {
  if (window && !window.isDestroyed()) window.close();
}

function applyOverlayWindowAppearance(): void {
  for (const window of overlayWindows()) {
    window.setOpacity(trackerSettings.overlay.opacity / 100);
    configureOverlayWorkspaceWindow(
      window,
      !trackerSettings.overlay.hideInFullscreen,
      useQaAccessoryActivationPolicy
    );
  }
}

function applyConfiguredOverlayPositions(): void {
  const window = overlayWindow;
  if (!window || window.isDestroyed()) return;
  const bounds = window.getBounds();
  const workArea = screen.getDisplayMatching(bounds).workArea;
  window.setBounds(getAnchoredOverlayWindowBounds(bounds, workArea, trackerSettings.overlay), false);
}

function syncStatusTray(): void {
  const shouldShow = trackerSettings.general.showGameStatusIcon || trackerSettings.general.minimizeToMenuBar;
  if (!shouldShow) {
    statusTray?.destroy();
    statusTray = undefined;
    return;
  }
  ensureStatusTray();
}

function ensureStatusTray(): void {
  if (statusTray && !statusTray.isDestroyed()) return;
  const image = nativeImage.createFromNamedImage("NSStatusAvailable").resize({ width: 16, height: 16 });
  image.setTemplateImage(true);
  statusTray = new Tray(image);
  statusTray.setToolTip("炉石盒子 · 桌面伴侣");
  statusTray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开主界面", click: showMainWindow },
    {
      label: "打开设置",
      click: () => {
        showMainWindow();
        mainWindow?.webContents.send("tracker:open-settings");
      }
    },
    { type: "separator" },
    { label: "退出", click: () => app.quit() }
  ]));
  statusTray.on("click", showMainWindow);
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createWindow({
      showWhenReady: true,
      focusWhenReady: trackerSettings.general.focusOnOpen
    });
    return;
  }
  presentMainWindow(
    mainWindow,
    trackerSettings.general.focusOnOpen,
    () => app.focus({ steal: true })
  );
}

async function syncCollectionDecksForTracker(options?: { logPath?: string }): Promise<CollectionDeckScanResult> {
  const result = await collectionDecks.scanAndImportDecks(options);
  if (result.status === "ok") {
    tracker.setCollectionDecks(result.decks as readonly CollectionDeck[]);
  }
  return result;
}

async function startTrackingAutomatically(options?: { logPath?: string; deckText?: string }) {
  return tracker.start(options);
}

async function createOverlayWindow(options: { showWhenReady?: boolean; qaDemo?: boolean } = {}) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (options.showWhenReady !== false) {
      overlayWindow.showInactive();
    }
    return overlayWindow;
  }

  if (overlayWindowCreationPromise) {
    const window = await overlayWindowCreationPromise;
    if (options.showWhenReady !== false && !window.isDestroyed() && overlayWindow === window) {
      window.showInactive();
    }
    return window;
  }

  const creationPromise = createOverlayWindowInstance(options.qaDemo === true);
  overlayWindowCreationPromise = creationPromise;
  try {
    const window = await creationPromise;
    if (options.showWhenReady !== false && !window.isDestroyed() && overlayWindow === window) {
      window.showInactive();
    }
    return window;
  } finally {
    if (overlayWindowCreationPromise === creationPromise) {
      overlayWindowCreationPromise = undefined;
    }
  }
}

async function createOverlayWindowInstance(qaDemo = false): Promise<BrowserWindow> {
  const savedBounds = await loadOverlayWindowBounds();
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;

  const createdWindow = new BrowserWindow({
    ...getOverlayWindowPlatformOptions(),
    ...savedBounds,
    minWidth: Math.min(100, savedBounds.width),
    minHeight: Math.min(200, savedBounds.height),
    title: "炉石记牌小窗",
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: createSecureWebPreferences(path.join(__dirname, "preload.cjs"))
  });
  overlayWindow = createdWindow;
  installQaConsoleErrorListener(createdWindow);
  configureSecureNavigation(createdWindow);
  createdWindow.setAlwaysOnTop(true, "screen-saver");
  applyOverlayWindowAppearance();
  tracker.attachWindow(createdWindow);

  createdWindow.on("move", () => {
    overlayInteractionActiveUntil = Date.now() + 1_200;
    scheduleOverlayWindowBoundsSave(createdWindow);
  });
  createdWindow.on("resize", () => {
    overlayInteractionActiveUntil = Date.now() + 1_200;
    scheduleOverlayWindowBoundsSave(createdWindow);
  });
  createdWindow.on("closed", () => {
    hideCardPreviewWindow();
    if (overlayWindow === createdWindow) overlayWindow = undefined;
    if (mainWindow && !mainWindow.isDestroyed()) {
      tracker.attachWindow(mainWindow);
    }
  });

  await loadRendererPage(createdWindow, {
    overlay: "1",
    ...(qaDemo ? { "qa-opponent-demo": "1" } : {})
  });

  return createdWindow;
}

async function loadOverlayWindowBounds() {
  const filePath = getOverlayWindowBoundsPath();
  const raw = await fs.readFile(filePath, "utf8").catch(() => undefined);
  let saved: unknown;
  if (raw) {
    try {
      saved = JSON.parse(raw);
    } catch {
      saved = undefined;
    }
  }
  const normalized = normalizeOverlayWindowBounds(saved, screen.getAllDisplays().map((display) => display.workArea));
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  return normalized.x === undefined ? getDefaultOverlayWindowBounds(display) : normalized;
}

function scheduleOverlayWindowBoundsSave(window: BrowserWindow) {
  if (!window.isDestroyed()) {
    overlayBoundsPersistence.schedule(window.getBounds());
  }
}

async function releaseOverlayWindow(expectedWindow?: BrowserWindow): Promise<void> {
  let window = expectedWindow ?? overlayWindow;
  if (!window && !expectedWindow && overlayWindowCreationPromise) {
    await overlayWindowCreationPromise.catch((error) => {
      reportDiagnosticError("等待我方窗口创建完成失败", error);
    });
    window = overlayWindow;
  }

  if (!window || window.isDestroyed() || overlayWindow !== window) {
    await overlayBoundsPersistence.flush();
    return;
  }

  const finalBounds = window.getBounds();
  try {
    await overlayBoundsPersistence.flush(finalBounds);
  } finally {
    if (overlayWindow === window && !window.isDestroyed()) window.close();
  }
}

async function saveOverlayWindowBounds(bounds: { x: number; y: number; width: number; height: number }) {
  const filePath = getOverlayWindowBoundsPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(bounds)}\n`, "utf8");
}

function getOverlayWindowBoundsPath() {
  return path.join(app.getPath("userData"), "overlay-window-bounds.json");
}

async function createLadderDeckOverlayWindow(options: { showWhenReady?: boolean; qaDemo?: boolean; mode?: LadderMode } = {}) {
  if (ladderDeckOverlayWindow && !ladderDeckOverlayWindow.isDestroyed()) return ladderDeckOverlayWindow;
  const bounds = getLadderDeckOverlayBounds(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea);
  if (!bounds) throw new Error("当前屏幕空间不足，无法显示天梯推荐");

  ladderDeckOverlayWindow = new BrowserWindow({
    ...getOverlayWindowPlatformOptions(),
    ...bounds,
    minWidth: 190,
    minHeight: 400,
    title: "炉石天梯推荐",
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: createSecureWebPreferences(path.join(__dirname, "preload.cjs"))
  });
  installQaConsoleErrorListener(ladderDeckOverlayWindow);
  configureSecureNavigation(ladderDeckOverlayWindow);
  ladderDeckOverlayWindow.setAlwaysOnTop(true, "screen-saver");
  applyOverlayWindowAppearance();
  const createdWindow = ladderDeckOverlayWindow;
  createdWindow.on("move", () => {
    ladderDeckOverlayInteractionActiveUntil = Date.now() + 1_200;
  });
  createdWindow.on("resize", () => {
    ladderDeckOverlayInteractionActiveUntil = Date.now() + 1_200;
  });
  createdWindow.on("closed", () => {
    currentLadderDeckCode = undefined;
    if (ladderDeckOverlayWindow === createdWindow) ladderDeckOverlayWindow = undefined;
  });

  const mode = options.mode ?? resolveLadderDeckMode(tracker.getState()) ?? "standard";
  const params = new URLSearchParams({ "ladder-deck-overlay": "1", mode });
  if (options.qaDemo) params.set("qa-ladder-demo", "1");
  await loadRendererPage(createdWindow, Object.fromEntries(params));
  if (options.showWhenReady !== false && !createdWindow.isDestroyed()) createdWindow.showInactive();
  return createdWindow;
}

async function updateLadderDeckOverlayMode(mode: LadderMode) {
  const result = await ladderDeckRecommendations.get(mode);
  if (resolveLadderDeckMode(tracker.getState()) !== mode || !ladderDeckOverlayWindow || ladderDeckOverlayWindow.isDestroyed()) return;
  currentLadderDeckCode = result.status === "ready" ? result.recommendation.deckCode : undefined;
  ladderDeckOverlayWindow.webContents.send("tracker:ladder-deck-recommendation:update", mode, result);
}

async function createOpponentOverlayWindow(options: {
  showWhenReady?: boolean;
  qaDemo?: boolean;
  restoreCollapsedWhenReady?: boolean;
} = {}) {
  const showWhenReady = options.showWhenReady ?? true;
  const restoreCollapsedWhenReady = options.restoreCollapsedWhenReady ?? true;
  if (opponentOverlayWindow && !opponentOverlayWindow.isDestroyed()) {
    if (showWhenReady) {
      if (opponentOverlayWindowState?.isCollapsed()) {
        await expandOpponentOverlayWindow(true);
      } else {
        opponentOverlayWindow.show();
        opponentOverlayWindow.focus();
      }
    }
    return opponentOverlayWindow;
  }

  let window: BrowserWindow;
  if (opponentOverlayWindowCreationPromise) {
    window = await opponentOverlayWindowCreationPromise;
  } else {
    const creationPromise = createOpponentOverlayWindowInstance(options.qaDemo === true);
    opponentOverlayWindowCreationPromise = creationPromise;
    try {
      window = await creationPromise;
    } finally {
      if (opponentOverlayWindowCreationPromise === creationPromise) {
        opponentOverlayWindowCreationPromise = undefined;
      }
    }
  }

  if (window.isDestroyed() || opponentOverlayWindow !== window) return window;
  if (showWhenReady) {
    if (opponentOverlayRestoreCollapsed && !options.qaDemo) {
      await collapseOpponentOverlayWindow();
    } else {
      window.show();
      window.focus();
    }
  } else if (restoreCollapsedWhenReady && opponentOverlayRestoreCollapsed && !options.qaDemo) {
    await collapseOpponentOverlayWindow();
  }
  return window;
}

async function createOpponentOverlayWindowInstance(qaDemo: boolean): Promise<BrowserWindow> {
  const expandedBounds = await loadOpponentOverlayBounds();
  if (opponentOverlayWindow && !opponentOverlayWindow.isDestroyed()) return opponentOverlayWindow;
  opponentOverlayWindowState = new OpponentOverlayWindowState(expandedBounds);

  const createdWindow = new BrowserWindow({
    ...getOverlayWindowPlatformOptions(),
    ...expandedBounds,
    minWidth: 52,
    minHeight: 38,
    show: false,
    title: "炉石对手出牌",
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    backgroundColor: "#00000000",
    webPreferences: createSecureWebPreferences(path.join(__dirname, "preload.cjs"))
  });
  opponentOverlayWindow = createdWindow;
  installQaConsoleErrorListener(createdWindow);
  configureSecureNavigation(createdWindow);
  createdWindow.setMinimumSize(100, 150);
  createdWindow.setAlwaysOnTop(true, "screen-saver");
  applyOverlayWindowAppearance();
  tracker.attachWindow(createdWindow);

  createdWindow.on("will-move", markOpponentOverlayInteraction);
  createdWindow.on("will-resize", markOpponentOverlayInteraction);
  createdWindow.on("move", () => {
    markOpponentOverlayInteraction();
    scheduleOpponentOverlayBoundsSave(createdWindow);
  });
  createdWindow.on("resize", () => {
    markOpponentOverlayInteraction();
    scheduleOpponentOverlayBoundsSave(createdWindow);
  });
  createdWindow.on("closed", () => {
    hideCardPreviewWindow();
    if (opponentOverlayWindow === createdWindow) {
      opponentOverlayWindow = undefined;
      opponentOverlayWindowState = undefined;
    }
    opponentOverlayInteractionActiveUntil = 0;
  });

  await loadRendererPage(createdWindow, {
    "opponent-overlay": "1",
    ...(qaDemo ? { "qa-opponent-demo": "1" } : {})
  });

  return createdWindow;
}

async function collapseOpponentOverlayWindow() {
  const collapsed = await opponentOverlayWindowController.collapse();
  if (collapsed) opponentOverlayRestoreCollapsed = true;
  return collapsed;
}

async function expandOpponentOverlayWindow(focus: boolean) {
  const collapsed = await opponentOverlayWindowController.expand(focus);
  if (!collapsed) opponentOverlayRestoreCollapsed = false;
  return collapsed;
}

function markOpponentOverlayInteraction(): void {
  opponentOverlayInteractionActiveUntil = Date.now() + 1_200;
}

function scheduleOpponentOverlayBoundsSave(window: BrowserWindow) {
  if (window.isDestroyed() || opponentOverlayWindowState?.isCollapsed()) {
    return;
  }
  const bounds = window.getBounds();
  opponentOverlayWindowState?.updateExpandedBounds(bounds);
  opponentOverlayBoundsPersistence.schedule(bounds);
}

async function releaseOpponentOverlayWindow(expectedWindow?: BrowserWindow): Promise<void> {
  let window = expectedWindow ?? opponentOverlayWindow;
  if (!window && !expectedWindow && opponentOverlayWindowCreationPromise) {
    await opponentOverlayWindowCreationPromise.catch((error) => {
      reportDiagnosticError("等待对手窗口创建完成失败", error);
    });
    window = opponentOverlayWindow;
  }

  if (!window || window.isDestroyed() || opponentOverlayWindow !== window) {
    await opponentOverlayBoundsPersistence.flush();
    return;
  }
  const finalBounds = !opponentOverlayWindowState?.isCollapsed()
    ? window.getBounds()
    : undefined;
  try {
    await opponentOverlayBoundsPersistence.flush(finalBounds);
  } finally {
    if (opponentOverlayWindow === window && !window.isDestroyed()) window.close();
  }
}

async function loadOpponentOverlayBounds() {
  const fallbackWorkArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const workAreas = screen.getAllDisplays().map((display) => display.workArea);
  try {
    const value = JSON.parse(await fs.readFile(getOpponentOverlayBoundsPath(), "utf8")) as unknown;
    return normalizeOpponentOverlayWindowBounds(value, workAreas, fallbackWorkArea);
  } catch {
    // The default bounds are used until the user moves or resizes the window.
  }
  return normalizeOpponentOverlayWindowBounds(undefined, workAreas, fallbackWorkArea);
}

async function saveOpponentOverlayBounds(bounds: { x: number; y: number; width: number; height: number }) {
  await fs.mkdir(path.dirname(getOpponentOverlayBoundsPath()), { recursive: true });
  await fs.writeFile(getOpponentOverlayBoundsPath(), `${JSON.stringify(bounds)}\n`, "utf8");
}

function getOpponentOverlayBoundsPath() {
  return path.join(app.getPath("userData"), "opponent-overlay-window-bounds.json");
}

function startBoardAttackOverlayMonitor() {
  if (boardAttackOverlayMonitor) {
    return;
  }
  boardAttackOverlayMonitor = setInterval(() => {
    void refreshBoardAttackOverlayWindow();
  }, 250);
  boardAttackOverlayMonitor.unref();
  void refreshBoardAttackOverlayWindow();
}

function stopBoardAttackOverlayMonitor() {
  if (boardAttackOverlayMonitor) {
    clearInterval(boardAttackOverlayMonitor);
    boardAttackOverlayMonitor = undefined;
  }
  releaseFriendlyAttackOverlayWindow();
  releaseOpponentAttackOverlayWindow();
  releaseFriendlyHealthOverlayWindow();
  releaseOpponentHealthOverlayWindow();
  releaseSecretOverlayWindow();
  releaseAllSmartCounterOverlayWindows();
}

async function refreshBoardAttackOverlayWindow() {
  if (boardAttackOverlayRefreshInFlight) {
    return;
  }
  boardAttackOverlayRefreshInFlight = true;
  try {
    const hideAll = () => {
      releaseFriendlyAttackOverlayWindow();
      releaseOpponentAttackOverlayWindow();
      releaseFriendlyHealthOverlayWindow();
      releaseOpponentHealthOverlayWindow();
      releaseSecretOverlayWindow();
      releaseAllSmartCounterOverlayWindows();
    };
    if (!trackerSettings.overlay.enabled || (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused())) {
      hideAll();
      return;
    }
    const state = tracker.getState();
    const frontmostAppName = await getFrontmostAppName();
    const auxiliaryInteractionActive = isAuxiliaryOverlayInteractionActive();
    if (!shouldShowBoardAttackOverlay(
      Boolean(state.gameActive),
      frontmostAppName,
      auxiliaryInteractionActive
    )) {
      hideAll();
      return;
    }

    const display = await resolveHearthstoneDisplay();
    await refreshAuxiliaryOverlayWindow(
      trackerSettings.overlay.showFriendlyAttack,
      () => createFriendlyAttackOverlayWindow(display.bounds),
      releaseFriendlyAttackOverlayWindow
    );
    await refreshAuxiliaryOverlayWindow(
      trackerSettings.overlay.showOpponentAttack,
      () => createOpponentAttackOverlayWindow(display.bounds),
      releaseOpponentAttackOverlayWindow
    );
    await refreshAuxiliaryOverlayWindow(
      trackerSettings.overlay.healthChange && state.heroHealthLimit?.friendly !== undefined,
      () => createFriendlyHealthOverlayWindow(display.bounds),
      releaseFriendlyHealthOverlayWindow
    );
    await refreshAuxiliaryOverlayWindow(
      trackerSettings.overlay.healthChange && state.heroHealthLimit?.opponent !== undefined,
      () => createOpponentHealthOverlayWindow(display.bounds),
      releaseOpponentHealthOverlayWindow
    );
    await refreshAuxiliaryOverlayWindow(
      trackerSettings.overlay.secretPrediction && (state.opponentSecrets?.length ?? 0) > 0,
      () => createSecretOverlayWindow(display.bounds, {
        possibleCandidateCounts: (state.opponentSecrets ?? []).map((slot) =>
          slot.candidates.filter((candidate) => candidate.status === "possible").length
        )
      }),
      releaseSecretOverlayWindow
    );
    await refreshSmartCounterOverlayWindows(
      state.smartCounters ?? [],
      display.bounds,
      display.workArea
    );
  } finally {
    boardAttackOverlayRefreshInFlight = false;
  }
}

async function refreshAuxiliaryOverlayWindow(
  shouldShow: boolean,
  createWindow: () => Promise<BrowserWindow | undefined>,
  releaseWindow: () => void
): Promise<void> {
  if (!shouldShow) {
    releaseWindow();
    return;
  }
  const window = await createWindow();
  if (window && !window.isDestroyed()) window.showInactive();
}

async function resolveHearthstoneDisplay() {
  const now = Date.now();
  if (cachedHearthstoneDisplay && cachedHearthstoneDisplay.expiresAt > now) {
    const cached = screen.getAllDisplays().find((display) => display.id === cachedHearthstoneDisplay?.id);
    if (cached) return cached;
  }

  if (!appPermissionManager.isScreenCaptureGranted()) {
    const fallback = screen.getPrimaryDisplay();
    cachedHearthstoneDisplay = { id: fallback.id, expiresAt: now + 2_000 };
    return fallback;
  }

  try {
    const sources = await desktopCapturer.getSources({
      types: [...HEARTHSTONE_WINDOW_CAPTURE_TYPES],
      thumbnailSize: { width: 1, height: 1 },
      fetchWindowIcons: false
    });
    const source = selectHearthstoneWindowCaptureSource(sources);
    const displayId = Number(source?.display_id);
    const display = Number.isFinite(displayId)
      ? screen.getAllDisplays().find((candidate) => candidate.id === displayId)
      : undefined;
    if (display) {
      cachedHearthstoneDisplay = { id: display.id, expiresAt: now + 2_000 };
      return display;
    }
  } catch {
    // Screen capture permission or source lookup can be temporarily unavailable.
  }

  const fallback = screen.getPrimaryDisplay();
  cachedHearthstoneDisplay = { id: fallback.id, expiresAt: now + 2_000 };
  return fallback;
}

function getMovableAuxiliaryOverlayWindow(
  kind: MovableAuxiliaryOverlayKind
): BrowserWindow | undefined {
  if (kind === "friendly-attack") return friendlyAttackOverlayWindow;
  if (kind === "opponent-attack") return opponentAttackOverlayWindow;
  if (kind === "friendly-health") return friendlyHealthOverlayWindow;
  if (kind === "opponent-health") return opponentHealthOverlayWindow;
  if (kind === "secret") return secretOverlayWindow;
  const counterId = getSmartCounterIdFromOverlayKind(kind);
  return counterId ? smartCounterOverlayWindows.get(counterId) : undefined;
}

function resolveMovableAuxiliaryOverlayKind(sender: unknown): MovableAuxiliaryOverlayKind | undefined {
  const registered = auxiliaryOverlayKindsByWebContents.get(sender as Electron.WebContents);
  if (registered) return registered;
  if (sender === friendlyAttackOverlayWindow?.webContents) return "friendly-attack";
  if (sender === opponentAttackOverlayWindow?.webContents) return "opponent-attack";
  if (sender === friendlyHealthOverlayWindow?.webContents) return "friendly-health";
  if (sender === opponentHealthOverlayWindow?.webContents) return "opponent-health";
  if (sender === secretOverlayWindow?.webContents) return "secret";
  return undefined;
}

async function resolveAuxiliaryOverlayBounds(
  kind: MovableAuxiliaryOverlayKind,
  defaultBounds: AuxiliaryOverlayBounds
): Promise<AuxiliaryOverlayBounds> {
  const workArea = screen.getDisplayMatching(defaultBounds).workArea;
  const visibleBounds = kind === "secret"
    ? getSecretOverlayVisibleBounds(
        defaultBounds,
        await auxiliaryOverlayWindowStateStore.getSecretCollapsed()
      )
    : defaultBounds;
  return auxiliaryOverlayWindowStateStore.resolveBounds(kind, visibleBounds, workArea);
}

async function setSecretOverlayCollapsed(collapsed: boolean): Promise<boolean> {
  const window = secretOverlayWindow;
  const expandedBounds = secretOverlayExpandedBounds;
  if (!window || window.isDestroyed() || !expandedBounds) {
    await auxiliaryOverlayWindowStateStore.setSecretCollapsed(collapsed);
    return collapsed;
  }
  const currentBounds = window.getBounds();
  const workArea = screen.getDisplayMatching(currentBounds).workArea;
  const bounds = await auxiliaryOverlayWindowStateStore.setSecretCollapsed(collapsed, {
    currentBounds,
    expandedBounds,
    workArea
  });
  updateAuxiliaryOverlayBounds(window, bounds);
  return collapsed;
}

function beginAuxiliaryOverlayDrag(
  kind: MovableAuxiliaryOverlayKind,
  point: AuxiliaryOverlayPoint
): void {
  markAuxiliaryOverlayInteraction();
  const window = getMovableAuxiliaryOverlayWindow(kind);
  if (!window || window.isDestroyed()) return;
  const initialBounds = window.getBounds();
  auxiliaryOverlayDragSessions.set(kind, {
    window,
    initialBounds,
    initialPointer: point,
    workArea: screen.getDisplayMatching(initialBounds).workArea
  });
}

function moveAuxiliaryOverlayDrag(
  kind: MovableAuxiliaryOverlayKind,
  point: AuxiliaryOverlayPoint
): void {
  markAuxiliaryOverlayInteraction();
  const session = auxiliaryOverlayDragSessions.get(kind);
  const window = getMovableAuxiliaryOverlayWindow(kind);
  if (!session || !window || window !== session.window || window.isDestroyed()) return;
  window.setBounds(moveAuxiliaryOverlayBounds(
    session.initialBounds,
    session.initialPointer,
    point,
    session.workArea
  ), false);
}

async function endAuxiliaryOverlayDrag(
  kind: MovableAuxiliaryOverlayKind,
  point: AuxiliaryOverlayPoint
): Promise<void> {
  markAuxiliaryOverlayInteraction();
  moveAuxiliaryOverlayDrag(kind, point);
  const session = auxiliaryOverlayDragSessions.get(kind);
  const window = getMovableAuxiliaryOverlayWindow(kind);
  if (!session || !window || window !== session.window || window.isDestroyed()) {
    auxiliaryOverlayDragSessions.delete(kind);
    return;
  }
  try {
    await auxiliaryOverlayWindowStateStore.saveBounds(kind, window.getBounds(), session.workArea);
  } finally {
    if (auxiliaryOverlayDragSessions.get(kind) === session) {
      auxiliaryOverlayDragSessions.delete(kind);
    }
    markAuxiliaryOverlayInteraction();
  }
}

function updateAuxiliaryOverlayBounds(window: BrowserWindow, bounds: { x: number; y: number; width: number; height: number }) {
  if ([...auxiliaryOverlayDragSessions.values()].some((session) => session.window === window)) return;
  const current = window.getBounds();
  if (current.x !== bounds.x || current.y !== bounds.y || current.width !== bounds.width || current.height !== bounds.height) {
    window.setBounds(bounds, false);
  }
}

function beginAuxiliaryOverlayCreation(kind: AuxiliaryOverlayKind): number {
  return auxiliaryOverlayGenerations[kind];
}

function cancelAuxiliaryOverlayCreation(kind: AuxiliaryOverlayKind): void {
  auxiliaryOverlayGenerations[kind] += 1;
}

function isAuxiliaryOverlayCreationCurrent(kind: AuxiliaryOverlayKind, generation: number): boolean {
  return auxiliaryOverlayGenerations[kind] === generation;
}

async function createFriendlyAttackOverlayWindow(
  displayBounds: { x: number; y: number; width: number; height: number },
  options: { qaDemo?: boolean } = {}
) {
  const bounds = await resolveAuxiliaryOverlayBounds(
    "friendly-attack",
    getAuxiliaryOverlayBounds(displayBounds, "friendly-attack")
  );
  if (friendlyAttackOverlayWindow && !friendlyAttackOverlayWindow.isDestroyed()) {
    updateAuxiliaryOverlayBounds(friendlyAttackOverlayWindow, bounds);
    return friendlyAttackOverlayWindow;
  }
  const generation = beginAuxiliaryOverlayCreation("friendly-attack");
  const createdWindow = await createAuxiliaryOverlayWindow(
    "friendly-attack",
    bounds,
    { "friendly-attack-overlay": "1", ...(options.qaDemo ? { "qa-opponent-demo": "1" } : {}) },
    ".single-attack-overlay"
  );
  if (!isAuxiliaryOverlayCreationCurrent("friendly-attack", generation)) {
    if (createdWindow && !createdWindow.isDestroyed()) createdWindow.destroy();
    return undefined;
  }
  friendlyAttackOverlayWindow = createdWindow;
  createdWindow?.on("closed", () => {
    if (friendlyAttackOverlayWindow === createdWindow) friendlyAttackOverlayWindow = undefined;
  });
  return createdWindow;
}

function releaseFriendlyAttackOverlayWindow(): void {
  cancelAuxiliaryOverlayCreation("friendly-attack");
  auxiliaryOverlayDragSessions.delete("friendly-attack");
  friendlyAttackOverlayWindow?.close();
  friendlyAttackOverlayWindow = undefined;
}

async function createOpponentAttackOverlayWindow(
  displayBounds: { x: number; y: number; width: number; height: number },
  options: { qaDemo?: boolean } = {}
) {
  const bounds = await resolveAuxiliaryOverlayBounds(
    "opponent-attack",
    getAuxiliaryOverlayBounds(displayBounds, "opponent-attack")
  );
  if (opponentAttackOverlayWindow && !opponentAttackOverlayWindow.isDestroyed()) {
    updateAuxiliaryOverlayBounds(opponentAttackOverlayWindow, bounds);
    return opponentAttackOverlayWindow;
  }
  const generation = beginAuxiliaryOverlayCreation("opponent-attack");
  const createdWindow = await createAuxiliaryOverlayWindow(
    "opponent-attack",
    bounds,
    { "opponent-attack-overlay": "1", ...(options.qaDemo ? { "qa-opponent-demo": "1" } : {}) },
    ".single-attack-overlay"
  );
  if (!isAuxiliaryOverlayCreationCurrent("opponent-attack", generation)) {
    if (createdWindow && !createdWindow.isDestroyed()) createdWindow.destroy();
    return undefined;
  }
  opponentAttackOverlayWindow = createdWindow;
  createdWindow?.on("closed", () => {
    if (opponentAttackOverlayWindow === createdWindow) opponentAttackOverlayWindow = undefined;
  });
  return createdWindow;
}

function releaseOpponentAttackOverlayWindow(): void {
  cancelAuxiliaryOverlayCreation("opponent-attack");
  auxiliaryOverlayDragSessions.delete("opponent-attack");
  opponentAttackOverlayWindow?.close();
  opponentAttackOverlayWindow = undefined;
}

async function createFriendlyHealthOverlayWindow(
  displayBounds: { x: number; y: number; width: number; height: number },
  options: { qaDemo?: boolean } = {}
) {
  const bounds = await resolveAuxiliaryOverlayBounds(
    "friendly-health",
    getHeroHealthOverlayBounds(displayBounds, "friendly-health")
  );
  if (friendlyHealthOverlayWindow && !friendlyHealthOverlayWindow.isDestroyed()) {
    updateAuxiliaryOverlayBounds(friendlyHealthOverlayWindow, bounds);
    return friendlyHealthOverlayWindow;
  }
  const generation = beginAuxiliaryOverlayCreation("friendly-health");
  const createdWindow = await createAuxiliaryOverlayWindow(
    "friendly-health",
    bounds,
    { "friendly-health-overlay": "1", ...(options.qaDemo ? { "qa-opponent-demo": "1" } : {}) },
    ".health-overlay"
  );
  if (!isAuxiliaryOverlayCreationCurrent("friendly-health", generation)) {
    if (createdWindow && !createdWindow.isDestroyed()) createdWindow.destroy();
    return undefined;
  }
  friendlyHealthOverlayWindow = createdWindow;
  createdWindow?.on("closed", () => {
    if (auxiliaryOverlayDragSessions.get("friendly-health")?.window === createdWindow) {
      auxiliaryOverlayDragSessions.delete("friendly-health");
    }
    if (friendlyHealthOverlayWindow === createdWindow) friendlyHealthOverlayWindow = undefined;
  });
  return createdWindow;
}

function releaseFriendlyHealthOverlayWindow(): void {
  cancelAuxiliaryOverlayCreation("friendly-health");
  auxiliaryOverlayDragSessions.delete("friendly-health");
  friendlyHealthOverlayWindow?.close();
  friendlyHealthOverlayWindow = undefined;
}

async function createOpponentHealthOverlayWindow(
  displayBounds: { x: number; y: number; width: number; height: number },
  options: { qaDemo?: boolean } = {}
) {
  const bounds = await resolveAuxiliaryOverlayBounds(
    "opponent-health",
    getHeroHealthOverlayBounds(displayBounds, "opponent-health")
  );
  if (opponentHealthOverlayWindow && !opponentHealthOverlayWindow.isDestroyed()) {
    updateAuxiliaryOverlayBounds(opponentHealthOverlayWindow, bounds);
    return opponentHealthOverlayWindow;
  }
  const generation = beginAuxiliaryOverlayCreation("opponent-health");
  const createdWindow = await createAuxiliaryOverlayWindow(
    "opponent-health",
    bounds,
    { "opponent-health-overlay": "1", ...(options.qaDemo ? { "qa-opponent-demo": "1" } : {}) },
    ".health-overlay"
  );
  if (!isAuxiliaryOverlayCreationCurrent("opponent-health", generation)) {
    if (createdWindow && !createdWindow.isDestroyed()) createdWindow.destroy();
    return undefined;
  }
  opponentHealthOverlayWindow = createdWindow;
  createdWindow?.on("closed", () => {
    if (auxiliaryOverlayDragSessions.get("opponent-health")?.window === createdWindow) {
      auxiliaryOverlayDragSessions.delete("opponent-health");
    }
    if (opponentHealthOverlayWindow === createdWindow) opponentHealthOverlayWindow = undefined;
  });
  return createdWindow;
}

function releaseOpponentHealthOverlayWindow(): void {
  cancelAuxiliaryOverlayCreation("opponent-health");
  auxiliaryOverlayDragSessions.delete("opponent-health");
  opponentHealthOverlayWindow?.close();
  opponentHealthOverlayWindow = undefined;
}

async function createSecretOverlayWindow(
  displayBounds: { x: number; y: number; width: number; height: number },
  options: { qaDemo?: boolean; possibleCandidateCounts: readonly number[] }
) {
  secretOverlayExpandedBounds = getSecretOverlayBounds(displayBounds, options.possibleCandidateCounts);
  const bounds = await resolveAuxiliaryOverlayBounds("secret", secretOverlayExpandedBounds);
  if (secretOverlayWindow && !secretOverlayWindow.isDestroyed()) {
    updateAuxiliaryOverlayBounds(secretOverlayWindow, bounds);
    return secretOverlayWindow;
  }
  const generation = beginAuxiliaryOverlayCreation("secret");
  const createdWindow = await createAuxiliaryOverlayWindow(
    "secret",
    bounds,
    { "secret-overlay": "1", ...(options.qaDemo ? { "qa-opponent-demo": "1" } : {}) },
    ".secret-overlay-shell"
  );
  if (!isAuxiliaryOverlayCreationCurrent("secret", generation)) {
    if (createdWindow && !createdWindow.isDestroyed()) createdWindow.destroy();
    return undefined;
  }
  secretOverlayWindow = createdWindow;
  createdWindow?.on("closed", () => {
    if (secretOverlayWindow === createdWindow) secretOverlayWindow = undefined;
  });
  return createdWindow;
}

function releaseSecretOverlayWindow(): void {
  cancelAuxiliaryOverlayCreation("secret");
  auxiliaryOverlayDragSessions.delete("secret");
  secretOverlayWindow?.close();
  secretOverlayWindow = undefined;
}

async function refreshSmartCounterOverlayWindows(
  counters: readonly { readonly id: string }[],
  displayBounds: { x: number; y: number; width: number; height: number },
  workArea: AuxiliaryOverlayWorkArea
): Promise<void> {
  const hidden = new Set(trackerSettings.overlay.hiddenSmartCounterIds ?? []);
  const visibleCounters = trackerSettings.overlay.smartCardCounters
    ? counters.filter((counter) => !hidden.has(counter.id))
    : [];
  const visibleIds = new Set(visibleCounters.map((counter) => counter.id));

  for (const counterId of [...smartCounterOverlayWindows.keys()]) {
    if (!visibleIds.has(counterId)) releaseSmartCounterOverlayWindow(counterId);
  }

  await Promise.all(visibleCounters.map(async (counter, index) => {
    const window = await createSmartCounterOverlayWindow(counter.id, displayBounds, index, { workArea });
    if (window && !window.isDestroyed()) window.showInactive();
  }));
}

async function createSmartCounterOverlayWindow(
  counterId: string,
  displayBounds: { x: number; y: number; width: number; height: number },
  index = 0,
  options: { qaDemo?: boolean; workArea?: AuxiliaryOverlayWorkArea } = {}
) {
  const kind = getSmartCounterOverlayKind(counterId);
  const bounds = await resolveAuxiliaryOverlayBounds(
    kind,
    getSmartCounterOverlayBounds(displayBounds, index, options.workArea ?? displayBounds)
  );
  const existing = smartCounterOverlayWindows.get(counterId);
  if (existing && !existing.isDestroyed()) {
    if (!auxiliaryOverlayDragSessions.has(kind)) {
      updateAuxiliaryOverlayBounds(existing, bounds);
    }
    return existing;
  }

  const generation = Symbol(counterId);
  smartCounterOverlayGenerations.set(counterId, generation);
  const createdWindow = await createAuxiliaryOverlayWindow(
    kind,
    bounds,
    {
      "smart-counter-overlay": "1",
      "smart-counter-id": counterId,
      ...(options.qaDemo ? { "qa-opponent-demo": "1" } : {})
    },
    ".smart-counter-overlay"
  );
  if (smartCounterOverlayGenerations.get(counterId) !== generation) {
    if (createdWindow && !createdWindow.isDestroyed()) createdWindow.destroy();
    return undefined;
  }
  smartCounterOverlayGenerations.delete(counterId);

  if (!createdWindow) return undefined;
  smartCounterOverlayWindows.set(counterId, createdWindow);
  createdWindow.on("closed", () => {
    if (auxiliaryOverlayDragSessions.get(kind)?.window === createdWindow) {
      auxiliaryOverlayDragSessions.delete(kind);
    }
    if (smartCounterOverlayWindows.get(counterId) === createdWindow) {
      smartCounterOverlayWindows.delete(counterId);
    }
  });
  return createdWindow;
}

function releaseSmartCounterOverlayWindow(counterId: string): void {
  smartCounterOverlayGenerations.delete(counterId);
  const kind = getSmartCounterOverlayKind(counterId);
  auxiliaryOverlayDragSessions.delete(kind);
  const window = smartCounterOverlayWindows.get(counterId);
  if (window && !window.isDestroyed()) window.close();
  smartCounterOverlayWindows.delete(counterId);
}

function releaseAllSmartCounterOverlayWindows(): void {
  const counterIds = new Set([
    ...smartCounterOverlayGenerations.keys(),
    ...smartCounterOverlayWindows.keys()
  ]);
  for (const counterId of counterIds) releaseSmartCounterOverlayWindow(counterId);
}

async function createAuxiliaryOverlayWindow(
  kind: MovableAuxiliaryOverlayKind,
  bounds: { x: number; y: number; width: number; height: number },
  query: Readonly<Record<string, string>>,
  rootSelector: string
): Promise<BrowserWindow | undefined> {
  const window = new BrowserWindow(getBoardAttackOverlayWindowOptions(bounds, path.join(__dirname, "preload.cjs")));
  const webContents = window.webContents;
  trustedAuxiliaryWebContents.add(webContents);
  auxiliaryOverlayKindsByWebContents.set(webContents, kind);
  webContents.once("destroyed", () => {
    trustedAuxiliaryWebContents.delete(webContents);
    auxiliaryOverlayKindsByWebContents.delete(webContents);
  });
  installQaConsoleErrorListener(window);
  configureSecureNavigation(window);
  configureBoardAttackOverlayWindow(window, useQaAccessoryActivationPolicy);
  window.setOpacity(trackerSettings.overlay.opacity / 100);
  configureOverlayWorkspaceWindow(
    window,
    !trackerSettings.overlay.hideInFullscreen,
    useQaAccessoryActivationPolicy
  );
  tracker.attachWindow(window);
  try {
    await loadRendererPage(window, query);
    const rendererReady = await window.webContents.executeJavaScript(`
      (() => document.documentElement.dataset.rendererReady === "true" && Boolean(document.querySelector(${JSON.stringify(rootSelector)})))()
    `);
    if (rendererReady) return window;
  } catch {
    // A broken auxiliary overlay stays invisible and is recreated by the next monitor tick.
  }
  if (!window.isDestroyed()) window.destroy();
  return undefined;
}

async function createArenaChoiceOverlayWindow(options: { qaDemo?: boolean } = {}) {
  if (arenaChoiceOverlayWindow && !arenaChoiceOverlayWindow.isDestroyed()) {
    return arenaChoiceOverlayWindow;
  }

  const bounds = getArenaChoiceOverlayBounds();
  arenaChoiceOverlayWindow = new BrowserWindow({
    ...getOverlayWindowPlatformOptions(),
    ...bounds,
    title: "炉石竞技场数据条",
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    show: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: createSecureWebPreferences(path.join(__dirname, "preload.cjs"))
  });
  installQaConsoleErrorListener(arenaChoiceOverlayWindow);
  configureSecureNavigation(arenaChoiceOverlayWindow);
  arenaChoiceOverlayWindow.setAlwaysOnTop(true, "screen-saver");
  applyOverlayWindowAppearance();
  arenaChoiceOverlayWindow.setIgnoreMouseEvents(true, { forward: true });
  tracker.attachWindow(arenaChoiceOverlayWindow);
  const createdWindow = arenaChoiceOverlayWindow;

  createdWindow.on("closed", () => {
    if (arenaChoiceOverlayWindow === createdWindow) arenaChoiceOverlayWindow = undefined;
  });

  await loadRendererPage(createdWindow, {
    "arena-choice-overlay": "1",
    ...(options.qaDemo ? { "qa-arena-demo": "1" } : {})
  });

  if (options.qaDemo) {
    if (!createdWindow.isDestroyed()) createdWindow.showInactive();
  }

  return createdWindow;
}

async function createCardPreviewWindow() {
  if (cardPreviewWindow && !cardPreviewWindow.isDestroyed()) {
    return cardPreviewWindow;
  }

  cardPreviewWindow = new BrowserWindow({
    ...getOverlayWindowPlatformOptions(),
    width: cardPreviewWidth,
    height: cardPreviewHeight,
    title: "炉石卡牌说明",
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    show: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: createSecureWebPreferences(path.join(__dirname, "preload.cjs"))
  });
  installQaConsoleErrorListener(cardPreviewWindow);
  configureSecureNavigation(cardPreviewWindow);
  cardPreviewWindow.setAlwaysOnTop(true, "screen-saver");
  applyOverlayWindowAppearance();
  cardPreviewWindow.setIgnoreMouseEvents(false);

  cardPreviewWindow.on("closed", () => {
    unregisterCardPreviewPinShortcut();
    clearCardPreviewAutoHideTimer();
    cardPreviewSourceWindow = undefined;
    cardPreviewPinned = false;
    lastCardPreviewRequestKey = undefined;
    cardPreviewRequestSerial += 1;
    cardPreviewWindow = undefined;
  });

  await loadRendererPage(cardPreviewWindow, { "card-preview": "1" });

  return cardPreviewWindow;
}

async function showCardPreviewWindow(sourceWindow: BrowserWindow | null, request: CardPreviewRequest) {
  if (!trackerSettings.overlay.enabled || !sourceWindow || sourceWindow.isDestroyed() || !isCardPreviewRequest(request)) {
    return;
  }

  const hover = cardPreviewVisibilityGate.beginHover();
  cardPreviewSourceWindow = sourceWindow;
  const frontmostAppName = await getFrontmostAppName();
  const qaPreview = process.env.QA_SHOW_CARD_PREVIEW === "1";
  if (!qaPreview && !cardPreviewVisibilityGate.canShow(hover, frontmostAppName)) {
    if (cardPreviewVisibilityGate.invalidateIfCurrent(hover)) {
      hideCardPreviewWindow();
    }
    return;
  }

  const previewWindow = await createCardPreviewWindow();
  if (previewWindow.isDestroyed()) {
    return;
  }
  registerCardPreviewPinShortcut();

  const requestKey = getCardPreviewRequestKey(sourceWindow, request);
  if (previewWindow.isVisible() && lastCardPreviewRequestKey === requestKey) {
    previewWindow.webContents.send("tracker:card-preview:update", request.details);
    scheduleCardPreviewAutoHide();
    return;
  }

  const requestSerial = ++cardPreviewRequestSerial;
  previewWindow.webContents.send("tracker:card-preview:update", request.details);
  const contentHeight = await getCardPreviewContentHeight(previewWindow);
  const latestFrontmostAppName = await getFrontmostAppName();
  if (
    requestSerial !== cardPreviewRequestSerial ||
    previewWindow.isDestroyed() ||
    (!qaPreview && !cardPreviewVisibilityGate.canShow(hover, latestFrontmostAppName))
  ) {
    return;
  }

  previewWindow.setBounds(getCardPreviewBounds(sourceWindow, request, contentHeight));
  cardPreviewSourceWindow = sourceWindow;
  registerCardPreviewPinShortcut();
  previewWindow.showInactive();
  lastCardPreviewRequestKey = requestKey;
  scheduleCardPreviewAutoHide();
}

function hideCardPreviewWindow(sourceWindow?: BrowserWindow | null) {
  if (sourceWindow && cardPreviewSourceWindow && sourceWindow !== cardPreviewSourceWindow) {
    return;
  }

  unregisterCardPreviewPinShortcut();
  cardPreviewVisibilityGate.invalidate();
  clearCardPreviewAutoHideTimer();
  setCardPreviewPinned(false);
  cardPreviewSourceWindow = undefined;
  lastCardPreviewRequestKey = undefined;
  cardPreviewRequestSerial += 1;
  if (!cardPreviewWindow || cardPreviewWindow.isDestroyed()) {
    return;
  }

  releaseTransientWindow(cardPreviewWindow);
}

function startCardPreviewVisibilityMonitor() {
  stopCardPreviewVisibilityMonitor();
  cardPreviewVisibilityMonitor = setInterval(() => {
    void refreshCardPreviewVisibility();
  }, cardPreviewVisibilityIntervalMs);
  cardPreviewVisibilityMonitor.unref();
}

function stopCardPreviewVisibilityMonitor() {
  if (!cardPreviewVisibilityMonitor) {
    return;
  }
  clearInterval(cardPreviewVisibilityMonitor);
  cardPreviewVisibilityMonitor = undefined;
}

async function refreshCardPreviewVisibility() {
  if (cardPreviewVisibilityRefreshInFlight || !cardPreviewWindow || cardPreviewWindow.isDestroyed()) {
    return;
  }

  cardPreviewVisibilityRefreshInFlight = true;
  let frontmostAppName: string | undefined;
  try {
    frontmostAppName = await getFrontmostAppName();
  } finally {
    cardPreviewVisibilityRefreshInFlight = false;
  }

  if (!cardPreviewPinned && cardPreviewVisibilityGate.refresh(frontmostAppName)) {
    hideCardPreviewWindow();
  }
}

function scheduleCardPreviewAutoHide() {
  clearCardPreviewAutoHideTimer();
  if (cardPreviewPinned) {
    return;
  }
  cardPreviewAutoHideTimer = setTimeout(hideCardPreviewWindow, cardPreviewAutoHideMs);
  cardPreviewAutoHideTimer.unref();
}

function registerCardPreviewPinShortcut() {
  if (globalShortcut.isRegistered(cardPreviewPinAccelerator)) {
    return;
  }

  globalShortcut.register(cardPreviewPinAccelerator, () => {
    if (!cardPreviewWindow || cardPreviewWindow.isDestroyed() || !cardPreviewWindow.isVisible()) {
      return;
    }
    setCardPreviewPinned(!cardPreviewPinned);
  });
}

function unregisterCardPreviewPinShortcut() {
  if (globalShortcut.isRegistered(cardPreviewPinAccelerator)) {
    globalShortcut.unregister(cardPreviewPinAccelerator);
  }
}

function setCardPreviewPinned(pinned: boolean) {
  cardPreviewPinned = pinned;
  if (pinned) {
    clearCardPreviewAutoHideTimer();
  }

  if (cardPreviewSourceWindow && !cardPreviewSourceWindow.isDestroyed()) {
    cardPreviewSourceWindow.webContents.send("tracker:card-preview:pinned", pinned);
  }
  if (cardPreviewWindow && !cardPreviewWindow.isDestroyed()) {
    cardPreviewWindow.webContents.send("tracker:card-preview:pinned", pinned);
  }
}

function clearCardPreviewAutoHideTimer() {
  if (!cardPreviewAutoHideTimer) {
    return;
  }

  clearTimeout(cardPreviewAutoHideTimer);
  cardPreviewAutoHideTimer = undefined;
}

function isCardPreviewRequest(value: unknown): value is CardPreviewRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const request = value as CardPreviewRequest;
  const rect = request.anchorRect;
  return (
    Boolean(request.details) &&
    typeof request.details.name === "string" &&
    rect !== undefined &&
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.right) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  );
}

function getCardPreviewBounds(sourceWindow: BrowserWindow, request: CardPreviewRequest, desiredHeight = cardPreviewHeight) {
  const sourceBounds = sourceWindow.getBounds();
  const display = screen.getDisplayMatching(sourceBounds);
  const area = display.workArea;
  const width = Math.min(cardPreviewWidth, Math.max(220, area.width - 12));
  const height = Math.min(Math.max(cardPreviewMinHeight, desiredHeight), cardPreviewHeight, Math.max(cardPreviewMinHeight, area.height - 12));
  const rightX = sourceBounds.x + sourceBounds.width + cardPreviewGap;
  const leftX = sourceBounds.x - width - cardPreviewGap;
  const maxX = area.x + area.width - width - 6;
  const x = rightX <= maxX
    ? rightX
    : leftX >= area.x + 6
      ? leftX
      : clamp(sourceBounds.x + request.anchorRect.right + cardPreviewGap, area.x + 6, maxX);
  const preferredY = sourceBounds.y + request.anchorRect.top - 8;
  const maxY = area.y + area.height - height - 6;

  return {
    x,
    y: clamp(preferredY, area.y + 6, maxY),
    width,
    height
  };
}

function getCardPreviewRequestKey(sourceWindow: BrowserWindow, request: CardPreviewRequest): string {
  const sourceBounds = sourceWindow.getBounds();
  return JSON.stringify({
    sourceBounds: roundBounds(sourceBounds),
    anchorRect: roundCardPreviewAnchorRect(request.anchorRect),
    details: request.details
  });
}

function roundBounds(bounds: { x: number; y: number; width: number; height: number }) {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  };
}

function roundCardPreviewAnchorRect(rect: CardPreviewRequest["anchorRect"]): CardPreviewRequest["anchorRect"] {
  return {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

async function getCardPreviewContentHeight(previewWindow: BrowserWindow): Promise<number> {
  await new Promise((resolve) => setTimeout(resolve, 40));

  try {
    const contentHeight = (await previewWindow.webContents.executeJavaScript(`
      (() => {
        const shell = document.querySelector(".card-preview-window-shell");
        if (!shell) return 0;
        const rect = shell.getBoundingClientRect();
        const styles = window.getComputedStyle(shell);
        const borderHeight = Number.parseFloat(styles.borderTopWidth || "0") + Number.parseFloat(styles.borderBottomWidth || "0");
        return Math.ceil(Math.max(shell.scrollHeight + borderHeight, rect.height));
      })()
    `)) as number;
    return Number.isFinite(contentHeight) && contentHeight > 0 ? contentHeight : cardPreviewHeight;
  } catch {
    return cardPreviewHeight;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function startArenaChoiceOverlayMonitor() {
  if (arenaChoiceOverlayMonitor) return;
  arenaChoiceOverlayMonitor = setInterval(() => {
    void refreshArenaChoiceOverlayWindow();
  }, 350);
  arenaChoiceOverlayMonitor.unref();
}

function stopArenaChoiceOverlayMonitor() {
  arenaChoiceOverlayGeneration += 1;
  if (arenaChoiceOverlayMonitor) {
    clearInterval(arenaChoiceOverlayMonitor);
    arenaChoiceOverlayMonitor = undefined;
  }
  releaseTransientWindow(arenaChoiceOverlayWindow);
}

async function refreshArenaChoiceOverlayWindow() {
  if (arenaChoiceOverlayRefreshInFlight) {
    return;
  }

  const generation = arenaChoiceOverlayGeneration;
  arenaChoiceOverlayRefreshInFlight = true;
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) {
      releaseTransientWindow(arenaChoiceOverlayWindow);
      return;
    }
    const frontmostAppName = await getFrontmostAppName();
    if (
      generation !== arenaChoiceOverlayGeneration ||
      !trackerSettings.overlay.enabled
    ) return;
    const arena = tracker.getState().arena;
    const shouldShow = shouldShowArenaChoiceOverlay(
      arena,
      frontmostAppName,
      isAuxiliaryOverlayInteractionActive()
    );
    if (!shouldShow) {
      releaseTransientWindow(arenaChoiceOverlayWindow);
      return;
    }

    let window: BrowserWindow;
    try {
      window = await createArenaChoiceOverlayWindow();
    } catch (error) {
      if (generation !== arenaChoiceOverlayGeneration) return;
      throw error;
    }
    if (
      generation !== arenaChoiceOverlayGeneration ||
      !trackerSettings.overlay.enabled
    ) {
      if (!window.isDestroyed()) window.close();
      return;
    }
    if (!window.isDestroyed()) {
      window.setBounds(getArenaChoiceOverlayBounds());
      window.showInactive();
    }
  } finally {
    arenaChoiceOverlayRefreshInFlight = false;
  }
}

function getArenaChoiceOverlayBounds() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.bounds;
  const overlayWidth = Math.max(660, Math.round(width * 0.51));

  return {
    x: x + Math.round(width * 0.15),
    y: y + Math.round(height * 0.58),
    width: overlayWidth,
    height: 62
  };
}

function startArenaHeroRankingMonitor() {
  if (arenaHeroRankingMonitor) return;
  arenaHeroRankingMonitor = setInterval(() => {
    void refreshArenaHeroRankingWindow();
  }, 250);
  arenaHeroRankingMonitor.unref();
  void refreshArenaHeroRankingWindow();
}

function stopArenaHeroRankingMonitor() {
  arenaHeroRankingGeneration += 1;
  if (arenaHeroRankingMonitor) {
    clearInterval(arenaHeroRankingMonitor);
    arenaHeroRankingMonitor = undefined;
  }
  releaseTransientWindow(arenaHeroRankingWindow);
}

async function refreshArenaHeroRankingWindow() {
  if (arenaHeroRankingRefreshInFlight ||
      !trackerSettings.overlay.enabled ||
      !trackerSettings.overlay.arenaHeroWinRateRanking) return;
  arenaHeroRankingRefreshInFlight = true;
  const generation = arenaHeroRankingGeneration;
  try {
    const arena = tracker.getState().arena;
    const frontmostAppName = await getFrontmostAppName();
    if (
      generation !== arenaHeroRankingGeneration ||
      !trackerSettings.overlay.enabled ||
      !trackerSettings.overlay.arenaHeroWinRateRanking
    ) return;
    if (!arena || arena.status === "inactive") arenaHeroRankingSuppressed = false;
    const rankingWindowFocused = Boolean(
      arenaHeroRankingWindow &&
      !arenaHeroRankingWindow.isDestroyed() &&
      arenaHeroRankingWindow.isFocused()
    );
    const shouldShow =
      tracker.getState().status === "watching" &&
      Boolean(arena && arena.status !== "inactive") &&
      !arenaHeroRankingSuppressed &&
      (
        isOverlayFrontmostAllowed(
          frontmostAppName,
          overlaySettingsPreviewWindows.arenaHeroRanking
        ) ||
        rankingWindowFocused ||
        isArenaHeroRankingInteractionActive() ||
        isAuxiliaryOverlayInteractionActive()
      );
    if (!shouldShow) {
      releaseTransientWindow(arenaHeroRankingWindow);
      return;
    }
    let window: BrowserWindow;
    try {
      window = await createArenaHeroRankingWindow();
    } catch (error) {
      if (generation !== arenaHeroRankingGeneration) return;
      throw error;
    }
    if (
      generation !== arenaHeroRankingGeneration ||
      !trackerSettings.overlay.enabled ||
      !trackerSettings.overlay.arenaHeroWinRateRanking
    ) {
      if (!window.isDestroyed()) window.close();
      return;
    }
    if (window.isDestroyed()) return;
    ensureArenaHeroRankingWindowVisible(window);
    window.showInactive();
    if (arenaHeroRankingDataWindow !== window) {
      arenaHeroRankingDataWindow = window;
      void refreshArenaHeroRankingData(window, generation);
    }
  } finally {
    arenaHeroRankingRefreshInFlight = false;
  }
}

async function createArenaHeroRankingWindow(options: { qaDemo?: boolean } = {}) {
  if (arenaHeroRankingWindow && !arenaHeroRankingWindow.isDestroyed()) return arenaHeroRankingWindow;
  const bounds = await loadArenaHeroRankingWindowBounds();
  const { width, height } = bounds;
  arenaHeroRankingWindow = new BrowserWindow({
    ...getOverlayWindowPlatformOptions(),
    ...bounds,
    minWidth: Math.min(100, width),
    minHeight: Math.min(200, height),
    title: "竞技场英雄胜率",
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: createSecureWebPreferences(path.join(__dirname, "preload.cjs"))
  });
  installQaConsoleErrorListener(arenaHeroRankingWindow);
  configureSecureNavigation(arenaHeroRankingWindow);
  arenaHeroRankingWindow.setAlwaysOnTop(true, "screen-saver");
  applyOverlayWindowAppearance();
  const createdWindow = arenaHeroRankingWindow;
  createdWindow.on("focus", markArenaHeroRankingInteraction);
  createdWindow.on("will-move", markArenaHeroRankingInteraction);
  createdWindow.on("will-resize", markArenaHeroRankingInteraction);
  createdWindow.on("move", () => {
    markArenaHeroRankingInteraction();
    scheduleArenaHeroRankingWindowBoundsSave(createdWindow);
  });
  createdWindow.on("resize", () => {
    markArenaHeroRankingInteraction();
    scheduleArenaHeroRankingWindowBoundsSave(createdWindow);
  });
  createdWindow.on("close", () => {
    clearArenaHeroRankingWindowBoundsSaveTimer();
    void saveArenaHeroRankingWindowBounds(createdWindow.getBounds());
  });
  createdWindow.on("closed", () => {
    if (arenaHeroRankingWindow === createdWindow) arenaHeroRankingWindow = undefined;
    if (arenaHeroRankingDataWindow === createdWindow) arenaHeroRankingDataWindow = undefined;
    arenaHeroRankingInteractionActiveUntil = 0;
  });

  const query = {
    "arena-hero-ranking-overlay": "1",
    ...(options.qaDemo ? { "qa-arena-hero-ranking": "1" } : {})
  };
  await loadRendererPage(createdWindow, query);
  return createdWindow;
}

async function refreshArenaHeroRankingData(window: BrowserWindow, generation: number): Promise<void> {
  try {
    const result = await arenaHeroStats.load();
    if (
      generation !== arenaHeroRankingGeneration ||
      !trackerSettings.overlay.enabled ||
      !trackerSettings.overlay.arenaHeroWinRateRanking ||
      arenaHeroRankingWindow !== window ||
      window.isDestroyed()
    ) return;
    window.webContents.send("tracker:arena-hero-win-rate-ranking:update", result);
  } catch (error) {
    if (generation === arenaHeroRankingGeneration) {
      reportDiagnosticError("刷新竞技场英雄胜率失败", error);
    }
  }
}

function markArenaHeroRankingInteraction(): void {
  arenaHeroRankingInteractionActiveUntil = Date.now() + arenaHeroRankingInteractionGraceMs;
}

function isArenaHeroRankingInteractionActive(): boolean {
  return Date.now() < arenaHeroRankingInteractionActiveUntil;
}

function normalizeArenaHeroRankingWindowBounds(value: unknown) {
  const fallback = getDefaultArenaHeroRankingWindowBounds(
    screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  );
  const normalized = normalizeOverlayWindowBounds(
    value,
    screen.getAllDisplays().map((display) => display.workArea),
    {
      defaultBounds: fallback,
      minWidth: 100,
      minHeight: 200
    }
  );
  if (normalized.x === undefined || normalized.y === undefined) return fallback;
  return {
    x: normalized.x,
    y: normalized.y,
    width: normalized.width,
    height: normalized.height
  };
}

async function loadArenaHeroRankingWindowBounds() {
  const raw = await fs.readFile(getArenaHeroRankingWindowBoundsPath(), "utf8").catch(() => undefined);
  if (!raw) return normalizeArenaHeroRankingWindowBounds(undefined);
  try {
    return normalizeArenaHeroRankingWindowBounds(JSON.parse(raw));
  } catch {
    return normalizeArenaHeroRankingWindowBounds(undefined);
  }
}

function ensureArenaHeroRankingWindowVisible(window: BrowserWindow): void {
  const current = window.getBounds();
  const normalized = normalizeArenaHeroRankingWindowBounds(current);
  if (current.x !== normalized.x || current.y !== normalized.y ||
      current.width !== normalized.width || current.height !== normalized.height) {
    window.setBounds(normalized, false);
  }
}

function scheduleArenaHeroRankingWindowBoundsSave(window: BrowserWindow): void {
  clearArenaHeroRankingWindowBoundsSaveTimer();
  arenaHeroRankingBoundsSaveTimer = setTimeout(() => {
    arenaHeroRankingBoundsSaveTimer = undefined;
    if (!window.isDestroyed()) void saveArenaHeroRankingWindowBounds(window.getBounds());
  }, 250);
  arenaHeroRankingBoundsSaveTimer.unref();
}

function clearArenaHeroRankingWindowBoundsSaveTimer(): void {
  if (!arenaHeroRankingBoundsSaveTimer) return;
  clearTimeout(arenaHeroRankingBoundsSaveTimer);
  arenaHeroRankingBoundsSaveTimer = undefined;
}

function saveArenaHeroRankingWindowBounds(bounds: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}): Promise<void> {
  arenaHeroRankingBoundsWriteQueue = arenaHeroRankingBoundsWriteQueue.then(async () => {
    const filePath = getArenaHeroRankingWindowBoundsPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(bounds)}\n`, "utf8");
  }).catch((error) => {
    reportDiagnosticError("保存竞技场英雄胜率窗口位置失败", error);
  });
  return arenaHeroRankingBoundsWriteQueue;
}

function getArenaHeroRankingWindowBoundsPath(): string {
  return path.join(app.getPath("userData"), "arena-hero-ranking-window-bounds.json");
}

function getQaWindowInspection(window: BrowserWindow | undefined, collapsed: boolean) {
  if (!window || window.isDestroyed()) return null;
  return {
    bounds: roundBounds(window.getBounds()),
    collapsed,
    visible: window.isVisible()
  };
}

function getQaThreeWindowLayoutInspection() {
  if (process.env.QA_OPEN_THREE_WINDOW_LAYOUT !== "1") return undefined;
  const hero = getQaWindowInspection(arenaHeroRankingWindow, false);
  const opponent = getQaWindowInspection(
    opponentOverlayWindow,
    opponentOverlayWindowState?.isCollapsed() ?? false
  );
  const friendly = getQaWindowInspection(overlayWindow, false);
  const referenceBounds = friendly?.bounds ?? opponent?.bounds ?? hero?.bounds;
  return {
    workArea: referenceBounds
      ? roundBounds(screen.getDisplayMatching(referenceBounds).workArea)
      : null,
    hero,
    opponent,
    friendly
  };
}

async function captureQaScreenshotIfRequested(window: BrowserWindow) {
  const screenshotPath = process.env.QA_SCREENSHOT_PATH;
  const inspectPath = process.env.QA_INSPECT_PATH;
  let qaSettingsInteractionChecks: Array<Record<string, unknown>> | undefined;
  if (!screenshotPath && !inspectPath) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 1200));

  const qaMainWindowState = process.env.QA_MAIN_WINDOW_STATE;
  if (qaMainWindowState === "maximized") {
    window.maximize();
    await new Promise((resolve) => setTimeout(resolve, 500));
  } else if (qaMainWindowState === "fullscreen") {
    window.setFullScreen(true);
    await new Promise<void>((resolve) => {
      if (window.isFullScreen()) {
        resolve();
        return;
      }
      const timeout = setTimeout(resolve, 2_500);
      window.once("enter-full-screen", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  if (shouldUseQaAccessoryActivationPolicy(process.env, process.platform)) {
    await hideQaDockAfterLaunch(app.dock);
  }

  if (process.env.QA_DECK_TEXT) {
    await tracker.importDeck(process.env.QA_DECK_TEXT);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  if (process.env.QA_START_TRACKING === "1") {
    await window.webContents.executeJavaScript(`window.hearthstoneTracker?.start?.().then(() => undefined)`);
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  const qaMainView = process.env.QA_MAIN_VIEW;
  if (qaMainView) {
    await window.webContents.executeJavaScript(`
      (document.querySelector(${JSON.stringify(`[aria-label="${qaMainView}"]`)}) ??
        Array.from(document.querySelectorAll("button"))
          .find((button) => button.textContent?.trim() === ${JSON.stringify(qaMainView)}))
        ?.click();
    `);
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  const qaClickTexts = process.env.QA_CLICK_TEXTS
    ?.split("|")
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
  for (const buttonText of qaClickTexts) {
    await window.webContents.executeJavaScript(`
      Array.from(document.querySelectorAll("button"))
        .find((button) => {
          const text = button.textContent?.trim();
          return text === ${JSON.stringify(buttonText)} || text?.startsWith(${JSON.stringify(`${buttonText} (`)});
        })
        ?.click();
    `);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (process.env.QA_OPEN_IMPORT_MODAL === "1" || process.env.QA_SCAN_COLLECTION === "1") {
    await window.webContents.executeJavaScript(`
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("手动导入") || button.textContent?.includes("导入卡组") || button.textContent?.includes("卡组工具"))
        ?.click();
    `);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  if (process.env.QA_SCAN_COLLECTION === "1") {
    await window.webContents.executeJavaScript(`
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("从收藏读取"))
        ?.click();
    `);
    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  if (process.env.QA_OPEN_CARD_LIBRARY === "1") {
    await window.webContents.executeJavaScript(`
      document.querySelector('[aria-label="打开二级工作台"]')?.click();
    `);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await window.webContents.executeJavaScript(`
      document.querySelector('[aria-label="打开卡牌资料"], [aria-label="打开卡牌数据库"]')?.click();
    `);
    await new Promise((resolve) => setTimeout(resolve, 1400));
  }

  if (process.env.QA_OPEN_SETTINGS === "1") {
    await window.webContents.executeJavaScript(`
      document.querySelector('[aria-label="打开二级工作台"]')?.click();
    `);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const settingsSection = process.env.QA_SETTINGS_SECTION;
    if (settingsSection) {
      await window.webContents.executeJavaScript(`
        Array.from(document.querySelectorAll("button"))
          .find((button) => button.getAttribute("aria-label") === ${JSON.stringify(settingsSection)}
            || button.textContent?.trim() === ${JSON.stringify(settingsSection)})
          ?.click();
      `);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const toggleLabel = process.env.QA_TOGGLE_SETTING_LABEL;
    if (toggleLabel) {
      await window.webContents.executeJavaScript(`
        Array.from(document.querySelectorAll('[role="switch"]'))
          .find((button) => button.getAttribute("aria-label")?.startsWith(${JSON.stringify(toggleLabel)}))
          ?.click();
      `);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const toggleLabels = (process.env.QA_TOGGLE_SETTING_LABELS ?? "")
      .split("|")
      .map((label) => label.trim())
      .filter(Boolean);
    if (toggleLabels.length > 0) {
      window.show();
      window.focus();
      await new Promise((resolve) => setTimeout(resolve, 200));
      const initialBounds = roundBounds(window.getBounds());
      const initialMaximized = window.isMaximized();
      const initialFullScreen = window.isFullScreen();
      const initialWindowId = window.id;
      qaSettingsInteractionChecks = [];
      for (const label of toggleLabels) {
        const clicked = await window.webContents.executeJavaScript(`
          (() => {
            const control = Array.from(document.querySelectorAll('[role="switch"]'))
              .find((button) => button.getAttribute("aria-label")?.startsWith(${JSON.stringify(label)}));
            if (!(control instanceof HTMLElement)) return false;
            control.click();
            return true;
          })()
        `) as boolean;
        await new Promise((resolve) => setTimeout(resolve, 600));
        const bounds = roundBounds(window.getBounds());
        qaSettingsInteractionChecks.push({
          label,
          clicked,
          visible: window.isVisible(),
          focused: window.isFocused(),
          minimized: window.isMinimized(),
          maximized: window.isMaximized(),
          fullScreen: window.isFullScreen(),
          windowId: window.id,
          bounds,
          boundsUnchanged: JSON.stringify(bounds) === JSON.stringify(initialBounds),
          maximizedUnchanged: window.isMaximized() === initialMaximized,
          fullScreenUnchanged: window.isFullScreen() === initialFullScreen,
          windowIdentityUnchanged: window.id === initialWindowId,
          frontmostAppName: await getFrontmostAppName(),
          visibleOverlayTitles: overlayWindows()
            .filter((candidate) => !candidate.isDestroyed() && candidate.isVisible())
            .map((candidate) => candidate.getTitle())
        });
      }
    }
  }

  const cardLibrarySearch = process.env.QA_CARD_LIBRARY_SEARCH;
  if (cardLibrarySearch) {
    await window.webContents.executeJavaScript(`
      (() => {
        const input = document.querySelector('[aria-label="搜索卡牌"]');
        if (!(input instanceof HTMLInputElement)) return;
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setValue?.call(input, ${JSON.stringify(cardLibrarySearch)});
        input.dispatchEvent(new Event("input", { bubbles: true }));
      })();
    `);
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  if (process.env.QA_SHOW_CARD_PREVIEW === "1") {
    const anchorRect = { left: 16, top: 72, right: 196, bottom: 112, width: 180, height: 40 };
    if (process.env.QA_KELTHUZAD_CARD_PREVIEW === "1") {
      const qaKelthuzadDetails = tracker.getState().opponentHand?.find(
        (card) => card.cardId?.toUpperCase() === "REV_514"
      )?.details;
      if (!qaKelthuzadDetails) {
        throw new Error("QA 克尔苏加德详情未从真实记牌状态生成");
      }
      await window.webContents.executeJavaScript(`
        window.hearthstoneTracker?.showCardPreview?.(${JSON.stringify({
          details: qaKelthuzadDetails,
          anchorRect
        })});
      `);
      await new Promise((resolve) => setTimeout(resolve, 700));
    } else if (process.env.QA_TIME_FINS_CARD_PREVIEW === "1") {
      await window.webContents.executeJavaScript(`
        window.hearthstoneTracker?.showCardPreview?.(${JSON.stringify({
          details: {
            dbfId: 120774,
            cardId: "TIME_706",
            name: "超时空鳍侠",
            manaCost: 2,
            cardType: "随从",
            text: "战吼：将你的手牌替换为你的起始手牌。在你的回合结束时换回。",
            isSpell: false,
            relatedCards: [],
            gameContextSections: [{
              key: "friendly-opening-hand",
              title: "我的起始手牌",
              emptyText: "本局起始手牌尚未识别",
              cards: [
                { dbfId: 200001, cardId: "START_A", name: "起手牌甲", manaCost: 1, cardType: "法术" },
                { dbfId: 200003, cardId: "START_C", name: "起手牌乙", manaCost: 3, cardType: "武器" },
                { dbfId: 200004, cardId: "START_D", name: "换入的起手牌", manaCost: 4, cardType: "法术" }
              ]
            }]
          },
          anchorRect
        })});
      `);
      await new Promise((resolve) => setTimeout(resolve, 700));
    } else {
      if (process.env.QA_CARD_PREVIEW_SEQUENCE === "1") {
      await window.webContents.executeJavaScript(`
        window.hearthstoneTracker?.showCardPreview?.(${JSON.stringify({
          details: {
            dbfId: 1,
            name: "测试短卡",
            manaCost: 1,
            cardType: "法术",
            cardTypeId: 5,
            text: "短文本。",
            isSpell: true,
            relatedCards: []
          },
          anchorRect
        })});
      `);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

      await window.webContents.executeJavaScript(`
      window.hearthstoneTracker?.showCardPreview?.(${JSON.stringify({
        details: {
          dbfId: 103270,
          cardId: "TOY_372",
          name: "匣中古神",
          manaCost: 7,
          cardType: "法术",
          cardTypeId: 5,
          text: "随机施放5个法术。",
          isSpell: true,
          relatedCards: [],
          cardPoolSections: [{
            key: "qa-random-spell-pool",
            title: "可能施放的法术",
            emptyText: "暂无候选",
            cards: Array.from({ length: 15 }, (_, index) => ({
              dbfId: 201 + index,
              cardId: `QA_POOL_${index + 1}`,
              name: `候选法术${index + 1}`,
              manaCost: (index % 10) + 1,
              cardType: "法术",
              text: `候选法术${index + 1}的说明。`
            }))
          }],
          cardOutcomeSections: [{
            key: "qa-yogg-five",
            title: "本次实际施放",
            emptyText: "暂无结果",
            cards: [
              ...Array.from({ length: 4 }, (_, index) => ({
                key: `qa-five-${index + 1}`,
                card: {
                  dbfId: 301 + index,
                  cardId: `QA_FIVE_${index + 1}`,
                  name: `五连结果${index + 1}`,
                  cardType: "法术"
                }
              })),
              {
                key: "qa-five-yogg",
                card: {
                  dbfId: 103270,
                  cardId: "TOY_372",
                  name: "匣中古神",
                  cardType: "法术"
                },
                children: [{
                  key: "qa-five-yogg-child",
                  card: {
                    dbfId: 399,
                    cardId: "QA_NESTED",
                    name: "嵌套结果",
                    cardType: "法术"
                  }
                }]
              }
            ]
          }, {
            key: "qa-yogg-ten",
            title: "双倍实际施放",
            emptyText: "暂无结果",
            cards: Array.from({ length: 10 }, (_, index) => ({
              key: `qa-ten-${index + 1}`,
              card: {
                dbfId: 401 + index,
                cardId: index < 2 ? "QA_DUPLICATE" : `QA_TEN_${index + 1}`,
                name: index < 2 ? "重复法术" : `双倍结果${index + 1}`,
                cardType: "法术"
              }
            }))
          }]
        },
        anchorRect
      })});
    `);
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }

  if (process.env.QA_HOVER_CARD === "1") {
    await window.webContents.executeJavaScript(`
      (() => {
        const targets = Array.from(document.querySelectorAll(".overlay-card-hover-target, .card-hover-target"));
        const target = targets.find((element) => element.textContent?.includes("银樽海韵"))
          ?? targets.find((element) => element.textContent?.includes("抱团"))
          ?? targets[0];
        if (target) {
          target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, view: window }));
          target.focus();
        }
      })();
    `);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const qaTrackingGroup = process.env.QA_OPEN_TRACKING_GROUP;
  if (qaTrackingGroup) {
    await window.webContents.executeJavaScript(`
      document.querySelector('[data-group-key="${qaTrackingGroup}"] > button')?.click();
    `);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  let qaPinnedPreviewInspection: Record<string, unknown> | undefined;
  if (process.env.QA_INLINE_PIN_KEYBOARD_EVENT === "KeyboardEvent") {
    await window.webContents.executeJavaScript(`
      window.dispatchEvent(new KeyboardEvent("keydown", {
        altKey: true,
        bubbles: true,
        code: "KeyQ",
        key: "q"
      }));
    `);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await window.webContents.executeJavaScript(`
      document.querySelector(".card-hover-preview .card-pool-section > summary")?.click();
    `);
    await new Promise((resolve) => setTimeout(resolve, 150));
    qaPinnedPreviewInspection = await inspectQaPreview(window);
    await window.webContents.executeJavaScript(`
      window.dispatchEvent(new KeyboardEvent("keydown", {
        altKey: true,
        bubbles: true,
        code: "KeyQ",
        key: "q"
      }));
      document.querySelector(".card-hover-target")?.dispatchEvent(
        new MouseEvent("mouseout", { bubbles: true, view: window })
      );
    `);
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  if (process.env.QA_PIN_CARD_PREVIEW === "1") {
    setCardPreviewPinned(true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (cardPreviewWindow && !cardPreviewWindow.isDestroyed()) {
      await cardPreviewWindow.webContents.executeJavaScript(`
        document.querySelector(".card-preview-window-shell .card-pool-section > summary")?.click();
      `);
      await new Promise((resolve) => setTimeout(resolve, 150));
      qaPinnedPreviewInspection = await inspectQaPreview(cardPreviewWindow);
    }
    setCardPreviewPinned(false);
    await window.webContents.executeJavaScript(`
      window.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true, view: window }));
    `);
    scheduleCardPreviewAutoHide();
    await new Promise((resolve) => setTimeout(resolve, cardPreviewAutoHideMs + 250));
  }

  if (process.env.QA_COPY_LADDER_DECK === "1") {
    await window.webContents.executeJavaScript(`document.querySelector('[aria-label="复制卡组代码"]')?.click()`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const waitAfterCardPreview = Number(process.env.QA_WAIT_AFTER_CARD_PREVIEW_MS);
  if (Number.isFinite(waitAfterCardPreview) && waitAfterCardPreview > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitAfterCardPreview));
  }

  await waitForQaRendererSettled((script) => window.webContents.executeJavaScript(script));
  if (process.env.QA_OPEN_OVERLAY === "1" || process.env.QA_OPEN_OPPONENT_OVERLAY === "1") {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const hasTrackingLayout = await window.webContents.executeJavaScript(
        `Boolean(document.querySelector(".card-tracking-main"))`
      ) as boolean;
      if (hasTrackingLayout) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  if (shouldUseQaAccessoryActivationPolicy(process.env, process.platform)) {
    await hideQaDockAfterLaunch(app.dock);
  }

  if (inspectPath) {
    const rendererInspection = await inspectQaRenderer(window);
    const finalInlinePreview = await inspectQaPreview(window);
    const externalPreview = cardPreviewWindow && !cardPreviewWindow.isDestroyed() && cardPreviewWindow.isVisible()
      ? await inspectQaPreview(cardPreviewWindow)
      : undefined;
    const bounds = roundBounds(window.getBounds());
    const displayWorkArea = roundBounds(screen.getDisplayMatching(bounds).workArea);
    const previewInspection = qaPinnedPreviewInspection
      ? {
          ...qaPinnedPreviewInspection,
          afterUnpinHidden: externalPreview === undefined && finalInlinePreview.visible !== true
        }
      : externalPreview ?? finalInlinePreview;
    const preview = {
      ...previewInspection,
      consoleErrorCount: cardPreviewWindow && !cardPreviewWindow.isDestroyed()
        ? getQaConsoleErrorCount(cardPreviewWindow)
        : getQaConsoleErrorCount(window)
    };
    const completeRendererInspection = {
      ...rendererInspection,
      trackerSettings: rendererInspection.trackerSettings ?? trackerSettings,
      qaDockVisible: process.platform === "darwin" ? app.dock?.isVisible() : undefined,
      qaMainWindowVisible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
      bounds,
      workArea: displayWorkArea,
      workAreas: screen.getAllDisplays().map((display) => roundBounds(display.workArea)),
      inheritedNodeEnvironmentKeys: Object.keys(process.env)
        .filter((key) => /^NODE_/.test(key))
        .sort(),
      settingsInteractionChecks: qaSettingsInteractionChecks,
      preview
    };
    const qaWindowLayout = getQaThreeWindowLayoutInspection();
    const inspection = qaWindowLayout
      ? { ...completeRendererInspection, qaWindowLayout }
      : completeRendererInspection;
    await fs.mkdir(path.dirname(inspectPath), { recursive: true });
    await fs.writeFile(inspectPath, `${JSON.stringify(inspection, null, 2)}\n`, "utf8");
  }

  if (screenshotPath) {
    const image = await window.capturePage();
    await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
    await fs.writeFile(screenshotPath, image.toPNG());
  }

  const cardPreviewScreenshotPath = process.env.QA_CARD_PREVIEW_SCREENSHOT_PATH;
  if (cardPreviewScreenshotPath && cardPreviewWindow && !cardPreviewWindow.isDestroyed() && cardPreviewWindow.isVisible()) {
    const image = await cardPreviewWindow.capturePage();
    await fs.mkdir(path.dirname(cardPreviewScreenshotPath), { recursive: true });
    await fs.writeFile(cardPreviewScreenshotPath, image.toPNG());
  }

  if (process.env.QA_EXIT_AFTER_SCREENSHOT === "1") {
    await requestQaQuit(() => app.quit());
  }
}

async function inspectQaRenderer(window: BrowserWindow): Promise<Record<string, unknown>> {
  const inspectJson = (await window.webContents.executeJavaScript(`(async () => {
    const rect = (element) => {
      if (!(element instanceof Element)) return null;
      const value = element.getBoundingClientRect();
      return {
        x: Math.round(value.x * 100) / 100,
        y: Math.round(value.y * 100) / 100,
        width: Math.round(value.width * 100) / 100,
        height: Math.round(value.height * 100) / 100,
        top: Math.round(value.top * 100) / 100,
        right: Math.round(value.right * 100) / 100,
        bottom: Math.round(value.bottom * 100) / 100,
        left: Math.round(value.left * 100) / 100
      };
    };
    const selectorFor = (element) => {
      if (element === document.documentElement) return "html";
      if (element === document.body) return "body";
      if (element.id) return "#" + CSS.escape(element.id);
      const classes = Array.from(element.classList).slice(0, 2).map((name) => "." + CSS.escape(name)).join("");
      return element.tagName.toLowerCase() + classes;
    };
    const shell = document.querySelector(".overlay-shell, .desktop-frame, .card-preview-window-shell");
    const main = document.querySelector(".card-tracking-main");
    const footer = document.querySelector(".card-tracking-footer");
    const tracking = document.querySelector(".card-tracking-layout");
    const visibleRows = Array.from(document.querySelectorAll(
      ".overlay-compact-card-row, .overlay-undisclosed-row, .opponent-secret-slot"
    )).filter((element) => {
      const style = getComputedStyle(element);
      const value = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && value.width > 0 && value.height > 0;
    });
    const visibleOpponentUsedArtwork = Array.from(document.querySelectorAll(
      '[data-group-key="used"] .overlay-history-card-row .overlay-card-art-image'
    )).filter((element) => {
      const style = getComputedStyle(element);
      const value = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && value.width > 0 && value.height > 0;
    });
    const arenaChoiceMetrics = Array.from(document.querySelectorAll(".arena-choice-overlay-metrics"))
      .map((element) => ({
        rect: rect(element),
        gridTemplateColumns: getComputedStyle(element).gridTemplateColumns,
        gridTemplateRows: getComputedStyle(element).gridTemplateRows,
        items: Array.from(element.querySelectorAll(":scope > .arena-choice-overlay-metric")).map(rect)
      }));
    const allElements = [document.documentElement, document.body, ...document.querySelectorAll("*")];
    const actualScrollableSelectors = [...new Set(allElements.filter((element) => {
      const style = getComputedStyle(element);
      return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
    }).map(selectorFor))];
    const size = (element) => element ? {
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight
    } : null;
    const unknownHandRows = Array.from(document.querySelectorAll(".overlay-undisclosed-row"))
      .map((element) => element.textContent?.trim() ?? "");
    return JSON.stringify({
      hasApi: Boolean(window.hearthstoneTracker),
      location: window.location.href,
      appliedTheme: document.documentElement.dataset.trackerTheme ?? null,
      bodyComputed: {
        backgroundColor: getComputedStyle(document.body).backgroundColor,
        color: getComputedStyle(document.body).color
      },
      bodyText: document.body.innerText.slice(0, 2000),
      trackerState: await window.hearthstoneTracker?.getState?.(),
      trackerSettings: await window.hearthstoneTracker?.getTrackerSettings?.(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      layoutMode: tracking?.getAttribute("data-layout-mode") ?? null,
      page: tracking?.getAttribute("data-tracking-page") ?? null,
      expandedKeys: Array.from(document.querySelectorAll('[data-group-key][data-expanded="true"]'))
        .map((element) => element.getAttribute("data-group-key")),
      shellRect: rect(shell),
      shellComputed: shell ? {
        backgroundColor: getComputedStyle(shell).backgroundColor,
        color: getComputedStyle(shell).color,
        height: getComputedStyle(shell).height,
        minHeight: getComputedStyle(shell).minHeight,
        gridTemplateRows: getComputedStyle(shell).gridTemplateRows
      } : null,
      mainRect: rect(main),
      footerRect: rect(footer),
      visibleCardRowRects: visibleRows.map(rect),
      visibleOpponentUsedArtworkRects: visibleOpponentUsedArtwork.map(rect),
      arenaChoiceMetrics,
      shellScrollSize: size(shell),
      mainScrollSize: size(main),
      designatedScrollOwners: Array.from(document.querySelectorAll("[data-scroll-owner]"))
        .map((element) => element.getAttribute("data-scroll-owner")),
      actualScrollableSelectors,
      horizontalOverflowSelectors: [...new Set(allElements
        .filter((element) => element.scrollWidth > element.clientWidth)
        .map(selectorFor))],
      unknownHandRows,
      clipboardText: ${JSON.stringify(process.env.QA_COPY_LADDER_DECK === "1" ? clipboard.readText() : "")}
    });
  })()`)) as string;
  return {
    ...(JSON.parse(inspectJson) as Record<string, unknown>),
    consoleErrorCount: getQaConsoleErrorCount(window)
  };
}

async function inspectQaPreview(window: BrowserWindow): Promise<Record<string, unknown>> {
  if (window.isDestroyed()) return { visible: false };
  const inspectJson = (await window.webContents.executeJavaScript(`(() => {
    const root = document.querySelector(".card-hover-preview, .card-preview-window-shell");
    if (!(root instanceof HTMLElement) || root.getBoundingClientRect().width <= 0) {
      return JSON.stringify({ visible: false });
    }
    const pool = root.querySelector(".card-pool-section");
    const outcomeSections = Array.from(root.querySelectorAll(".card-outcome-section")).map((section) => ({
      title: section.querySelector(":scope > span")?.textContent?.trim() ?? "",
      outcomeRows: section.querySelectorAll(":scope > .card-outcome-tree > .card-outcome-node").length
    }));
    const allElements = [root, ...root.querySelectorAll("*")];
    const outcomeElements = Array.from(root.querySelectorAll(".card-outcome-section *"));
    const isActuallyScrollable = (element) => {
      const style = getComputedStyle(element);
      return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
    };
    const actualScrollableSelectors = [...new Set(allElements.filter((element) => {
      const style = getComputedStyle(element);
      return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
    }).map((element) => {
      if (element === root) return ".card-preview-root";
      const classes = Array.from(element.classList).slice(0, 2).join(".");
      return classes ? "." + classes : element.tagName.toLowerCase();
    }))];
    return JSON.stringify({
      visible: true,
      pinned: root.getAttribute("data-pinned") === "true" ||
        root.getAttribute("data-preview-pinned") === "true" ||
        root.classList.contains("is-pinned"),
      poolExpanded: pool instanceof HTMLDetailsElement ? pool.open : false,
      poolRows: pool instanceof HTMLDetailsElement && pool.open
        ? pool.querySelectorAll(".card-related-card").length
        : 0,
      continueButton: pool instanceof HTMLDetailsElement && pool.open &&
        Boolean(pool.querySelector(".card-pool-load-more")),
      outcomeRows: outcomeSections.map((section) => section.outcomeRows),
      outcomeSections,
      duplicateSpellCount: Array.from(root.querySelectorAll(".card-outcome-node strong"))
        .filter((element) => element.textContent?.trim() === "重复法术").length,
      nestedOutcomeGroups: root.querySelectorAll(".card-outcome-children").length,
      designatedScrollOwners: Array.from(root.querySelectorAll("[data-scroll-owner]"))
        .map((element) => element.getAttribute("data-scroll-owner")),
      actualScrollableSelectors,
      resultScrollableSelectors: [...new Set(outcomeElements.filter(isActuallyScrollable).map((element) => {
        const classes = Array.from(element.classList).slice(0, 2).join(".");
        return classes ? "." + classes : element.tagName.toLowerCase();
      }))],
      scrollSize: {
        scrollWidth: root.scrollWidth,
        scrollHeight: root.scrollHeight,
        clientWidth: root.clientWidth,
        clientHeight: root.clientHeight
      },
      text: root.textContent?.replace(/\\s+/g, " ").trim() ?? ""
    });
  })()`)) as string;
  return {
    ...(JSON.parse(inspectJson) as Record<string, unknown>),
    consoleErrorCount: getQaConsoleErrorCount(window)
  };
}
