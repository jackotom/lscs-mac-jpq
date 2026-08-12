import { contextBridge, ipcRenderer } from "electron";
import type {
  CardDatabaseRefreshResult,
  CollectionDeckScanResult,
  CardLibraryQuery,
  CardLibraryResult,
  CardPreviewRequest,
  LogCandidate,
  MatchHistoryResult,
  PublicLogConfigStatus,
  PublicTrackerState,
  TrackerSettings
} from "../shared/types.js";
import type { ArenaHeroWinRateRankingResult } from "../shared/arenaHeroStats.js";
import type { CardDetails } from "../shared/cardDatabase.js";
import type { LadderDeckRecommendationResult, LadderMode } from "../shared/ladderDeckRecommendation.js";
import type { HomeNewsResult } from "../shared/homeNews.js";

type PreloadCapability = "main" | "tracker-overlay" | "opponent-overlay" | "state-display" | "card-preview" | "ladder-deck" | "arena-hero-ranking";

function getPreloadCapability(search: string): PreloadCapability {
  const params = new URLSearchParams(search);
  if (params.get("card-preview") === "1") return "card-preview";
  if (params.get("ladder-deck-overlay") === "1") return "ladder-deck";
  if (params.get("arena-hero-ranking-overlay") === "1") return "arena-hero-ranking";
  if (
    params.get("board-attack-overlay") === "1" ||
    params.get("arena-choice-overlay") === "1" ||
    params.get("friendly-attack-overlay") === "1" ||
    params.get("opponent-attack-overlay") === "1" ||
    params.get("secret-overlay") === "1" ||
    params.get("smart-counter-overlay") === "1"
  ) return "state-display";
  if (params.get("opponent-overlay") === "1") return "opponent-overlay";
  if (params.get("overlay") === "1") return "tracker-overlay";
  return "main";
}

const stateDisplayApi = {
  getState: () => ipcRenderer.invoke("tracker:get-state") as Promise<PublicTrackerState>,
  onUpdate: (callback: (state: PublicTrackerState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: PublicTrackerState) => callback(state);
    ipcRenderer.on("tracker:update", listener);
    return () => ipcRenderer.removeListener("tracker:update", listener);
  }
};

const cardPreviewSourceApi = {
  showCardPreview: (request: CardPreviewRequest) =>
    ipcRenderer.invoke("tracker:show-card-preview", request) as Promise<void>,
  hideCardPreview: () => ipcRenderer.invoke("tracker:hide-card-preview") as Promise<void>,
  onCardPreviewPinnedChange: (callback: (pinned: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, pinned: boolean) => callback(pinned);
    ipcRenderer.on("tracker:card-preview:pinned", listener);
    return () => ipcRenderer.removeListener("tracker:card-preview:pinned", listener);
  }
};

const friendlyOverlayLifecycleApi = {
  closeFriendlyOverlay: () => ipcRenderer.invoke("tracker:close-friendly-overlay") as Promise<void>
};

const settingsReaderApi = {
  getTrackerSettings: () => ipcRenderer.invoke("tracker:get-settings") as Promise<TrackerSettings>,
  onTrackerSettingsUpdate: (callback: (settings: TrackerSettings) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: TrackerSettings) => callback(settings);
    ipcRenderer.on("tracker:settings:update", listener);
    return () => ipcRenderer.removeListener("tracker:settings:update", listener);
  }
};

const settingsApi = {
  ...settingsReaderApi,
  setTrackerSettings: (settings: TrackerSettings) =>
    ipcRenderer.invoke("tracker:replace-settings", settings) as Promise<TrackerSettings>,
  restoreDefaultSettings: () => ipcRenderer.invoke("tracker:restore-default-settings") as Promise<TrackerSettings>,
  openLogFolder: () => ipcRenderer.invoke("tracker:open-log-folder") as Promise<void>,
  refreshCardDatabase: () => ipcRenderer.invoke("tracker:refresh-card-database") as Promise<CardDatabaseRefreshResult>,
  openSettings: () => ipcRenderer.invoke("tracker:open-settings") as Promise<boolean>
};

const arenaHeroRankingApi = {
  onArenaHeroWinRateRankingUpdate: (callback: (result: ArenaHeroWinRateRankingResult) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, result: ArenaHeroWinRateRankingResult) => callback(result);
    ipcRenderer.on("tracker:arena-hero-win-rate-ranking:update", listener);
    return () => ipcRenderer.removeListener("tracker:arena-hero-win-rate-ranking:update", listener);
  },
  closeArenaHeroWinRateRanking: () =>
    ipcRenderer.invoke("tracker:close-arena-hero-win-rate-ranking") as Promise<void>
};

