import { BrowserWindow } from "electron";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { ArenaDraftEngine } from "../shared/arenaDraftEngine.js";
import { toFirestoneClassSlug } from "../shared/arenaRatings.js";
import { TrackerEngine } from "../shared/trackerEngine.js";
import type { CollectionDeck, CollectionDeckScanResult, MatchMode, MatchRecord, PublicTrackerState, TrackerMode } from "../shared/types.js";
import { CardDataService } from "./cardDataService.js";
import { ArenaRatingService } from "./arenaRatingService.js";
import { parsePlayerLog } from "./logParsers.js";
import { resolveBestLogTarget } from "./logDiscovery.js";
import { ArenaScreenRecognizer, selectArenaChoiceTexts, type ArenaScreenRecognitionOptions, type ArenaScreenRecognitionResult } from "./arenaScreenRecognition.js";
import { inspectConstructedDeckScreen } from "./constructedScreenRecognition.js";
import { shouldRecognizeConstructedDeckScreen } from "./constructedRecognitionPolicy.js";
import {
  detectPowerGameType,
  inspectFriendlyDeckSnapshot,
  isConstructedGameStartLine,
  isGameEndLine,
  parseMatchResultLine,
  selectCurrentPowerGameText
} from "../shared/powerLogParser.js";
import { selectCurrentArenaLogText } from "../shared/arenaLogParser.js";
import { MatchHistoryStore } from "./matchHistoryStore.js";
import {
  bindSessionContext,
  createSessionContext,
  createSessionKey,
  hasSessionKey,
  sessionOwnsLogPath,
  type SessionContext,
  type SessionKey
} from "./trackerSession.js";

interface CollectionDeckScanner {
  scanAndImportDecks(options?: { logPath?: string }): Promise<CollectionDeckScanResult>;
}

interface ArenaScreenRecognizerLike {
  recognize(options?: ArenaScreenRecognitionOptions): Promise<ArenaScreenRecognitionResult>;
}

interface PendingExactArenaDeck {
  readonly sessionKey: SessionKey;
  readonly deck: CollectionDeck;
  readonly arenaDeckId: string;
  readonly redraftGenerationId: string;
}

interface LogFileFingerprint {
  readonly device: number;
  readonly inode: number;
  readonly sampleLength: number;
  readonly sampleHash: string;
}

interface ExactArenaDeckObservation {
  readonly sessionKey: SessionKey;
  readonly deck: CollectionDeck;
  readonly eventAtMs: number;
}

interface ArenaRatingsRequest {
  readonly id: number;
  readonly sessionKey: SessionKey;
  readonly className: string;
  readonly promise: Promise<void>;
}

export class TrackerService {
  private engine = new TrackerEngine();
  private arena = new ArenaDraftEngine();
  private cardData = new CardDataService();
  private arenaRatings = new ArenaRatingService();
  private watcher: FSWatcher | undefined;
  private offsets = new Map<string, number>();
  private pendingLogBytes = new Map<string, Buffer>();
  private logFileFingerprints = new Map<string, LogFileFingerprint>();
  private logReadQueues = new Map<string, Promise<void>>();
  private orderedLogReadQueue: Promise<void> = Promise.resolve();
  private logReadRetryTimers = new Map<string, NodeJS.Timeout>();
  private arenaRatingsRequestSequence = 0;
  private arenaRatingsRequest: ArenaRatingsRequest | undefined;
  private arenaRatingsLoadedAt = new Map<string, number>();
  private lastArenaDeckSignature: string | undefined;
  private latestArenaDeckEventAtMs: number | undefined;
  private waitingForFirstPowerLog = false;
  private sessionRefreshTimer: NodeJS.Timeout | undefined;
  private sessionRefreshKey: SessionKey | undefined;
  private arenaScreenRecognitionTimer: NodeJS.Timeout | undefined;
  private arenaScreenRecognitionInFlight = false;
  private arenaScreenRecognitionSettled: Promise<void> = Promise.resolve();
  private arenaScreenRecognitionError: string | undefined;
  private knownCollectionDecks: CollectionDeck[] = [];
  private pendingExactArenaDeck: PendingExactArenaDeck | undefined;
  private latestExactArenaDeckObservation: ExactArenaDeckObservation | undefined;
  private constructedScreenMode: "standard" | "wild" | undefined;
  private collectionDeckPreviewSource: "decks-log" | "screen" | undefined;
  private activeTrackerMode: TrackerMode | undefined;
  private pendingPowerGameText = "";
  private activeArenaGame = false;
  private pendingArenaExitDeckKey: string | undefined;
  private pendingArenaExitConfirmations = 0;
  private lastPublishedStateSignature: string | undefined;
  private sessionSequence = 0;
  private sessionContext = createSessionContext(createSessionKey(0));
  private windows = new Set<BrowserWindow>();
  private activeMatchId: string | undefined;
  private activeMatchDeckName: string | undefined;
  private activeMatchMode: MatchMode = "unknown";
  private playerLogFriendlyController: number | undefined;
  private powerGameExplicitLocalPlayerIds = new Set<number>();
  private powerGamePlayerNames = new Map<number, string>();
  private powerGameStartTimestamp: string | undefined;
  private recordedMatchIds = new Set<string>();
  private pendingMatchIds = new Set<string>();
  private matchHistoryWriteErrors = new Map<string, string>();
  private matchHistoryWrites: Promise<void> = Promise.resolve();
  private disposing = false;
  private disposePromise: Promise<void> | undefined;

  constructor(
    private readonly collectionDecks?: CollectionDeckScanner,
    private readonly arenaScreenRecognizer: ArenaScreenRecognizerLike = new ArenaScreenRecognizer(),
    private readonly matchHistory = new MatchHistoryStore()
  ) {}

  private get activeLogPath() {
    return this.sessionContext.activeLogPath;
  }

  private get arenaLogPath() {
    return this.sessionContext.arenaLogPath;
  }

  private get decksLogPath() {
    return this.sessionContext.decksLogPath;
  }

  private get playerLogPath() {
    return this.sessionContext.playerLogPath;
  }

  attachWindow(window: BrowserWindow) {
    this.windows.add(window);
    window.on("closed", () => {
      this.windows.delete(window);
    });
  }

  getState(): PublicTrackerState {
    const state = this.engine.getState();
    return {
      ...state,
      arenaLogPath: this.arenaLogPath,
      constructedScreenMode: this.constructedScreenMode,
      trackerMode: this.resolveTrackerMode(state),
      arena: this.arena.getState()
    };
  }

  async getMatchHistory() {
    await this.matchHistoryWrites;
    const writeError = this.matchHistoryWriteErrors.values().next().value;
    if (writeError) {
      return { status: "error" as const, error: `写入对局历史失败：${writeError}` };
    }
    return this.matchHistory.getHistory();
  }

  setMatchHistoryRetentionDays(days: 30 | 90 | 180): void {
    this.matchHistory.setRetentionDays(days);
  }

  async importDeck(deckText: string) {
    await this.importDeckIntoEngine(deckText);
    this.pushState();
    return this.getState();
  }

  setCollectionDecks(decks: readonly CollectionDeck[]) {
    this.knownCollectionDecks = decks.map((deck) => ({ ...deck, cards: deck.cards.map((card) => ({ ...card })) }));
    this.engine.setCollectionDecks(decks);
    this.pushState();
  }

  activateCollectionDeck(deckId: string) {
    this.engine.activateCollectionDeck(deckId);
    this.pushState();
    return this.getState();
  }

