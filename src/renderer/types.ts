import type {
  CardDatabaseRefreshResult,
  CardLibraryQuery,
  CardLibraryResult,
  CardPreviewRequest,
  CollectionDeckScanResult,
  DeckIdentitySource,
  LogCandidate,
  PublicCardZone,
  PublicDeckInsertionTracking,
  PublicLogConfigStatus,
  PublicTrackingConfidence,
  PublicTrackingStatus,
  PublicTrackerState,
  OpponentHandEntry,
  TurnTimerState,
  TrackerSettings
} from "../shared/types";
import type { CardDetails } from "../shared/cardDatabase";
import type { ArenaCardRating, ArenaScoreQuality } from "../shared/arenaRatings";
import type { CSSProperties } from "react";
import type { LadderDeckRecommendationResult, LadderMode } from "../shared/ladderDeckRecommendation";
import type { ArenaHeroWinRateRankingResult } from "../shared/arenaHeroStats";
import type { HomeNewsResult } from "../shared/homeNews";
import type { ArenaInsightsResult, ArenaReward, ArenaRunRecord } from "../shared/arenaInsights";
import type { CollectionInsightsResult, CollectionSnapshot, CosmeticItem, PackOpeningRecord } from "../shared/collectionInsights";
import type { AppPermissionId, AppPermissionSummary } from "../shared/appPermissions";

export type { ArenaInsightsResult, ArenaReward, ArenaRunRecord } from "../shared/arenaInsights";
export type { CollectionInsightsResult, CollectionSnapshot, CosmeticItem, PackOpeningRecord } from "../shared/collectionInsights";

export type { CardLibraryQuery, CardLibraryResult };

export interface HearthstoneTrackerApi {
  discoverLogs: () => Promise<LogCandidate[]>;
  selectLogPath: () => Promise<string | undefined>;
  start: (options?: { logPath?: string; deckText?: string }) => Promise<PublicTrackerState>;
  pause: () => Promise<PublicTrackerState>;
  importDeck: (deckText: string) => Promise<PublicTrackerState>;
  scanCollectionDecks?: () => Promise<CollectionDeckScanResult>;
  importCollectionDeck?: (deckId: string) => Promise<PublicTrackerState>;
  ensureLogConfig: () => Promise<PublicLogConfigStatus>;
  inspectLogConfig: () => Promise<PublicLogConfigStatus>;
  toggleOverlay: () => Promise<boolean>;
  closeFriendlyOverlay?: () => Promise<void>;
  toggleOpponentOverlay?: () => Promise<boolean>;
  getOpponentOverlayCollapsed?: () => Promise<boolean>;
  setOpponentOverlayCollapsed?: (collapsed: boolean) => Promise<boolean>;
  onOpponentOverlayCollapsedChange?: (callback: (collapsed: boolean) => void) => () => void;
  getSecretOverlayCollapsed?: () => Promise<boolean>;
  setSecretOverlayCollapsed?: (collapsed: boolean) => Promise<boolean>;
  setAuxiliaryOverlayMouseInteractive?: (interactive: boolean) => Promise<void>;
  beginAuxiliaryOverlayDrag?: (point: { readonly x: number; readonly y: number }) => Promise<void>;
  moveAuxiliaryOverlayDrag?: (point: { readonly x: number; readonly y: number }) => Promise<void>;
  endAuxiliaryOverlayDrag?: (point: { readonly x: number; readonly y: number }) => Promise<void>;
  minimizeMain?: () => Promise<boolean>;
  listCardLibrary?: (query: CardLibraryQuery) => Promise<CardLibraryResult>;
  showCardPreview?: (request: CardPreviewRequest) => Promise<void>;
  hideCardPreview?: () => Promise<void>;
  onCardPreviewUpdate?: (callback: (details: CardDetails) => void) => () => void;
  onCardPreviewPinnedChange?: (callback: (pinned: boolean) => void) => () => void;
  getMatchHistory?: () => Promise<import("../shared/types").MatchHistoryResult>;
  getArenaInsights?: () => Promise<ArenaInsightsResult>;
  recordArenaRewards?: (runId: string, rewards: readonly ArenaReward[]) => Promise<ArenaRunRecord>;
  importArenaRuns?: (runs: readonly ArenaRunRecord[]) => Promise<readonly ArenaRunRecord[]>;
  exportArenaRuns?: () => Promise<readonly ArenaRunRecord[]>;
  getCollectionInsights?: () => Promise<CollectionInsightsResult>;
  importCollectionSnapshot?: (snapshot: CollectionSnapshot) => Promise<CollectionSnapshot>;
  importCollectionCsv?: (csvText: string) => Promise<CollectionSnapshot>;
  recordPackOpening?: (pack: PackOpeningRecord) => Promise<CollectionSnapshot>;
  updateCosmetics?: (cosmetics: {
    readonly cardBacks?: readonly CosmeticItem[];
    readonly heroSkins?: readonly CosmeticItem[];
    readonly coins?: readonly CosmeticItem[];
  }) => Promise<CollectionSnapshot>;
  getHomeNews?: () => Promise<HomeNewsResult>;
  getArenaHeroWinRateRanking?: () => Promise<ArenaHeroWinRateRankingResult>;
  openHomeNewsItem?: (itemId: string) => Promise<void>;
  getTrackerSettings?: () => Promise<TrackerSettings>;
  setTrackerSettings?: (settings: TrackerSettings) => Promise<TrackerSettings>;
  restoreDefaultSettings?: () => Promise<TrackerSettings>;
  openLogFolder?: () => Promise<void>;
  refreshCardDatabase?: () => Promise<CardDatabaseRefreshResult>;
  openSettings?: () => Promise<boolean>;
  getAppPermissions?: () => Promise<AppPermissionSummary>;
  requestAppPermission?: (permissionId: AppPermissionId) => Promise<AppPermissionSummary>;
  onOpenSettings?: (callback: () => void) => () => void;
  onTrackerSettingsUpdate?: (callback: (settings: TrackerSettings) => void) => () => void;
  getState: () => Promise<PublicTrackerState>;
  getLadderDeckRecommendation?: (mode: LadderMode) => Promise<LadderDeckRecommendationResult>;
  copyLadderDeckCode?: (deckCode: string) => Promise<void>;
  closeLadderDeckOverlay?: () => Promise<void>;
  onLadderDeckRecommendationUpdate?: (callback: (mode: LadderMode, result: LadderDeckRecommendationResult) => void) => () => void;
  onArenaHeroWinRateRankingUpdate?: (callback: (result: ArenaHeroWinRateRankingResult) => void) => () => void;
  closeArenaHeroWinRateRanking?: () => Promise<void>;
  onUpdate: (callback: (state: PublicTrackerState) => void) => () => void;
}