const mainApi = {
  ...stateDisplayApi,
  ...cardPreviewSourceApi,
  ...settingsApi,
  ...arenaHeroRankingApi,
  onOpenSettings: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("tracker:open-settings", listener);
    return () => ipcRenderer.removeListener("tracker:open-settings", listener);
  },
  getMatchHistory: () => ipcRenderer.invoke("tracker:get-match-history") as Promise<MatchHistoryResult>,
  getHomeNews: () => ipcRenderer.invoke("tracker:get-home-news") as Promise<HomeNewsResult>,
  getArenaHeroWinRateRanking: () =>
    ipcRenderer.invoke("tracker:get-arena-hero-win-rate-ranking") as Promise<ArenaHeroWinRateRankingResult>,
  openHomeNewsItem: (itemId: string) =>
    ipcRenderer.invoke("tracker:open-home-news-item", itemId) as Promise<void>,
  discoverLogs: () => ipcRenderer.invoke("tracker:discover-logs") as Promise<LogCandidate[]>,
  selectLogPath: () => ipcRenderer.invoke("tracker:select-log-path") as Promise<string | undefined>,
  start: (options?: { logPath?: string; deckText?: string }) =>
    ipcRenderer.invoke("tracker:start", options) as Promise<PublicTrackerState>,
  pause: () => ipcRenderer.invoke("tracker:pause") as Promise<PublicTrackerState>,
  importDeck: (deckText: string) => ipcRenderer.invoke("tracker:import-deck", deckText) as Promise<PublicTrackerState>,
  scanImportCollectionDecks: (options?: { logPath?: string }) =>
    ipcRenderer.invoke("tracker:scan-import-collection-decks", options) as Promise<CollectionDeckScanResult>,
  scanCollectionDecks: () =>
    ipcRenderer.invoke("tracker:scan-import-collection-decks") as Promise<CollectionDeckScanResult>,
  importCollectionDeck: (deckId: string) =>
    ipcRenderer.invoke("tracker:import-collection-deck", deckId) as Promise<PublicTrackerState>,
  ensureLogConfig: () => ipcRenderer.invoke("tracker:ensure-log-config") as Promise<PublicLogConfigStatus>,
  inspectLogConfig: () => ipcRenderer.invoke("tracker:inspect-log-config") as Promise<PublicLogConfigStatus>,
  toggleOverlay: () => ipcRenderer.invoke("tracker:toggle-overlay") as Promise<boolean>,
  toggleOpponentOverlay: () => ipcRenderer.invoke("tracker:toggle-opponent-overlay") as Promise<boolean>,
  getOpponentOverlayCollapsed: () =>
    ipcRenderer.invoke("tracker:get-opponent-overlay-collapsed") as Promise<boolean>,
  setOpponentOverlayCollapsed: (collapsed: boolean) =>
    ipcRenderer.invoke("tracker:set-opponent-overlay-collapsed", collapsed) as Promise<boolean>,
  onOpponentOverlayCollapsedChange: (callback: (collapsed: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, collapsed: boolean) => callback(collapsed);
    ipcRenderer.on("tracker:opponent-overlay-collapsed:update", listener);
    return () => {
      ipcRenderer.removeListener("tracker:opponent-overlay-collapsed:update", listener);
    };
  },
  minimizeMain: () => ipcRenderer.invoke("tracker:minimize-main") as Promise<boolean>,
  listCardLibrary: (query?: CardLibraryQuery) =>
    ipcRenderer.invoke("tracker:list-card-library", query) as Promise<CardLibraryResult>,
  onCardPreviewUpdate: (callback: (details: CardDetails) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, details: CardDetails) => callback(details);
    ipcRenderer.on("tracker:card-preview:update", listener);
    return () => {
      ipcRenderer.removeListener("tracker:card-preview:update", listener);
    };
  },
  getLadderDeckRecommendation: (mode: LadderMode) =>
    ipcRenderer.invoke("tracker:get-ladder-deck-recommendation", mode) as Promise<LadderDeckRecommendationResult>,
  copyLadderDeckCode: (deckCode: string) => ipcRenderer.invoke("tracker:copy-ladder-deck-code", deckCode) as Promise<void>,
  closeLadderDeckOverlay: () => ipcRenderer.invoke("tracker:close-ladder-deck-overlay") as Promise<void>,
  onLadderDeckRecommendationUpdate: (callback: (mode: LadderMode, result: LadderDeckRecommendationResult) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, mode: LadderMode, result: LadderDeckRecommendationResult) => callback(mode, result);
    ipcRenderer.on("tracker:ladder-deck-recommendation:update", listener);
    return () => ipcRenderer.removeListener("tracker:ladder-deck-recommendation:update", listener);
  }
};

const capability = getPreloadCapability(window.location.search);
const api = capability === "state-display"
  ? { ...stateDisplayApi, ...settingsReaderApi }
  : capability === "arena-hero-ranking"
    ? { ...arenaHeroRankingApi, ...settingsReaderApi }
  : capability === "tracker-overlay"
    ? {
        ...stateDisplayApi,
        ...settingsReaderApi,
        ...cardPreviewSourceApi,
        openSettings: mainApi.openSettings,
        ...friendlyOverlayLifecycleApi
      }
    : capability === "opponent-overlay"
      ? {
          ...stateDisplayApi,
          ...settingsReaderApi,
          ...cardPreviewSourceApi,
          openSettings: mainApi.openSettings,
          getOpponentOverlayCollapsed: mainApi.getOpponentOverlayCollapsed,
          setOpponentOverlayCollapsed: mainApi.setOpponentOverlayCollapsed,
          onOpponentOverlayCollapsedChange: mainApi.onOpponentOverlayCollapsedChange
        }
      : capability === "card-preview"
        ? {
            ...settingsReaderApi,
            onCardPreviewUpdate: mainApi.onCardPreviewUpdate,
            onCardPreviewPinnedChange: mainApi.onCardPreviewPinnedChange
          }
        : capability === "ladder-deck"
          ? {
              ...settingsReaderApi,
              getLadderDeckRecommendation: mainApi.getLadderDeckRecommendation,
              copyLadderDeckCode: mainApi.copyLadderDeckCode,
              closeLadderDeckOverlay: mainApi.closeLadderDeckOverlay,
              onLadderDeckRecommendationUpdate: mainApi.onLadderDeckRecommendationUpdate
            }
          : mainApi;

contextBridge.exposeInMainWorld("hearthstoneTracker", api);

export type HearthstoneTrackerApi = typeof mainApi & Partial<typeof friendlyOverlayLifecycleApi>;