  async start(options: { logPath?: string; deckText?: string } = {}) {
    let sessionContext = this.beginSession();
    if (options.deckText) {
      await this.importDeckIntoEngine(options.deckText, sessionContext);
      if (!this.isCurrentSession(sessionContext)) {
        return this.getState();
      }
    }

    const session = await resolveBestLogTarget(options.logPath);
    if (!this.isCurrentSession(sessionContext)) {
      return this.getState();
    }
    const logPath = session?.powerLogPath ?? session?.playerLogPath ?? session?.arenaLogPath ?? session?.decksLogPath ?? session?.loadingScreenLogPath;
    if (!session || !logPath) {
      await this.stopWatcherOnly();
      if (!this.isCurrentSession(sessionContext)) {
        return this.getState();
      }
      this.engine.resetAfterGame();
      this.arena.reset();
      this.engine.setStatus("missing-log", undefined, "没有找到炉石日志。请启动炉石，或手动选择 Logs 目录。");
      this.startSessionRefresh(sessionContext);
      this.pushState();
      return this.getState();
    }

    const usableArenaLog = await hasUsableArenaLog(session?.arenaLogPath);
    const loadingScreenMode = !session?.powerLogPath && !usableArenaLog
      ? await readLatestLoadingScreenMode(session?.loadingScreenLogPath)
      : undefined;
    if (!this.isCurrentSession(sessionContext)) {
      return this.getState();
    }
    const isWaitingForFirstPowerLog = loadingScreenMode !== "GAMEPLAY";
    if (
      !session?.powerLogPath &&
      !usableArenaLog &&
      (!session?.playerLogPath || loadingScreenMode !== undefined)
    ) {
      sessionContext = this.bindResolvedSession(sessionContext, session, logPath, {
        arenaLogPath: session?.arenaLogPath,
        decksLogPath: expectedDecksLogPath(session?.sessionDir, session?.decksLogPath),
        playerLogPath: undefined
      });
      await this.stopWatcherOnly();
      if (!this.isCurrentSession(sessionContext)) {
        return this.getState();
      }
      this.engine.resetAfterGame();
      this.arena.reset();
      this.waitingForFirstPowerLog = isWaitingForFirstPowerLog;
      this.engine.setStatus(
        isWaitingForFirstPowerLog ? "watching" : "missing-log",
        logPath,
        loadingScreenMode === "GAMEPLAY"
          ? buildMissingPowerLogMessage(logPath)
          : buildWaitingForGameMessage()
      );
      await this.loadCardDatabaseIntoEngine(sessionContext);
      if (!this.isCurrentSession(sessionContext)) {
        return this.getState();
      }
      await this.refreshCollectionDecks(session?.decksLogPath ?? logPath, sessionContext);
      if (!this.isCurrentSession(sessionContext)) {
        return this.getState();
      }
      this.startSessionRefresh(sessionContext);
      this.startArenaScreenRecognition(sessionContext);
      await this.refreshArenaScreenChoices(sessionContext);
      if (!this.isCurrentSession(sessionContext)) {
        return this.getState();
      }
      this.pushState();
      return this.getState();
    }

    const arenaLogPath = session?.arenaLogPath ?? (session?.powerLogPath ? path.join(path.dirname(session.powerLogPath), "Arena.log") : undefined);
    sessionContext = this.bindResolvedSession(sessionContext, session, logPath, {
      arenaLogPath,
      decksLogPath: expectedDecksLogPath(session?.sessionDir, session?.decksLogPath),
      playerLogPath: session?.playerLogPath
    });

    if (path.basename(logPath).toLowerCase() === "player.log") {
      await this.stopWatcherOnly();
      if (!this.isCurrentSession(sessionContext)) {
        return this.getState();
      }
      this.engine.resetAfterGame();
      this.arena.reset();
      this.engine.setStatus("error", logPath, buildPowerLogRequiredMessage(logPath));
      this.pushState();
      return this.getState();
    }

    const collectionDeckSourcePath = session?.powerLogPath ?? session?.decksLogPath ?? session?.arenaLogPath ?? logPath;
    const selectedCollectionDeck = collectionDeckSourcePath
      ? await this.refreshCollectionDecks(collectionDeckSourcePath, sessionContext)
      : undefined;
    if (!this.isCurrentSession(sessionContext)) {
      return this.getState();
    }

    await this.loadCardDatabaseIntoEngine(sessionContext);
    if (!this.isCurrentSession(sessionContext)) {
      return this.getState();
    }
    const playerContent = session?.playerLogPath ? await fs.readFile(session.playerLogPath, "utf8").catch(() => "") : "";
    if (!this.isCurrentSession(sessionContext)) {
      return this.getState();
    }
    this.lastArenaDeckSignature = undefined;
    this.arena.reset();
    this.arena.setPreferArenaLogPicks(Boolean(session?.arenaLogPath));
    await this.stopWatcherOnly();
    if (!this.isCurrentSession(sessionContext)) {
      return this.getState();
    }
    this.engine.setStatus("watching", logPath);
    const arenaContent = arenaLogPath ? await fs.readFile(arenaLogPath, "utf8").catch(() => "") : "";
    if (!this.isCurrentSession(sessionContext)) {
      return this.getState();
    }
    const currentArenaText = selectCurrentArenaLogText(arenaContent);
    this.arena.applyArenaText(currentArenaText);
    await this.applyInitialExactArenaDeck(selectedCollectionDeck, arenaLogPath, sessionContext);
    if (!this.isCurrentSession(sessionContext)) {
      return this.getState();
    }
    // Power replay must see the Arena deck first; otherwise a cold start can
    // record the opening hand and then erase its counts when the deck is synced.
    this.syncArenaDeckToTracker();
    if (arenaLogPath) {
      this.offsets.set(arenaLogPath, Buffer.byteLength(arenaContent));
      const arenaStat = await fs.stat(arenaLogPath).catch(() => undefined);
      if (!this.isCurrentSession(sessionContext)) {
        return this.getState();
      }
      if (arenaStat) {
        this.latestArenaDeckEventAtMs = resolveLatestLogEventAt(
          currentArenaText,
          arenaStat.mtimeMs,
          isArenaDeckStateLine
        );
        this.logFileFingerprints.set(
          arenaLogPath,
          createLogFileFingerprint(Buffer.from(arenaContent), arenaStat)
        );
      }
    }

    if (session?.powerLogPath) {
      const contentBuffer = await fs.readFile(session.powerLogPath).catch(() => Buffer.alloc(0));
      if (!this.isCurrentSession(sessionContext)) {
        return this.getState();
      }
      const powerStat = await fs.stat(session.powerLogPath).catch(() => undefined);
      if (!this.isCurrentSession(sessionContext)) {
        return this.getState();
      }
      const content = contentBuffer.toString("utf8");
      this.playerLogFriendlyController = findFriendlyPlayerId(playerContent);
      this.updateFriendlyControllerFromPowerText(content);
      this.applyPowerText(
        content,
        isArenaCollectionDeck(selectedCollectionDeck) ? undefined : selectedCollectionDeck,
        powerStat?.mtimeMs,
        true
      );
      this.offsets.set(session.powerLogPath, contentBuffer.length);
      if (this.playerLogPath && parsePlayerLog(playerContent).some((event) => event.type === "game-started")) {
        const playerStat = await fs.stat(this.playerLogPath).catch(() => undefined);
        if (!this.isCurrentSession(sessionContext)) {
          return this.getState();
        }
        if (playerStat && (!powerStat || playerStat.mtimeMs > powerStat.mtimeMs)) {
          this.markGameStartedWhilePowerLogStalled();
        }
      }
    }
    this.ensureArenaRatingsForCurrentArena(sessionContext);
    if (this.playerLogPath) {
      this.offsets.set(this.playerLogPath, Buffer.byteLength(playerContent));
    }
    if (session?.decksLogPath) {
      const decksStat = await fs.stat(session.decksLogPath).catch(() => undefined);
      if (!this.isCurrentSession(sessionContext)) {
        return this.getState();
      }
      if (decksStat) {
        this.offsets.set(session.decksLogPath, decksStat.size);
      }
    }
    this.syncArenaDeckToTracker();
    if (!session?.powerLogPath && selectedCollectionDeck && this.arena.getState().status === "inactive") {
      this.previewCollectionDeck(selectedCollectionDeck, "decks-log");
    }

    const watchedPaths = [logPath];
    if (arenaLogPath && !watchedPaths.includes(arenaLogPath)) {
      watchedPaths.push(arenaLogPath);
    }
    if (this.decksLogPath && !watchedPaths.includes(this.decksLogPath)) {
      watchedPaths.push(this.decksLogPath);
    }
    if (this.playerLogPath && !watchedPaths.includes(this.playerLogPath)) {
      watchedPaths.push(this.playerLogPath);
    }

    const trackedLogPaths = new Set(watchedPaths.map((watchedPath) => path.resolve(watchedPath)));
    const watchedTargets = [...watchedPaths];
    if (this.decksLogPath) {
      const sessionDir = path.dirname(this.decksLogPath);
      if (!watchedTargets.includes(sessionDir)) {
        watchedTargets.push(sessionDir);
      }
    }

    const watcher = chokidar.watch(watchedTargets, {
      ignoreInitial: false,
      depth: 0,
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 }
    });
    this.watcher = watcher;