export interface TrackerStatus {
  state: "ready" | "tracking" | "paused" | "offline";
  isLoading: boolean;
  logPath: string;
  watchedFiles: number;
  eventCount: number;
  lastSyncedAt: string;
}

export interface DeckSummary {
  deckName: string;
  totalCards: number;
  remainingCards: number;
}

export interface DeckCard {
  id: string;
  name: string;
  cost?: number;
  cardType: string;
  drawn: number;
  copiesRemaining: number;
  copiesTotal: number;
  details?: CardDetails;
  unresolved?: true;
}

export type GameEventKind = "draw" | "play" | "mulligan" | "secret" | "turn" | "log" | "warning";

export interface GameEvent {
  id: string;
  kind: GameEventKind;
  actor: "me" | "opponent" | "system";
  turn?: number;
  timestamp: string;
  title: string;
  detail: string;
}

export interface OpponentOverview {
  heroClass: string;
  currentTurn?: number;
  handSize?: number;
  deckRemaining?: number;
  secretsInPlay?: number;
  fatigueDamage?: number;
  lastAction: string;
}

export interface OpponentPlayedCard {
  id: string;
  name?: string;
  hidden: boolean;
  cost?: number;
  turn?: number;
  count: number;
  details?: CardDetails;
}

export type OverlayStatusTone = "ready" | "tracking" | "paused" | "offline" | "error";

export interface OverlayCardItem {
  id: string;
  name: string;
  cost?: number;
  count?: number;
  pickRate?: number;
  deckImpact?: number;
  detail?: string;
  thumbnailUrl?: string;
  details?: CardDetails;
  unresolved?: true;
}

export interface OverlayHistoryItem {
  readonly id: string;
  readonly sequence: number;
  readonly turn?: number;
  readonly displayName?: string;
  readonly cardId?: string;
  readonly hidden: boolean;
  readonly confidence: PublicTrackingConfidence;
  readonly details?: CardDetails;
}

export interface OverlayCardZoneView {
  readonly key: PublicCardZone;
  readonly status: PublicTrackingStatus;
  readonly knownCount: number;
  readonly totalCount?: number;
  readonly countLabel: string;
  readonly cards: readonly OverlayCardItem[];
}