    const watcherReady = new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };
      watcher.once("ready", settle);
      watcher.once("error", settle);
    });
    const enqueueTrackedLog = (candidatePath: string) => {
      const resolvedPath = path.resolve(candidatePath);
      if (trackedLogPaths.has(resolvedPath)) {
        this.enqueueLogRead(resolvedPath, sessionContext);
      }
    };
    watcher.on("change", (changedPath) => {
      enqueueTrackedLog(changedPath);
    });
    watcher.on("add", (addedPath) => {
      enqueueTrackedLog(addedPath);
    });
    watcher.on("error", (error) => {
      if (!this.isCurrentSession(sessionContext)) {
        return;
      }
      this.engine.setStatus("error", logPath, String(error));
      this.pushState();
    });

    await watcherReady;
    await this.waitForLogReadQueues();
    if (!this.isCurrentSession(sessionContext)) {
      return this.getState();
    }
    await this.reconcileExpectedDecksLog(sessionContext);
    if (!this.isCurrentSession(sessionContext)) {
      return this.getState();
    }

    this.startSessionRefresh(sessionContext);
    this.startArenaScreenRecognition(sessionContext);
    await this.refreshArenaScreenChoices(sessionContext);
    if (!this.isCurrentSession(sessionContext)) {
      return this.getState();
    }
    this.pushState();
    return this.getState();
  }

  async pause() {
    const sessionContext = this.beginSession();
    await this.stopWatcherOnly();
    if (!this.isCurrentSession(sessionContext)) {
      return this.getState();
    }
    this.engine.setStatus("paused", this.getState().logPath);
    this.pushState();
    return this.getState();
  }

  dispose() {
    this.disposePromise ??= this.finishDispose();
    return this.disposePromise;
  }

  private async finishDispose() {
    this.disposing = true;
    this.stopSessionRefresh();
    this.stopArenaScreenRecognition();
    await this.arenaScreenRecognitionSettled;
    await this.stopWatcherOnly();
    await this.waitForLogReadQueues();

    const sessionContext = this.sessionContext;
    const powerLogPath = isPowerLogPath(this.activeLogPath) ? this.activeLogPath : undefined;
    if (powerLogPath) {
      await this.readAppended(powerLogPath, sessionContext);
      await this.waitForLogReadQueues();
    }

    await this.matchHistoryWrites;
    this.beginSession();
  }

  private async readAppended(logPath: string, sessionContext: SessionContext) {
    if (!this.isCurrentSession(sessionContext) || !sessionOwnsLogPath(sessionContext, logPath)) {
      return;
    }

    try {
      const handle = await fs.open(logPath, "r");
      let offset: number;
      let buffer: Buffer;
      let modifiedAtMs: number;
      let wasTruncated = false;
      let replacementFingerprint: LogFileFingerprint | undefined;
      try {
        const stat = await handle.stat();
        if (!this.isCurrentSession(sessionContext)) {
          return;
        }
        offset = this.offsets.get(logPath) ?? 0;
        if (stat.size < offset) {
          wasTruncated = true;
          offset = 0;
        } else if (
          this.isArenaLog(logPath, sessionContext) &&
          await hasLogFileFingerprintChanged(handle, stat, this.logFileFingerprints.get(logPath))
        ) {
          wasTruncated = true;
          offset = 0;
        }

        modifiedAtMs = stat.mtimeMs;
        const length = stat.size - offset;
        if (length <= 0) {
          return;
        }

        buffer = await readFileRange(handle, offset, length);
        if (this.isArenaLog(logPath, sessionContext) && (wasTruncated || !this.logFileFingerprints.has(logPath))) {
          replacementFingerprint = createLogFileFingerprint(buffer, stat);
        }
      } finally {
        await handle.close();
      }
      if (!this.isCurrentSession(sessionContext)) {
        return;
      }
      if (buffer.length === 0) {
        return;
      }
      const previousPending = wasTruncated ? undefined : this.pendingLogBytes.get(logPath);
      const { text, pending } = splitCompleteLogChunk(previousPending, buffer);
      if (!text) {
        this.offsets.set(logPath, offset + buffer.length);
        this.setPendingLogBytes(logPath, pending);
        if (replacementFingerprint) {
          this.logFileFingerprints.set(logPath, replacementFingerprint);
        }
        this.clearLogReadRetry(logPath);
        return;
      }
      if (this.engine.getState().status === "error") {
        this.engine.setStatus("watching", this.activeLogPath ?? logPath);
      }
      if (this.isArenaLog(logPath, sessionContext)) {
        this.arena.setPreferArenaLogPicks(true);
        const previousRedraftGenerationId = this.arena.getState().redraftGenerationId;
        if (wasTruncated) {
          this.arena.reset();
          this.arena.setPreferArenaLogPicks(true);
          this.lastArenaDeckSignature = undefined;
          this.engine.clearArenaDeck();
          this.arena.applyArenaText(selectCurrentArenaLogText(text));
        } else {
          // Appended bytes are already scoped to the active file offset. Running the
          // cumulative-log selector here can discard picks written before a mode line.
          this.arena.applyArenaText(text);
        }
        const latestEventAtMs = resolveLatestLogEventAt(text, modifiedAtMs, isArenaDeckStateLine);
        if (wasTruncated) {
          this.latestArenaDeckEventAtMs = latestEventAtMs;
        } else if (latestEventAtMs !== undefined) {
          this.latestArenaDeckEventAtMs = Math.max(this.latestArenaDeckEventAtMs ?? latestEventAtMs, latestEventAtMs);
        }
        this.bindLatestExactArenaDeckToNewRedraft(previousRedraftGenerationId, text, modifiedAtMs, sessionContext);
        this.applyPendingExactArenaDeck(sessionContext);
        if (
          this.pendingPowerGameText &&
          (this.arena.getState().status === "complete" || this.arena.getState().status === "playing")
        ) {
          this.syncArenaDeckToTracker();
          this.applyPowerText("");
        }
      } else if (this.isDecksLog(logPath, sessionContext)) {
        const selectedCollectionDeck = await this.refreshCollectionDecks(logPath, sessionContext);
        if (!this.isCurrentSession(sessionContext)) {
          return;
        }
        if (isArenaCollectionDeck(selectedCollectionDeck)) {
          this.rememberLatestExactArenaDeck(selectedCollectionDeck, text, modifiedAtMs, sessionContext);
          if (!this.applyExactArenaDeck(selectedCollectionDeck, sessionContext)) {
            this.deferExactArenaDeck(selectedCollectionDeck, sessionContext);
          }
        } else if (selectedCollectionDeck && this.arena.getState().status === "inactive" && !this.activeArenaGame) {
          this.previewCollectionDeck(selectedCollectionDeck, "decks-log");
        }
      } else if (this.isPlayerLog(logPath, sessionContext)) {
        const playerEvents = parsePlayerLog(text);
        if (playerEvents.some((event) => event.type === "game-started")) {
          this.markGameStartedWhilePowerLogStalled();
        }
        const friendlyPlayerId = findFriendlyPlayerId(text);
        if (friendlyPlayerId !== undefined) {
          this.playerLogFriendlyController = friendlyPlayerId;
          this.engine.setFriendlyController(friendlyPlayerId);
        }
      } else {
        this.updateFriendlyControllerFromPowerText(text);
        this.applyPowerText(text, undefined, modifiedAtMs);
      }
      this.ensureArenaRatingsForCurrentArena(sessionContext);
      this.syncArenaDeckToTracker();
      this.pushState();
      if (!this.isCurrentSession(sessionContext)) {
        return;
      }
      this.offsets.set(logPath, offset + buffer.length);
      this.setPendingLogBytes(logPath, pending);
      if (replacementFingerprint) {
        this.logFileFingerprints.set(logPath, replacementFingerprint);
      }
      this.clearLogReadRetry(logPath);
      void this.refreshArenaScreenChoices(sessionContext);
    } catch (error) {
      if (!this.isCurrentSession(sessionContext)) {
        return;
      }
      this.engine.setStatus("error", logPath, String(error));
      this.pushState();
      this.scheduleLogReadRetry(logPath, sessionContext);
    }
  }

  private enqueueLogRead(logPath: string, sessionContext: SessionContext) {
    const queued = this.orderedLogReadQueue.then(() => this.readAppended(logPath, sessionContext));
    this.orderedLogReadQueue = queued.catch(() => undefined);
    this.logReadQueues.set(logPath, queued);
    void queued.finally(() => {
      if (this.logReadQueues.get(logPath) === queued) {
        this.logReadQueues.delete(logPath);
      }
    });
  }

  private async stopWatcherOnly() {
    this.clearLogReadRetries();
    const watcher = this.watcher;
    if (watcher) {
      await watcher.close();
      if (this.watcher === watcher) {
        this.watcher = undefined;
      }
    }
  }

  private async waitForLogReadQueues() {
    while (this.logReadQueues.size > 0) {
      await Promise.allSettled([...this.logReadQueues.values()]);
    }
  }

  private async reconcileExpectedDecksLog(sessionContext: SessionContext) {
    const decksLogPath = this.decksLogPath;
    if (
      !decksLogPath ||
      this.offsets.has(decksLogPath) ||
      !this.isCurrentSession(sessionContext)
    ) {
      return;
    }

    const stat = await fs.stat(decksLogPath).catch(() => undefined);
    if (!stat?.isFile() || !this.isCurrentSession(sessionContext)) {
      return;
    }
    this.enqueueLogRead(decksLogPath, sessionContext);
    await this.waitForLogReadQueues();
  }

  private markGameStartedWhilePowerLogStalled() {
    this.engine.resetAfterGame();
    this.engine.resetForGame();
    this.constructedScreenMode = undefined;
    this.engine.setStatus(
      "watching",
      this.activeLogPath ?? this.engine.getState().logPath,
      "对局已开始，但 Power.log 暂未更新。记牌小窗已保留；若牌库不变，请重启炉石恢复日志。"
    );
  }

  private beginSession() {
    const sessionContext = createSessionContext(createSessionKey(++this.sessionSequence));
    this.sessionContext = sessionContext;
    this.stopSessionRefresh();
    this.stopArenaScreenRecognition();
    this.constructedScreenMode = undefined;
    this.collectionDeckPreviewSource = undefined;
    this.pendingPowerGameText = "";
    this.waitingForFirstPowerLog = false;
    this.pendingExactArenaDeck = undefined;
    this.latestExactArenaDeckObservation = undefined;
    this.latestArenaDeckEventAtMs = undefined;
    this.activeArenaGame = false;
    this.pendingLogBytes.clear();
    this.logFileFingerprints.clear();
    this.offsets.clear();
    this.logReadQueues.clear();
    this.orderedLogReadQueue = Promise.resolve();
    this.clearLogReadRetries();
    this.resetPendingArenaExit();
    this.activeMatchId = undefined;
    this.activeMatchDeckName = undefined;
    this.activeMatchMode = "unknown";
    this.playerLogFriendlyController = undefined;
    this.powerGameExplicitLocalPlayerIds.clear();
    this.powerGamePlayerNames.clear();
    this.powerGameStartTimestamp = undefined;
    return sessionContext;
  }

  private bindResolvedSession(
    sessionContext: SessionContext,
    logs: NonNullable<Awaited<ReturnType<typeof resolveBestLogTarget>>>,
    activeLogPath: string,
    paths: { readonly arenaLogPath?: string; readonly decksLogPath?: string; readonly playerLogPath?: string }
  ) {
    if (!this.isCurrentSession(sessionContext)) {
      return sessionContext;
    }
    const bound = bindSessionContext(sessionContext, logs, { activeLogPath, ...paths });
    this.sessionContext = bound;
    return bound;
  }

  private scheduleLogReadRetry(logPath: string, sessionContext: SessionContext) {
    if (this.disposing || this.logReadRetryTimers.has(logPath)) {
      return;
    }
    const timer = setTimeout(() => {
      this.logReadRetryTimers.delete(logPath);
      if (this.isCurrentSession(sessionContext)) {
        this.enqueueLogRead(logPath, sessionContext);
      }
    }, 150);
    this.logReadRetryTimers.set(logPath, timer);
  }

  private clearLogReadRetry(logPath: string) {
    const timer = this.logReadRetryTimers.get(logPath);
    if (timer) {
      clearTimeout(timer);
      this.logReadRetryTimers.delete(logPath);
    }
  }

  private clearLogReadRetries() {
    for (const timer of this.logReadRetryTimers.values()) {
      clearTimeout(timer);
    }
    this.logReadRetryTimers.clear();
  }

  private isCurrentSession(sessionContext: SessionContext) {
    return hasSessionKey(this.sessionContext, sessionContext.key);
  }

  private setPendingLogBytes(logPath: string, pending: Buffer) {
    if (pending.length > 0) {
      this.pendingLogBytes.set(logPath, pending);
    } else {
      this.pendingLogBytes.delete(logPath);
    }
  }

  private startSessionRefresh(sessionContext: SessionContext) {
    if (this.disposing || !this.isCurrentSession(sessionContext)) {
      return;
    }

    this.stopSessionRefresh();
    this.sessionRefreshTimer = setInterval(() => {
      void this.reconcileExpectedDecksLog(sessionContext);
      void this.followNewestSession(sessionContext);
    }, 1_000);
  }

  private stopSessionRefresh() {
    if (this.sessionRefreshTimer) {
      clearInterval(this.sessionRefreshTimer);
      this.sessionRefreshTimer = undefined;
    }
    this.sessionRefreshKey = undefined;
  }

  private startArenaScreenRecognition(sessionContext: SessionContext) {
    if (this.disposing || !this.isCurrentSession(sessionContext)) {
      return;
    }
    this.stopArenaScreenRecognition();
    this.arenaScreenRecognitionTimer = setInterval(() => {
      void this.refreshArenaScreenChoices(sessionContext);
    }, 450);
    this.arenaScreenRecognitionTimer.unref();
  }

  private stopArenaScreenRecognition() {
    if (this.arenaScreenRecognitionTimer) {
      clearInterval(this.arenaScreenRecognitionTimer);
      this.arenaScreenRecognitionTimer = undefined;
    }
    this.arenaScreenRecognitionError = undefined;
  }

  private async refreshArenaScreenChoices(sessionContext: SessionContext) {
    const arenaState = this.arena.getState();
    const isArenaChoosing = arenaState.status === "drafting" || arenaState.status === "redrafting";
    const shouldRecognizeArenaChoices = isArenaChoosing && arenaState.currentChoices.length < 3;
    const shouldRecognizeConstructedDeck =
      !shouldRecognizeArenaChoices &&
      !isArenaChoosing &&
      shouldRecognizeConstructedDeckScreen(arenaState.status, this.activeArenaGame);
    const arenaRecognitionContext = shouldRecognizeArenaChoices ? getArenaRecognitionContext(arenaState) : undefined;
    if (
      !this.isCurrentSession(sessionContext) ||
      this.arenaScreenRecognitionInFlight ||
      (!shouldRecognizeArenaChoices && !shouldRecognizeConstructedDeck)
    ) {
      return;
    }

    let settleRecognition: (() => void) | undefined;
    this.arenaScreenRecognitionSettled = new Promise<void>((resolve) => {
      settleRecognition = resolve;
    });
    this.arenaScreenRecognitionInFlight = true;
    try {
      const result = await this.arenaScreenRecognizer.recognize({
        requireHearthstoneFrontmost: true,
        profile: shouldRecognizeArenaChoices ? "arena" : "constructed"
      });
      if (!this.isCurrentSession(sessionContext)) {
        return;
      }
      const currentArenaState = this.arena.getState();
      const isCurrentlyChoosingArena =
        (currentArenaState.status === "drafting" || currentArenaState.status === "redrafting") &&
        currentArenaState.currentChoices.length < 3;
      if (
        (shouldRecognizeArenaChoices &&
          (!isCurrentlyChoosingArena || getArenaRecognitionContext(currentArenaState) !== arenaRecognitionContext)) ||
        (shouldRecognizeConstructedDeck &&
          (isCurrentlyChoosingArena || (this.activeArenaGame && currentArenaState.status !== "complete")))
      ) {
        return;
      }

      if (result.status === "ok") {
        if (shouldRecognizeArenaChoices) {
          const recognized = this.arena.applyScreenChoices(selectArenaChoiceTexts(result.texts));
          if (recognized) {
            this.engine.setStatus("watching", this.activeLogPath);
            this.resetPendingArenaExit();
            this.arenaScreenRecognitionError = undefined;
            this.arena.setError(undefined);
            this.pushState();
            return;
          }

          const inspection = inspectConstructedDeckScreen(result.texts, this.knownCollectionDecks);
          if (inspection.mode && inspection.selectedDeck) {
            const deckKey = `${inspection.mode}:${inspection.selectedDeck.id}`;
            if (deckKey === this.pendingArenaExitDeckKey) {
              this.pendingArenaExitConfirmations += 1;
            } else {
              this.pendingArenaExitDeckKey = deckKey;
              this.pendingArenaExitConfirmations = 1;
            }
            if (this.pendingArenaExitConfirmations >= 2) {
              this.constructedScreenMode = inspection.mode;
              this.arena.reset();
              this.lastArenaDeckSignature = undefined;
              this.resetPendingArenaExit();
              this.previewCollectionDeck(inspection.selectedDeck, "screen");
            }
          } else {
            this.resetPendingArenaExit();
          }
          return;
        }

        const inspection = inspectConstructedDeckScreen(result.texts, this.knownCollectionDecks);
        if (inspection.mode) {
          if (this.engine.hasActiveGame()) {
            const deckKey = `${inspection.mode}:${inspection.selectedDeck?.id ?? "unresolved"}`;
            if (deckKey === this.pendingArenaExitDeckKey) {
              this.pendingArenaExitConfirmations += 1;
            } else {
              this.pendingArenaExitDeckKey = deckKey;
              this.pendingArenaExitConfirmations = 1;
            }
            if (this.pendingArenaExitConfirmations < 2) {
              return;
            }
            this.engine.resetAfterGame();
          }

          this.resetPendingArenaExit();
          if (this.getState().status !== "missing-log") {
            this.engine.setStatus("watching", this.activeLogPath);
          }
          this.constructedScreenMode = inspection.mode;
          this.activeArenaGame = false;
          this.arena.reset();
          this.lastArenaDeckSignature = undefined;

          if (inspection.selectedDeck) {
            this.previewCollectionDeck(inspection.selectedDeck, "screen");
            return;
          }

          this.clearCollectionDeckPreview();
          this.engine.clearArenaDeck();
          this.pushState();
          return;
        }

        this.resetPendingArenaExit();
        const leftConstructedScreen = this.constructedScreenMode !== undefined;
        this.constructedScreenMode = undefined;

        if (leftConstructedScreen) {
          this.syncArenaDeckToTracker();
          this.pushState();
        }
        return;
      }

      if (!shouldRecognizeArenaChoices) {
        if (this.waitingForFirstPowerLog) {
          this.engine.setStatus("watching", this.activeLogPath, buildWaitingForGameMessage());
          this.pushState();
          return;
        }
        const message = result.message ?? constructedScreenRecognitionFailureMessage(result.status);
        this.clearCollectionDeckPreview({ preserveDecksLog: true });
        if (result.status === "permission-denied" && arenaState.status === "complete") {
          this.arena.reset();
          this.lastArenaDeckSignature = undefined;
          this.engine.clearArenaDeck();
        }
        if (this.getState().status !== "missing-log") {
          this.engine.setStatus("watching", this.activeLogPath, message);
        }
        this.pushState();
        return;
      }

      const message = result.message ?? "竞技场候选牌尚未可识别。";
      if (message !== this.arenaScreenRecognitionError) {
        this.arenaScreenRecognitionError = message;
        this.arena.setError(message);
        this.pushState();
      }
    } finally {
      this.arenaScreenRecognitionInFlight = false;
      settleRecognition?.();
    }
  }

  private async followNewestSession(sessionContext: SessionContext) {
    if (process.env.QA_LOCK_LOG_PATH === "1") {
      return;
    }
    if (
      this.disposing ||
      !this.isCurrentSession(sessionContext) ||
      this.sessionRefreshKey !== undefined
    ) {
      return;
    }

    this.sessionRefreshKey = sessionContext.key;
    try {
      const session = await resolveBestLogTarget();
      if (this.disposing || !this.isCurrentSession(sessionContext)) {
        return;
      }

      const nextLogPath = session?.powerLogPath ?? session?.playerLogPath ?? session?.arenaLogPath ?? session?.decksLogPath ?? session?.loadingScreenLogPath;
      if (
        !session ||
        !nextLogPath ||
        (sessionContext.root && path.resolve(session.root) !== sessionContext.root) ||
        (
          this.activeLogPath &&
          path.resolve(nextLogPath) === path.resolve(this.activeLogPath)
        )
      ) {
        return;
      }

      await this.start({ logPath: nextLogPath });
    } catch {
      // Keep the active watcher running if a periodic discovery pass fails.
    } finally {
      if (this.sessionRefreshKey === sessionContext.key) {
        this.sessionRefreshKey = undefined;
      }
    }
  }

  private async importDeckIntoEngine(deckText: string, sessionContext?: SessionContext) {
    const cardDatabase = await this.cardData.loadCardDatabase({ preferCache: true });
    if (sessionContext && !this.isCurrentSession(sessionContext)) {
      return;
    }
    this.engine.importDeck(deckText, cardDatabase.database, cardDatabase.warnings);
  }

  private async refreshCollectionDecks(logPath: string, sessionContext: SessionContext): Promise<CollectionDeck | undefined> {
    if (!this.collectionDecks || !this.isCurrentSession(sessionContext) || !sessionOwnsLogPath(sessionContext, logPath)) {
      return undefined;
    }

    const result = await this.collectionDecks.scanAndImportDecks({ logPath });
    if (!this.isCurrentSession(sessionContext) || result.status !== "ok") {
      return undefined;
    }

    const arenaState = this.arena.getState();
    const activeArenaDeckId = arenaState.status === "inactive" ? undefined : arenaState.deckId;
    const allDecks = toTrackerCollectionDecks(result.decks, logPath).map((deck) =>
      activeArenaDeckId && deck.deckId === activeArenaDeckId ? { ...deck, mode: "arena" } : deck
    );
    const constructedDecks = allDecks.filter((deck) => !isArenaCollectionDeck(deck));
    this.engine.setCollectionDecks(constructedDecks);
    this.knownCollectionDecks = constructedDecks;
    if (result.activeDeck) {
      return findTrackerCollectionDeck(allDecks, result.activeDeck);
    }
    return activeArenaDeckId
      ? allDecks.find((deck) => deck.deckId === activeArenaDeckId)
      : undefined;
  }

  private async loadCardDatabaseIntoEngine(sessionContext: SessionContext) {
    const cardDatabase = await this.cardData.loadCardDatabase({ preferCache: true });
    if (!this.isCurrentSession(sessionContext)) {
      return;
    }
    if (cardDatabase.database) {
      this.engine.setCardDatabase(cardDatabase.database);
      this.arena.setCardDatabase(cardDatabase.database);
    }
  }

  private ensureArenaRatingsForCurrentArena(sessionContext: SessionContext) {
    if (this.disposing || !this.isCurrentSession(sessionContext)) {
      return;
    }
    const arenaState = this.arena.getState();
    const className = arenaState.status === "inactive" ? undefined : arenaState.hero?.className;
    const loadedAt = className ? this.arenaRatingsLoadedAt.get(className) : undefined;
    if (!className || (loadedAt !== undefined && Date.now() - loadedAt < 12 * 60 * 60 * 1000)) {
      return;
    }

    if (
      this.arenaRatingsRequest?.sessionKey === sessionContext.key &&
      this.arenaRatingsRequest.className === className
    ) {
      return;
    }

    const requestId = ++this.arenaRatingsRequestSequence;
    const promise = this.arenaRatings.loadRatings(className)
      .then((result) => {
        if (
          this.disposing ||
          !this.isCurrentSession(sessionContext) ||
          this.arenaRatingsRequest?.id !== requestId
        ) {
          return;
        }
        const currentArena = this.arena.getState();
        if (currentArena.status === "inactive" || currentArena.hero?.className !== className) {
          return;
        }

        if (result.table) {
          this.arena.setRatings(result.table);
        }
        const classSlug = toFirestoneClassSlug(className);
        if (
          classSlug &&
          result.table?.firestoneClasses?.[classSlug] &&
          result.firestoneClassCacheStatus !== "stale" &&
          result.firestoneClassCacheStatus !== "missing"
        ) {
          this.arenaRatingsLoadedAt.set(className, Date.now());
        } else {
          this.arenaRatingsLoadedAt.delete(className);
        }
        if (result.warnings[0]) {
          this.arena.setError(result.warnings[0]);
        }
        this.syncArenaDeckToTracker();
        this.pushState();
      })
      .catch((error) => {
        if (
          !this.disposing &&
          this.isCurrentSession(sessionContext) &&
          this.arenaRatingsRequest?.id === requestId &&
          this.arena.getState().hero?.className === className
        ) {
          this.arenaRatingsLoadedAt.delete(className);
          this.arena.setError(`竞技场评分读取失败：${error instanceof Error ? error.message : String(error)}`);
          this.pushState();
        }
      })
      .finally(() => {
        if (this.arenaRatingsRequest?.id === requestId) {
          this.arenaRatingsRequest = undefined;
        }
      });
    this.arenaRatingsRequest = { id: requestId, sessionKey: sessionContext.key, className, promise };
  }

  private applyPowerText(
    text: string,
    selectedCollectionDeck?: CollectionDeck,
    powerLogModifiedAtMs?: number,
    ignoreGamesOlderThanCurrentArenaDeck = false
  ) {
    const combinedText = this.pendingPowerGameText ? `${this.pendingPowerGameText}\n${text}` : text;
    this.pendingPowerGameText = "";
    const knownGameType = detectPowerGameType(combinedText) ?? (
      this.arena.getState().status === "playing" ? "arena" : undefined
    );
    const currentText = selectCurrentPowerGameText(combinedText);
    if (
      ignoreGamesOlderThanCurrentArenaDeck &&
      this.isPowerGameOlderThanCurrentArenaDeck(currentText, powerLogModifiedAtMs)
    ) {
      return;
    }
    if (
      !ignoreGamesOlderThanCurrentArenaDeck &&
      currentText.includes("CREATE_GAME") &&
      knownGameType === "arena" &&
      (this.arena.getState().status === "drafting" || this.arena.getState().status === "redrafting")
    ) {
      this.pendingPowerGameText = currentText;
      return;
    }
    if (
      currentText.includes("CREATE_GAME") &&
      knownGameType === undefined &&
      this.arena.getState().status !== "inactive"
    ) {
      this.pendingPowerGameText = currentText;
      return;
    }
    const lines = currentText.split(/\r?\n/);
    const deckSnapshot = inspectFriendlyDeckSnapshot(currentText, this.engine.getFriendlyController());
    const gameStartIndex = selectedCollectionDeck
      ? lines.findIndex(isConstructedGameStartLine)
      : -1;

    if (gameStartIndex >= 0 && selectedCollectionDeck) {
      this.applyCurrentPowerText(
        lines.slice(0, gameStartIndex + 1).join("\n"),
        knownGameType,
        powerLogModifiedAtMs
      );
      if (deckSnapshot) {
        this.engine.setFriendlyDeckSnapshot(deckSnapshot);
      }
      const selected =
        this.engine.activateExplicitCollectionDeck(selectedCollectionDeck.id, {
          expectedSize: deckSnapshot?.initialDeckSize ?? getConstructedExpectedDeckSize(selectedCollectionDeck)
        }) ||
        (deckSnapshot ? this.engine.activateCollectionDeck(selectedCollectionDeck.id) : false);
      if (!selected && deckSnapshot) {
        this.engine.useUnmatchedDeckSnapshot();
      }
      this.applyCurrentPowerText(
        lines.slice(gameStartIndex + 1).join("\n"),
        knownGameType,
        powerLogModifiedAtMs
      );
      // The replay above consumes the whole current game. Restore the real
      // snapshot afterward so the first rendered state matches Hearthstone.
      if (deckSnapshot) {
        this.engine.setFriendlyDeckSnapshot(deckSnapshot);
      }
      return;
    }

    this.applyCurrentPowerText(currentText, knownGameType, powerLogModifiedAtMs);
  }

  private isPowerGameOlderThanCurrentArenaDeck(currentText: string, powerLogModifiedAtMs?: number) {
    if (
      this.arena.getState().status !== "complete" ||
      this.latestArenaDeckEventAtMs === undefined ||
      powerLogModifiedAtMs === undefined
    ) {
      return false;
    }

    const gameStartedAtMs = resolveLatestLogEventAt(
      currentText,
      powerLogModifiedAtMs,
      (line) => line.includes("CREATE_GAME")
    );
    return gameStartedAtMs !== undefined && gameStartedAtMs < this.latestArenaDeckEventAtMs;
  }

  private updateFriendlyControllerFromPowerText(text: string) {
    const lines = text.split(/\r?\n/);
    const gameStartIndexes = lines.flatMap((line, index) => line.includes("CREATE_GAME") ? [index] : []);
    const latestGameStartIndex = gameStartIndexes.at(-1);
    let identityLines = lines;
    if (latestGameStartIndex !== undefined) {
      const gameStartTimestamp = getPowerLogTimestamp(lines[latestGameStartIndex] ?? "");
      let firstDuplicateGameStartIndex = latestGameStartIndex;
      if (gameStartTimestamp) {
        for (let index = gameStartIndexes.length - 2; index >= 0; index -= 1) {
          const candidateIndex = gameStartIndexes[index]!;
          if (getPowerLogTimestamp(lines[candidateIndex] ?? "") !== gameStartTimestamp) {
            break;
          }
          firstDuplicateGameStartIndex = candidateIndex;
        }
      }

      if (!gameStartTimestamp || gameStartTimestamp !== this.powerGameStartTimestamp) {
        this.powerGameExplicitLocalPlayerIds.clear();
        this.powerGamePlayerNames.clear();
      }
      this.powerGameStartTimestamp = gameStartTimestamp;
      identityLines = [
        ...selectPowerPlayerIdentityLinesBeforeGameStart(lines, firstDuplicateGameStartIndex),
        ...lines.slice(firstDuplicateGameStartIndex)
      ];
    }
    collectPowerPlayerIdentityEvidence(
      identityLines,
      this.powerGameExplicitLocalPlayerIds,
      this.powerGamePlayerNames
    );

    this.engine.setFriendlyController(
      this.playerLogFriendlyController ?? resolvePowerFriendlyPlayerId(
        this.powerGameExplicitLocalPlayerIds,
        this.powerGamePlayerNames
      )
    );
  }

  private applyCurrentPowerText(
    currentText: string,
    knownGameType?: "arena" | "constructed",
    powerLogModifiedAtMs?: number
  ) {
    const hasGameStart = currentText.includes("CREATE_GAME");
    const gameType = detectPowerGameType(currentText) ?? knownGameType;
    this.updateMatchContext(currentText, gameType);
    const startsArenaGame = hasGameStart && gameType === "arena";
    const startsConstructedGame = hasGameStart && (
      gameType === "constructed" ||
      (gameType === undefined && this.arena.getState().status === "inactive")
    );
    if (startsArenaGame) {
      this.activeArenaGame = true;
    }
    if (hasGameStart) {
      this.activeTrackerMode = detectSupportedTrackerMode(currentText) ??
        (startsArenaGame ? "arena" : this.constructedScreenMode ? "ladder" : undefined);
    }
    if (currentText.split(/\r?\n/).some(isGameEndLine)) {
      this.activeArenaGame = false;
    }
    if (startsArenaGame || startsConstructedGame) {
      this.constructedScreenMode = undefined;
      this.collectionDeckPreviewSource = undefined;
    }
    if (startsConstructedGame && this.arena.getState().status !== "inactive") {
      this.arena.reset();
      this.engine.clearArenaDeck();
    }

    const lines = currentText.split(/\r?\n/);
    const firstGameEndIndex = lines.findIndex(isGameEndLine);
    if (firstGameEndIndex >= 0) {
      const beforeGameEnd = lines.slice(0, firstGameEndIndex).join("\n");
      if (beforeGameEnd) {
        this.engine.applyText(beforeGameEnd);
      }
      this.updateMatchContext("", gameType);
      this.recordMatchResult(currentText, powerLogModifiedAtMs);
      this.engine.applyText(lines.slice(firstGameEndIndex).join("\n"));
    } else {
      this.engine.applyText(currentText);
    }
    this.arena.applyPowerText(currentText);
    if (startsArenaGame) {
      this.arena.markPlaying();
    }
  }

  private updateMatchContext(currentText: string, gameType?: "arena" | "constructed") {
    const lines = currentText.split(/\r?\n/);
    let gameStartLine: string | undefined;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (lines[index]?.includes("CREATE_GAME")) {
        gameStartLine = lines[index];
        break;
      }
    }
    if (gameStartLine) {
      const sourcePath = this.engine.getState().logPath ?? this.activeLogPath ?? "Power.log";
      this.activeMatchId = createHash("sha256").update(`${path.resolve(sourcePath)}\n${gameStartLine}`).digest("hex");
      this.activeMatchDeckName = this.engine.getState().deckName;
      this.activeMatchMode = this.resolveCurrentMatchMode(gameType);
    }

    this.activeMatchDeckName = this.engine.getState().deckName ?? this.activeMatchDeckName;
    const resolvedMode = this.resolveCurrentMatchMode(gameType);
    if (resolvedMode !== "unknown") {
      this.activeMatchMode = resolvedMode;
    }
  }

  private recordMatchResult(currentText: string, powerLogModifiedAtMs?: number) {
    const friendlyController = this.engine.getFriendlyController();
    const friendlyPlayerName = friendlyController === undefined
      ? undefined
      : this.powerGamePlayerNames.get(friendlyController);
    const resultLine = currentText
      .split(/\r?\n/)
      .map((line) => ({ line, result: parseMatchResultLine(line, friendlyController, friendlyPlayerName) }))
      .find((value) => value.result !== undefined);
    if (
      !resultLine?.result ||
      !this.activeMatchId ||
      this.recordedMatchIds.has(this.activeMatchId) ||
      this.pendingMatchIds.has(this.activeMatchId)
    ) {
      return;
    }
    const endedAt = resolveMatchEndedAt(resultLine.line, powerLogModifiedAtMs);
    if (!endedAt) {
      return;
    }

    const match: MatchRecord = {
      id: this.activeMatchId,
      result: resultLine.result,
      mode: this.activeMatchMode,
      ...(this.activeMatchDeckName ? { deckName: this.activeMatchDeckName } : {}),
      endedAt
    };
    this.pendingMatchIds.add(match.id);
    this.matchHistoryWrites = this.matchHistoryWrites.then(async () => {
      try {
        await this.matchHistory.add(match);
        this.recordedMatchIds.add(match.id);
        this.matchHistoryWriteErrors.delete(match.id);
      } catch (error) {
        this.matchHistoryWriteErrors.set(match.id, error instanceof Error ? error.message : String(error));
      } finally {
        this.pendingMatchIds.delete(match.id);
      }
    });
  }

  private resolveCurrentMatchMode(gameType?: "arena" | "constructed"): MatchMode {
    if (gameType === "arena" || this.activeArenaGame || this.arena.getState().status === "playing") {
      return "arena";
    }
    if (this.constructedScreenMode) {
      return this.constructedScreenMode;
    }

    const activeDeckId = this.engine.getState().autoMatchedDeckId;
    const activeDeck = activeDeckId ? this.knownCollectionDecks.find((deck) => deck.id === activeDeckId) : undefined;
    return activeDeck ? getConstructedMode(activeDeck) ?? "unknown" : "unknown";
  }

  private resolveTrackerMode(state: PublicTrackerState): TrackerMode | undefined {
    if (this.arena.getState().status !== "inactive") return "arena";
    if (this.constructedScreenMode) return "ladder";
    return state.gameActive ? this.activeTrackerMode : undefined;
  }

  private syncArenaDeckToTracker() {
    if (
      this.engine.getState().autoMatchedDeckId &&
      this.constructedScreenMode &&
      !isPowerLogPath(this.activeLogPath)
    ) {
      return;
    }

    const arenaState = this.arena.getState();
    const redraftTrackerDeck = arenaState.awaitingExactDeck
      ? arenaState.redraftTrackerDeck ?? []
      : [];
    if (arenaState.status === "drafting") {
      this.lastArenaDeckSignature = undefined;
      this.engine.clearArenaDeck();
      return;
    }
    if (
      arenaState.status === "redrafting" &&
      arenaState.deck.length === 0 &&
      redraftTrackerDeck.length === 0
    ) {
      this.lastArenaDeckSignature = undefined;
      this.engine.clearArenaDeck();
      return;
    }
    if (
      arenaState.status !== "redrafting" &&
      arenaState.status !== "complete" &&
      arenaState.status !== "playing"
    ) {
      return;
    }

    const baseDeck = redraftTrackerDeck.length > 0
      ? redraftTrackerDeck
      : arenaState.deck;
    const knownRedraftCount = redraftTrackerDeck.reduce((total, card) => total + card.count, 0);
    const unresolvedCount = redraftTrackerDeck.length > 0
      ? Math.max(0, 30 - knownRedraftCount)
      : arenaState.unresolvedCount ?? 0;
    const trackerDeck = unresolvedCount > 0
      ? [
          ...baseDeck,
          {
            name: redraftTrackerDeck.length > 0 ? "待确认重选牌" : "未解析竞技场牌",
            count: unresolvedCount,
            unresolved: true as const
          }
        ]
      : baseDeck;
    const trackerEngineDeck = trackerDeck.map(({ pickRate: _pickRate, deckImpact: _deckImpact, ...card }) => card);
    const signature = JSON.stringify({
      phase: arenaState.status === "redrafting" ? "redrafting" : "final",
      redraftGenerationId: arenaState.status === "redrafting" ? arenaState.redraftGenerationId : undefined,
      deck: trackerEngineDeck
    });
    const trackerDeckName = "竞技场牌库";
    const trackerAlreadyShowsArenaDeck = this.engine.getState().deckName === trackerDeckName;
    if (
      !signature ||
      (signature === this.lastArenaDeckSignature && trackerAlreadyShowsArenaDeck) ||
      trackerDeck.length === 0
    ) {
      return;
    }

    this.lastArenaDeckSignature = signature;
    this.engine.syncDeckCards(trackerEngineDeck, trackerDeckName);
  }

  private applyExactArenaDeck(deck: CollectionDeck | undefined, sessionContext: SessionContext) {
    if (!this.isCurrentSession(sessionContext) || !isArenaCollectionDeck(deck)) {
      return false;
    }
    const status = this.arena.getState().status;
    if (status !== "complete" && status !== "playing") {
      return false;
    }
    const applied = this.arena.applyExactDeck(deck.cards, deck.deckId);
    if (applied) {
      this.pendingExactArenaDeck = undefined;
    }
    return applied;
  }

  private deferExactArenaDeck(deck: CollectionDeck, sessionContext: SessionContext) {
    if (!this.isCurrentSession(sessionContext)) {
      return false;
    }
    const state = this.arena.getState();
    const total = deck.cards.reduce((sum, card) => sum + card.count, 0);
    if (
      state.status !== "redrafting" ||
      !state.redraftGenerationId ||
      !deck.deckId ||
      (state.deckId !== undefined && deck.deckId !== state.deckId) ||
      total !== 30
    ) {
      return false;
    }

    this.pendingExactArenaDeck = {
      sessionKey: sessionContext.key,
      deck: {
        ...deck,
        cards: deck.cards.map((card) => ({ ...card }))
      },
      arenaDeckId: state.deckId ?? deck.deckId,
      redraftGenerationId: state.redraftGenerationId
    };
    return true;
  }

  private rememberLatestExactArenaDeck(
    deck: CollectionDeck,
    appendedText: string,
    modifiedAtMs: number,
    sessionContext: SessionContext
  ) {
    if (!this.isCurrentSession(sessionContext)) {
      return false;
    }
    const eventAtMs = resolveLatestLogEventAt(`${appendedText}\n${deck.rawText}`, modifiedAtMs);
    if (eventAtMs === undefined) {
      this.latestExactArenaDeckObservation = undefined;
      return false;
    }

    this.latestExactArenaDeckObservation = {
      sessionKey: sessionContext.key,
      deck: {
        ...deck,
        cards: deck.cards.map((card) => ({ ...card }))
      },
      eventAtMs
    };
    return true;
  }

  private bindLatestExactArenaDeckToNewRedraft(
    previousRedraftGenerationId: string | undefined,
    arenaText: string,
    modifiedAtMs: number,
    sessionContext: SessionContext
  ) {
    if (!this.isCurrentSession(sessionContext)) {
      return false;
    }
    const state = this.arena.getState();
    if (!state.redraftGenerationId || state.redraftGenerationId === previousRedraftGenerationId) {
      return false;
    }

    const observation = this.latestExactArenaDeckObservation;
    this.latestExactArenaDeckObservation = undefined;
    const redraftAtMs = resolveLatestLogEventAt(
      arenaText,
      modifiedAtMs,
      (line) => /SetDraftMode\s*-\s*REDRAFTING\b|OnRedraftBegin\b/i.test(line)
    );
    if (
      !observation ||
      observation.sessionKey !== sessionContext.key ||
      redraftAtMs === undefined ||
      observation.eventAtMs < redraftAtMs ||
      !state.deckId ||
      observation.deck.deckId !== state.deckId
    ) {
      return false;
    }

    this.pendingExactArenaDeck = {
      sessionKey: sessionContext.key,
      deck: observation.deck,
      arenaDeckId: state.deckId,
      redraftGenerationId: state.redraftGenerationId
    };
    return true;
  }

  private applyPendingExactArenaDeck(sessionContext: SessionContext) {
    const pending = this.pendingExactArenaDeck;
    if (!this.isCurrentSession(sessionContext) || !pending) {
      return false;
    }

    const state = this.arena.getState();
    if (
      pending.sessionKey !== sessionContext.key ||
      state.redraftGenerationId !== pending.redraftGenerationId ||
      state.deckId !== pending.arenaDeckId
    ) {
      this.pendingExactArenaDeck = undefined;
      return false;
    }
    if (state.status !== "complete" && state.status !== "playing") {
      return false;
    }
    this.pendingExactArenaDeck = undefined;
    this.latestExactArenaDeckObservation = undefined;
    return this.applyExactArenaDeck(pending.deck, sessionContext);
  }

  private async applyInitialExactArenaDeck(
    deck: CollectionDeck | undefined,
    arenaLogPath: string | undefined,
    sessionContext: SessionContext
  ) {
    if (!this.isCurrentSession(sessionContext) || !isArenaCollectionDeck(deck)) {
      return false;
    }
    if (!this.arena.getState().redraftGenerationId) {
      return this.applyExactArenaDeck(deck, sessionContext);
    }
    if (!arenaLogPath || !deck.sourcePath) {
      return false;
    }

    const [arenaStat, decksStat] = await Promise.all([
      fs.stat(arenaLogPath).catch(() => undefined),
      fs.stat(deck.sourcePath).catch(() => undefined)
    ]);
    if (!this.isCurrentSession(sessionContext) || !arenaStat || !decksStat || decksStat.mtimeMs < arenaStat.mtimeMs) {
      return false;
    }
    return this.applyExactArenaDeck(deck, sessionContext);
  }

  private previewCollectionDeck(deck: CollectionDeck, source: "decks-log" | "screen") {
    this.arena.reset();
    const previousState = this.engine.getState();
    if (!this.engine.previewCollectionDeck(deck.id, {
      expectedSize: getConstructedExpectedDeckSize(deck),
      source
    })) {
      return false;
    }

    const keepsAuthoritativeSource =
      source === "screen" &&
      this.collectionDeckPreviewSource === "decks-log" &&
      previousState.autoMatchedDeckId === deck.id;
    this.collectionDeckPreviewSource = keepsAuthoritativeSource ? "decks-log" : source;
    this.constructedScreenMode = getConstructedMode(deck) ?? this.constructedScreenMode;
    this.lastArenaDeckSignature = undefined;
    this.pushState();
    return true;
  }

  private clearCollectionDeckPreview(options: { preserveDecksLog?: boolean } = {}) {
    if (
      options.preserveDecksLog &&
      this.collectionDeckPreviewSource === "decks-log" &&
      this.engine.getState().autoMatchedDeckId
    ) {
      return false;
    }

    const cleared = this.engine.clearCollectionDeckPreview();
    this.collectionDeckPreviewSource = undefined;
    return cleared;
  }

  private resetPendingArenaExit() {
    this.pendingArenaExitDeckKey = undefined;
    this.pendingArenaExitConfirmations = 0;
  }

  private isArenaLog(logPath: string, sessionContext: SessionContext) {
    return sessionOwnsLogPath(sessionContext, logPath, "arena");
  }

  private isDecksLog(logPath: string, sessionContext: SessionContext) {
    return sessionOwnsLogPath(sessionContext, logPath, "decks");
  }

  private isPlayerLog(logPath: string, sessionContext: SessionContext) {
    return sessionOwnsLogPath(sessionContext, logPath, "player");
  }

  private pushState() {
    const state: PublicTrackerState = this.getState();
    const { lastUpdated: _lastUpdated, ...stableState } = state;
    const signature = JSON.stringify(stableState);
    if (signature === this.lastPublishedStateSignature) {
      return;
    }

    let attempted = false;
    for (const window of this.windows) {
      if (!window.isDestroyed()) {
        attempted = true;
        try {
          window.webContents.send("tracker:update", state);
        } catch {
          // A closing renderer must not turn an already-processed log chunk into a retry.
        }
      }
    }
    if (attempted) {
      this.lastPublishedStateSignature = signature;
    }
  }
}

function getArenaRecognitionContext(state: ReturnType<ArenaDraftEngine["getState"]>): string {
  return `${state.status}:${state.draftCount}:${state.picks.length}:${state.currentChoices.map((card) => card.cardId ?? card.name).join("|")}`;
}

async function readFileRange(
  handle: Awaited<ReturnType<typeof fs.open>>,
  offset: number,
  length: number
) {
  const buffer = Buffer.allocUnsafe(length);
  let totalBytesRead = 0;
  while (totalBytesRead < length) {
    const { bytesRead } = await handle.read(
      buffer,
      totalBytesRead,
      length - totalBytesRead,
      offset + totalBytesRead
    );
    if (bytesRead === 0) {
      break;
    }
    totalBytesRead += bytesRead;
  }
  return buffer.subarray(0, totalBytesRead);
}

function splitCompleteLogChunk(previous: Buffer | undefined, chunk: Buffer) {
  const combined = previous?.length ? Buffer.concat([previous, chunk]) : chunk;
  const lastNewline = combined.lastIndexOf(0x0a);
  if (lastNewline < 0) {
    return { text: "", pending: Buffer.from(combined) };
  }

  return {
    text: combined.subarray(0, lastNewline + 1).toString("utf8"),
    pending: Buffer.from(combined.subarray(lastNewline + 1))
  };
}