export interface OverlayCardHistoryView {
  readonly key: "burned" | "used";
  readonly totalCount: number;
  readonly countLabel: string;
  readonly truncated: boolean;
  readonly items: readonly OverlayHistoryItem[];
}

export interface OverlayCardTrackingView {
  readonly status: "ready";
  readonly gameKey: string;
  readonly side: "friendly" | "opponent";
  readonly current: Readonly<Record<PublicCardZone, OverlayCardZoneView>>;
  readonly burned: OverlayCardHistoryView;
  readonly used: OverlayCardHistoryView;
  readonly secretSlots: readonly OverlaySecretSlot[];
  readonly deckInsertions?: PublicDeckInsertionTracking;
}

export interface OverlayStatusView {
  tone: OverlayStatusTone;
  label: string;
  detail: string;
  updatedAtLabel: string;
}

export interface OverlayDeckSummary {
  totalCards: number;
  remainingCards?: number;
  drawnCards: number;
}

export type OverlayDeckIdentityStatus = "confirmed" | "candidates" | "automatic" | "waiting" | "arena";

export interface OverlayDeckIdentity {
  name: string;
  compactName?: string;
  status: OverlayDeckIdentityStatus;
  source?: DeckIdentitySource;
  candidateCount?: number;
  detail: string;
  compactDetail?: string;
}

export interface OverlayArenaChoice {
  id: string;
  name: string;
  score?: number;
  thumbnailUrl?: string;
  details?: CardDetails;
  quality?: ArenaScoreQuality;
  rating?: ArenaCardRating;
  ratingSummary?: string;
}

export interface OverlayArenaView {
  isChoosing: boolean;
  showDeckStats: boolean;
  statusLabel: string;
  progress: string;
  confirmedCount: number;
  unresolvedCount: number;
  hero: string;
  scoreSource?: string;
  error?: string;
  choices: OverlayArenaChoice[];
  deck: OverlayCardItem[];
  deckCount: number;
  lastPick?: OverlayArenaChoice;
}

export interface OverlaySecretCandidate {
  id: string;
  name: string;
  status: "possible" | "excluded";
  exclusionReason?:
    | "spell-played-without-trigger"
    | "minion-played-without-trigger"
    | "hero-attacked-without-trigger";
  details?: CardDetails;
}

export interface OverlaySecretSlot {
  id: string;
  label: string;
  candidates: OverlaySecretCandidate[];
}

export interface OverlayBoardAttack {
  friendly: number;
  opponent: number;
}

export interface OverlaySmartCounter {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly target?: number;
  readonly side?: "friendly" | "opponent";
  readonly cardId?: string;
  readonly imageUrl?: string;
  readonly details?: CardDetails;
}

export interface OverlayPublicMatchCounters {
  nextFatigueDamage?: number;
  corpses?: number;
  spellsPlayed?: number;
}

export type OpponentHandTimelineEntry = OpponentHandEntry;

export type OpponentTurnTimer = TurnTimerState;

export interface MatchPulseView {
  readonly turn?: number;
  readonly activeSide?: "friendly" | "opponent";
  readonly fullLabel?: string;
  readonly compactLabel?: string;
  readonly actorLabel?: string;
}

export interface OverlayPanelViewModel {
  cardTracking: OverlayCardTrackingView;
  summary: OverlayDeckSummary;
  deckIdentity: OverlayDeckIdentity;
  remainingDeck: OverlayCardItem[];
  recentDraws: OverlayCardItem[];
  globalEffects?: OverlayCardItem[];
  opponentGlobalEffects?: OverlayCardItem[];
  boardAttack?: OverlayBoardAttack;
  friendlyCounters?: OverlayPublicMatchCounters;
  opponentCounters?: OverlayPublicMatchCounters;
  matchPulse?: MatchPulseView;
  opponentHand?: readonly OpponentHandTimelineEntry[];
  turnTimer?: OpponentTurnTimer;
  status: OverlayStatusView;
  arena?: OverlayArenaView;
}

export interface OverlayPanelProps {
  view: OverlayPanelViewModel;
  className?: string;
  style?: CSSProperties;
  onClose?: () => void;
  onOpenSettings?: () => void;
  isLoading?: boolean;
  loadError?: string;
}

export interface OpponentOverlayPanelProps {
  view: OverlayPanelViewModel;
  className?: string;
  style?: CSSProperties;
  isCollapsed: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  isLoading?: boolean;
  loadError?: string;
}

declare global {
  interface Window {
    hearthstoneTracker?: HearthstoneTrackerApi;
  }
}