function detectSupportedTrackerMode(text: string): TrackerMode | undefined {
  const gameTypes = [...text.matchAll(/\bGameType=(GT_[A-Z_]+)\b/gi)];
  const gameType = gameTypes.at(-1)?.[1]?.toUpperCase();
  if (!gameType) return undefined;
  if (gameType.includes("ARENA")) return "arena";
  return gameType === "GT_RANKED" ? "ladder" : undefined;
}

function buildPowerLogRequiredMessage(logPath: string) {
  return `当前只找到 ${path.basename(logPath)}，Player.log 不能显示牌名；需要修复日志并重启炉石，生成同目录 Power.log 后再开始监听。`;
}

function buildMissingPowerLogMessage(logPath: string) {
  return `当前最新炉石日志只有 ${path.basename(logPath)}，没有 Power.log；先点“修复日志”，完全退出并重新打开炉石，然后进入一局。`;
}

function buildWaitingForGameMessage() {
  return "已识别炉石，正在等待开局；开始对局后会自动连接 Power.log。";
}

async function readLatestLoadingScreenMode(logPath: string | undefined) {
  if (!logPath) {
    return undefined;
  }

  const content = await fs.readFile(logPath, "utf8").catch(() => "");
  let latestCurrentMode: string | undefined;
  for (const match of content.matchAll(/\bcurrMode=([A-Z_]+)\b/gi)) {
    latestCurrentMode = match[1]?.toUpperCase();
  }
  if (latestCurrentMode) {
    return latestCurrentMode;
  }

  let latestNextMode: string | undefined;
  for (const match of content.matchAll(/\bnextMode=([A-Z_]+)\b/gi)) {
    latestNextMode = match[1]?.toUpperCase();
  }
  return latestNextMode;
}

function isPowerLogPath(logPath: string | undefined) {
  return Boolean(logPath?.trim().match(/(^|[\\/])Power\.log$/i));
}

function expectedDecksLogPath(sessionDir: string | undefined, discoveredPath: string | undefined) {
  return discoveredPath ?? (sessionDir ? path.join(sessionDir, "Decks.log") : undefined);
}

function isArenaDeckStateLine(line: string) {
  return /SetDraftMode|DraftManager\.OnChoicesAndContents|Client chooses:|DraftManager\.OnRedraftBegin/i.test(line);
}

function resolveMatchEndedAt(resultLine: string, powerLogModifiedAtMs?: number): string | undefined {
  if (powerLogModifiedAtMs === undefined || !Number.isFinite(powerLogModifiedAtMs)) {
    return undefined;
  }
  const modifiedAt = new Date(powerLogModifiedAtMs);
  if (!Number.isFinite(modifiedAt.getTime())) {
    return undefined;
  }

  const timestamp = resultLine.match(/^\s*[A-Z]\s+(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?/i);
  if (!timestamp) {
    // The file mtime is observable source data and is safer than pretending an
    // imported old match ended at the current ingestion time.
    return modifiedAt.toISOString();
  }

  const hour = Number(timestamp[1]);
  const minute = Number(timestamp[2]);
  const second = Number(timestamp[3]);
  const millisecond = Number((timestamp[4] ?? "").padEnd(3, "0").slice(0, 3));
  if (hour > 23 || minute > 59 || second > 59) {
    return modifiedAt.toISOString();
  }

  const endedAt = new Date(
    modifiedAt.getFullYear(),
    modifiedAt.getMonth(),
    modifiedAt.getDate(),
    hour,
    minute,
    second,
    millisecond
  );
  if (endedAt.getTime() > modifiedAt.getTime()) {
    endedAt.setDate(endedAt.getDate() - 1);
  }
  return endedAt.toISOString();
}

function resolveLatestLogEventAt(
  content: string,
  fileModifiedAtMs: number,
  acceptsLine: (line: string) => boolean = () => true
): number | undefined {
  if (!Number.isFinite(fileModifiedAtMs)) {
    return undefined;
  }
  const modifiedAt = new Date(fileModifiedAtMs);
  if (!Number.isFinite(modifiedAt.getTime())) {
    return undefined;
  }

  const lines = content.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (!acceptsLine(line)) {
      continue;
    }
    const timestamp = line.match(/^\s*[A-Z]\s+(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?/i);
    if (!timestamp) {
      continue;
    }

    const hour = Number(timestamp[1]);
    const minute = Number(timestamp[2]);
    const second = Number(timestamp[3]);
    const millisecond = Number((timestamp[4] ?? "").padEnd(3, "0").slice(0, 3));
    if (hour > 23 || minute > 59 || second > 59) {
      continue;
    }

    const eventAt = new Date(
      modifiedAt.getFullYear(),
      modifiedAt.getMonth(),
      modifiedAt.getDate(),
      hour,
      minute,
      second,
      millisecond
    );
    if (eventAt.getTime() - modifiedAt.getTime() > 12 * 60 * 60 * 1_000) {
      eventAt.setDate(eventAt.getDate() - 1);
    }
    return eventAt.getTime();
  }
  return undefined;
}

async function hasUsableArenaLog(arenaLogPath?: string) {
  if (!arenaLogPath) {
    return false;
  }

  const content = await fs.readFile(arenaLogPath, "utf8").catch(() => "");
  return /SetDraftMode\s*-\s*(?:DRAFTING|ACTIVE_DRAFT_DECK|REDRAFTING|IN_REWARDS)\b/i.test(selectCurrentArenaLogText(content));
}

function findFriendlyPlayerId(content: string): number | undefined {
  const players = parsePlayerLog(content).filter((event) => event.type === "player-info");
  const explicitLocal = players.find((event) => event.isLocal);
  if (explicitLocal) {
    return explicitLocal.playerId;
  }

  const namedLocal = players.find((event) => /local|我方|自己/i.test(event.name ?? ""));
  if (namedLocal) {
    return namedLocal.playerId;
  }

  return players.length === 1 ? players[0]?.playerId : undefined;
}

function collectPowerPlayerIdentityEvidence(
  lines: readonly string[],
  explicitLocalPlayerIds: Set<number>,
  playerNames: Map<number, string>
) {
  for (const line of lines) {
    const match = line.match(/\bPlayerID\s*=\s*(\d+)\s*,?\s*PlayerName\s*=\s*(.+?)\s*$/i);
    const playerName = match?.[2]?.trim();
    if (match?.[1] && playerName) {
      const playerId = Number(match[1]);
      playerNames.set(playerId, playerName);
      if (isExplicitLocalPlayer(line, playerName)) {
        explicitLocalPlayerIds.add(playerId);
      }
    }
  }
}

function selectPowerPlayerIdentityLinesBeforeGameStart(lines: readonly string[], gameStartIndex: number) {
  const playerLines: string[] = [];
  for (let index = gameStartIndex - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (/\bPlayerID\s*=\s*\d+\s*,?\s*PlayerName\s*=/i.test(line)) {
      playerLines.unshift(line);
      continue;
    }
    if (line.trim() === "" && playerLines.length === 0) {
      continue;
    }
    break;
  }
  return playerLines;
}

function getPowerLogTimestamp(line: string) {
  return line.match(/^\s*[A-Z]\s+([0-9:.]+)/)?.[1];
}

function resolvePowerFriendlyPlayerId(
  explicitLocalPlayerIds: ReadonlySet<number>,
  playerNames: ReadonlyMap<number, string>
): number | undefined {
  if (explicitLocalPlayerIds.size === 1) {
    return explicitLocalPlayerIds.values().next().value;
  }

  const namedPlayers = [...playerNames].filter(([, name]) => !/^UNKNOWN HUMAN PLAYER$/i.test(name));
  const hiddenPlayers = [...playerNames.values()].filter((name) => /^UNKNOWN HUMAN PLAYER$/i.test(name));
  return namedPlayers.length === 1 && hiddenPlayers.length > 0 ? namedPlayers[0]?.[0] : undefined;
}

function isExplicitLocalPlayer(line: string, playerName: string) {
  return (
    /(?:^|[#\s])(?:local(?:\s*player)?|本地玩家|我方|自己)(?:[#\s]|$)/i.test(playerName) ||
    /\b(?:isLocal|localPlayer)\s*[=:]\s*(?:true|1)\b/i.test(line)
  );
}

function toTrackerCollectionDecks(
  decks: readonly CollectionDeckScanResult["decks"][number][],
  logPath: string
): CollectionDeck[] {
  const fallbackSourcePath = path.join(path.dirname(logPath), "Decks.log");
  return decks.flatMap((deck) => {
    if (!deck.cards || deck.cards.length === 0) {
      return [];
    }

    return [
      {
        id: deck.id,
        deckId: deck.deckId,
        name: deck.name,
        heroClass: deck.heroClass,
        format: deck.format,
        mode: deck.mode,
        cards: deck.cards.map((card) => ({ ...card })),
        rawDeckString: deck.rawDeckString,
        rawText: deck.rawDeckString ?? deck.name ?? deck.id,
        sourcePath: deck.sourcePath ?? fallbackSourcePath,
        updatedAt: deck.updatedAt ?? new Date(0).toISOString(),
        warnings: deck.warnings ?? []
      }
    ];
  });
}

function findTrackerCollectionDeck(decks: readonly CollectionDeck[], activeDeck: CollectionDeck): CollectionDeck | undefined {
  if (activeDeck.id) {
    const byId = decks.find((deck) => deck.id === activeDeck.id);
    if (byId) {
      return mergeActiveDeckMetadata(byId, activeDeck);
    }
  }

  if (activeDeck.deckId) {
    const byDeckId = decks.find((deck) => deck.deckId === activeDeck.deckId);
    if (byDeckId) {
      return mergeActiveDeckMetadata(byDeckId, activeDeck);
    }
  }

  if (activeDeck.rawDeckString) {
    const byCode = decks.find((deck) => deck.rawDeckString === activeDeck.rawDeckString);
    return byCode ? mergeActiveDeckMetadata(byCode, activeDeck) : undefined;
  }

  return undefined;
}

function mergeActiveDeckMetadata(deck: CollectionDeck, activeDeck: CollectionDeck): CollectionDeck {
  return {
    ...deck,
    deckId: activeDeck.deckId ?? deck.deckId,
    name: activeDeck.name ?? deck.name,
    heroClass: activeDeck.heroClass ?? deck.heroClass,
    format: activeDeck.format ?? deck.format,
    mode: activeDeck.mode ?? deck.mode,
    rawDeckString: activeDeck.rawDeckString ?? deck.rawDeckString
  };
}

function getConstructedExpectedDeckSize(deck: CollectionDeck): number | undefined {
  const format = `${deck.format ?? ""} ${deck.mode ?? ""}`.toLocaleLowerCase();
  return /标准|狂野|standard|wild/.test(format) ? 30 : undefined;
}

function isArenaCollectionDeck(deck: CollectionDeck | undefined): deck is CollectionDeck {
  return deck?.mode?.trim().toLocaleLowerCase() === "arena";
}

function createLogFileFingerprint(
  content: Buffer,
  stat: { readonly dev: number; readonly ino: number }
): LogFileFingerprint {
  const sampleLength = Math.min(content.length, 4_096);
  return {
    device: stat.dev,
    inode: stat.ino,
    sampleLength,
    sampleHash: hashBuffer(content.subarray(0, sampleLength))
  };
}

async function hasLogFileFingerprintChanged(
  handle: Awaited<ReturnType<typeof fs.open>>,
  stat: { readonly dev: number; readonly ino: number; readonly size: number },
  previous: LogFileFingerprint | undefined
) {
  if (!previous) {
    return false;
  }
  if (stat.dev !== previous.device || stat.ino !== previous.inode) {
    return true;
  }
  if (previous.sampleLength === 0) {
    return false;
  }
  if (stat.size < previous.sampleLength) {
    return true;
  }

  const currentPrefix = await readFileRange(handle, 0, previous.sampleLength);
  return currentPrefix.length !== previous.sampleLength || hashBuffer(currentPrefix) !== previous.sampleHash;
}

function hashBuffer(content: Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

function getConstructedMode(deck: CollectionDeck): "standard" | "wild" | undefined {
  const format = `${deck.format ?? ""} ${deck.mode ?? ""}`.toLocaleLowerCase();
  if (/标准|standard/.test(format)) {
    return "standard";
  }
  if (/狂野|wild/.test(format)) {
    return "wild";
  }
  return undefined;
}

function constructedScreenRecognitionFailureMessage(status: ArenaScreenRecognitionResult["status"]) {
  if (status === "permission-denied") {
    return "无法识别当前套牌。请在系统设置中允许炉石记牌器录制屏幕。";
  }
  if (status === "window-not-found") {
    return "没有找到炉石窗口，已清除上一次套牌。";
  }
  return "当前套牌识别失败，已清除上一次套牌，请回到炉石后重试。";
}
