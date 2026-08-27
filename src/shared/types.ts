import type {
  CardDetails,
  CardOutcomeSection,
  GameContextSection,
  RelatedCardInfo
} from "./cardDatabase.js";
import type { ArenaCardRating, ArenaScoreQuality } from "./arenaRatings.js";

export type Zone = "DECK" | "HAND" | "PLAY" | "GRAVEYARD" | "REMOVEDFROMGAME" | "SETASIDE" | "SECRET" | "UNKNOWN";

export type EventKind =
  | "game-start"
  | "game-end"
  | "draw"
  | "friendly-play"
  | "opponent-play"
  | "arena-pick"
  | "zone-change"
  | "info";

export interface DeckCard {
  name: string;
  count: number;
  cardId?: string;
  rawLine?: string;
  details?: CardDetails;
  unresolved?: true;
  pickRate?: number;
  deckImpact?: number;
}

export interface DeckImport {
  cards: DeckCard[];
  rawCode?: string;
  warnings: string[];
}

export interface CardTrackerRow {
  name: string;
  count: number;
  remaining: number;
  drawn: number;
  played: number;
  cardId?: string;
  details?: CardDetails;
  unresolved?: true;
}

export interface TrackerZoneCard {
  name: string;
  count: number;
  cardId?: string;
  details?: CardDetails;
}

export type TrackerMode = "ladder" | "arena";

export interface TrackerModeSettings {
  readonly friendlyDeckTracker: boolean;
  readonly opponentDeckTracker: boolean;
}

export const TRACKER_ACCENT_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#14b8a6",
  "#b7791f",
  "#f59e0b",
  "#ef4444"
] as const;

export type TrackerAccentColor = typeof TRACKER_ACCENT_COLORS[number];

export interface TrackerGeneralSettings {
  readonly launchAtLogin: boolean;
  readonly startMinimized: boolean;
  readonly showGameStatusIcon: boolean;
  readonly minimizeToMenuBar: boolean;
  readonly focusOnOpen: boolean;
  readonly gameDetection: "automatic" | "manual";
  readonly gameLanguage: "zh-CN" | "zh-TW" | "en-US";
  readonly windowMatching: "smart" | "title" | "process";
}

export interface TrackerOverlaySettings {
  readonly enabled: boolean;
  readonly showOnlyInGame: boolean;
  readonly theme: "light" | "dark";
  readonly arenaHeroWinRateRanking: boolean;
  readonly showFriendlyAttack: boolean;
  readonly showOpponentAttack: boolean;
  readonly secretPrediction: boolean;
  readonly smartCardCounters: boolean;
  readonly healthChange: boolean;
  readonly hiddenSmartCounterIds?: readonly string[];
  readonly position: "left" | "right";
  readonly offsetX: number;
  readonly offsetY: number;
  readonly opacity: number;
  readonly hideInFullscreen: boolean;
}

export type SmartCardCounterSide = "friendly" | "opponent";

export interface SmartCardCounter {
  readonly id: string;
  readonly ruleId?: string;
  readonly side: SmartCardCounterSide;
  readonly label: string;
  readonly value: number;
  readonly target?: number;
  readonly scope?: "current-turn" | "previous-turn";
  readonly cardId?: string;
  readonly details?: CardDetails;
}

export interface TrackerAppearanceSettings {
  readonly theme: "dark" | "light" | "system";
  readonly accentColor: TrackerAccentColor;
  readonly fontSize: "small" | "medium" | "large";
  readonly zoom: number;
  readonly animations: boolean;
  readonly cardImageQuality: "low" | "high";
}

export interface TrackerOtherSettings {
  readonly autoUpdateCards: boolean;
  readonly updateFrequency: "daily" | "weekly" | "manual";
  readonly matchRetentionDays: 30 | 90 | 180;
  readonly notifyUpdates: boolean;
  readonly notifyAnnouncements: boolean;
  readonly verboseLogs: boolean;
}

export interface TrackerSettings {
  readonly ladder: TrackerModeSettings;
  readonly arena: TrackerModeSettings;
  readonly general: TrackerGeneralSettings;
  readonly overlay: TrackerOverlaySettings;
  readonly appearance: TrackerAppearanceSettings;
  readonly other: TrackerOtherSettings;
}

export type CardDatabaseRefreshResult =
  | {
      readonly status: "updated" | "stale";
      readonly cardCount: number;
      readonly source?: string;
      readonly version?: string;
      readonly warnings: readonly string[];
    }
  | {
      readonly status: "error";
      readonly error: string;
      readonly warnings: readonly string[];
    };

export interface TrackerEvent {
  id: string;
  at: string;
  kind: EventKind;
  player: "friendly" | "opponent" | "unknown";
  turn?: number;
  cardName?: string;
  fromZone?: Zone;
  toZone?: Zone;
  raw?: string;
  cardId?: string;
}

export interface TrackerSummary {
  totalCards: number;
  remainingCards: number;
  drawnCards: number;
  opponentPlayedCount: number;
}

export interface PlayerMatchCounters {
  readonly nextFatigueDamage?: number;
  readonly corpses?: number;
  readonly spellsPlayed?: number;
}

export interface MatchCounters {
  readonly friendly: PlayerMatchCounters;
  readonly opponent: PlayerMatchCounters;
}

export type MatchFlowPhase = "mulligan" | "start" | "action" | "end";

export interface PlayerTurnState {
  readonly turn?: number;
  readonly mana?: number;
  readonly manaUsed?: number;
}

export interface MatchFlowSnapshot {
  readonly globalTurn?: number;
  readonly activeSide?: "friendly" | "opponent";
  readonly phase?: MatchFlowPhase;
  readonly friendly?: PlayerTurnState;
  readonly opponent?: PlayerTurnState;
}

export type MatchResult = "win" | "loss" | "tie";

export type MatchMode = "standard" | "wild" | "arena" | "unknown";

export interface MatchRecord {
  readonly id: string;
  readonly result: MatchResult;
  readonly mode: MatchMode;
  readonly deckName?: string;
  readonly endedAt: string;
}

export interface MatchHistorySummary {
  readonly total: number;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly winRate: number;
}

export type MatchHistoryResult =
  | {
      readonly status: "ok";
      readonly matches: readonly MatchRecord[];
      readonly summary: MatchHistorySummary;
    }
  | {
      readonly status: "error";
      readonly error: string;
    };

export type ArenaStatus = "inactive" | "drafting" | "redrafting" | "complete" | "playing";

export interface ArenaCardChoice {
  readonly name: string;
  readonly count: number;
  readonly screenSlot?: number;
  readonly cardId?: string;
  readonly entityId?: string;
  readonly score?: number;
  readonly scoreSource?: string;
  readonly details?: CardDetails;
  readonly quality?: ArenaScoreQuality;
  readonly rating?: ArenaCardRating;
}

export interface ArenaHero {
  readonly name: string;
  readonly cardId?: string;
  readonly className?: string;
}

export interface ArenaPick {
  readonly slot: number;
  readonly chosen: ArenaCardChoice;
  readonly offered: readonly ArenaCardChoice[];
  readonly at: string;
}

export interface ArenaState {
  readonly status: ArenaStatus;
  readonly deckId?: string;
  readonly redraftGenerationId?: string;
  readonly hero?: ArenaHero;
  readonly currentChoices: readonly ArenaCardChoice[];
  readonly picks: readonly ArenaPick[];
  readonly deck: readonly DeckCard[];
  readonly redraftPool?: readonly DeckCard[];
  readonly redraftTrackerDeck?: readonly DeckCard[];
  readonly awaitingExactDeck?: boolean;
  readonly pendingRedraftChoices?: readonly ArenaCardChoice[];
  readonly draftCount: number;
  readonly unresolvedCount: number;
  readonly scoreSource?: string;
  readonly ratingsVersion?: number;
  readonly lastUpdated?: string;
  readonly error?: string;
}

export type PublicCardZone =
  | "deck"
  | "hand"
  | "play"
  | "secret"
  | "graveyard"
  | "removed";

export type PublicTrackingStatus = "known" | "partial" | "unknown";
export type PublicTrackingConfidence = "confirmed" | "inferred";

export interface PublicKnownCard {
  readonly cardKey: string;
  readonly cardId?: string;
  readonly name: string;
  readonly count: number;
}

export interface PublicCardZoneGroup {
  readonly status: PublicTrackingStatus;
  readonly knownCount: number;
  readonly totalCount?: number;
  readonly cards: readonly PublicKnownCard[];
}

export interface PublicCardHistoryItem {
  readonly id: string;
  readonly sequence: number;
  readonly entityId: string;
  readonly turn?: number;
  readonly card?: Omit<PublicKnownCard, "count">;
  readonly confidence: PublicTrackingConfidence;
  readonly outcomeSections?: readonly CardOutcomeSection[];
}

export interface PublicCardHistoryGroup {
  readonly totalCount: number;
  readonly items: readonly PublicCardHistoryItem[];
  readonly truncated: boolean;
}

export interface PublicPlayerCardTracking {
  readonly current: Readonly<Record<PublicCardZone, PublicCardZoneGroup>>;
  readonly burned: PublicCardHistoryGroup;
  readonly used: PublicCardHistoryGroup;
}

export interface PublicCardContextDetails {
  readonly gameContextSections?: readonly GameContextSection[];
  readonly playedSpellsThisGame?: readonly RelatedCardInfo[];
  readonly playedSpellsThisGameCount?: number;
  readonly playedSpellsThisGameIncomplete?: boolean;
}

export interface PublicDeckInsertionGroup {
  readonly sourceEntityId: string;
  readonly sourceName: string;
  readonly remainingCount: number;
}

export interface PublicDeckPlacement {
  readonly entityId: string;
  readonly position: "top" | "bottom";
  readonly cardName?: string;
  readonly cardId?: string;
}

export interface PublicDeckInsertionTracking {
  readonly groups: readonly PublicDeckInsertionGroup[];
  readonly placements: readonly PublicDeckPlacement[];
}

export interface PublicCardTracking {
  readonly schemaVersion: 1;
  readonly gameKey: string;
  readonly friendly: PublicPlayerCardTracking;
  readonly opponent: PublicPlayerCardTracking;
  readonly opponentSecretSlots: readonly OpponentSecretSlot[];
  readonly detailsByCardKey: Readonly<Record<string, CardDetails>>;
  readonly contextDetailsBySideAndCardKey: Readonly<{
    friendly: Readonly<Record<string, PublicCardContextDetails>>;
    opponent: Readonly<Record<string, PublicCardContextDetails>>;
  }>;
  readonly deckInsertions?: Readonly<{
    friendly: PublicDeckInsertionTracking;
    opponent: PublicDeckInsertionTracking;
  }>;
}

export const LEGACY_USED_ROWS_KEY: "opponentPlayed" = "opponentPlayed";
export const LEGACY_USED_COUNT_KEY: "opponentPlayedCount" = "opponentPlayedCount";

export type DeckIdentitySource = "decks-log" | "screen" | "inferred";
export type DeckIdentityStatus = "confirmed" | "probable" | "waiting";

export interface DeckIdentityEvidence {
  readonly status: DeckIdentityStatus;
  readonly source: DeckIdentitySource;
  readonly deckId?: string;
  readonly observedDistinctCards: number;
  readonly candidateCount: number;
  readonly bestScore: number;
  readonly scoreLead: number;
}

export interface OpponentHandEntry {
  readonly entityId?: string;
  readonly cardId?: string;
  readonly name?: string;
  readonly drawnTurn?: number;
  readonly created?: boolean;
  readonly forged?: boolean;
  readonly buffs?: readonly string[];
  /** One physical hand entity. Kept for one compatibility version. */
  readonly count?: number;
  readonly details?: CardDetails;
}

export interface TurnTimerState {
  readonly turn?: number;
  readonly activeSide?: "friendly" | "opponent";
  readonly startedAt?: string;
  readonly durationSeconds: number;
}

export interface PublicTrackerState {
  status: "idle" | "watching" | "paused" | "missing-log" | "error";
  trackerMode?: TrackerMode;
  gameActive?: boolean;
  logPath?: string;
  arenaLogPath?: string;
  constructedScreenMode?: "standard" | "wild";
  deckCode?: string;
  deckName?: string;
  autoMatchedDeckId?: string;
  deckIdentity?: DeckIdentityEvidence;
  deck: CardTrackerRow[];
  friendlyHand?: TrackerZoneCard[];
  friendlyOther?: TrackerZoneCard[];
  opponentDeck?: TrackerZoneCard[];
  opponentHand?: OpponentHandEntry[];
  opponentOther?: TrackerZoneCard[];
  globalEffects?: TrackerZoneCard[];
  opponentGlobalEffects?: TrackerZoneCard[];
  opponentDeckCount?: number;
  opponentHandCount?: number;
  opponentPlayed: CardTrackerRow[];
  opponentSecrets?: OpponentSecretSlot[];
  boardAttack?: BoardAttackSummary;
  heroHealthLimit?: HeroHealthLimitSummary;
  matchCounters?: MatchCounters;
  smartCounters?: readonly SmartCardCounter[];
  matchFlow?: MatchFlowSnapshot;
  turnTimer?: TurnTimerState;
  events: TrackerEvent[];
  summary: TrackerSummary;
  arena?: ArenaState;
  lastUpdated?: string;
  error?: string;
  readonly cardTracking: PublicCardTracking;
}

export interface CardLibraryQuery {
  readonly query?: string;
  readonly heroClass?: string;
  readonly cardType?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface NormalizedCardLibraryQuery {
  readonly query: string;
  readonly heroClass?: string;
  readonly cardType?: string;
  readonly page: number;
  readonly pageSize: number;
}

export interface CardLibraryResult {
  readonly status: "ok" | "error";
  readonly query: string;
  readonly heroClass?: string;
  readonly cardType?: string;
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly items: readonly CardDetails[];
  readonly heroClasses: readonly string[];
  readonly cardTypes: readonly string[];
  readonly source?: string;
  readonly version?: string;
  readonly warnings: readonly string[];
  readonly error?: string;
}

export interface CardPreviewAnchorRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export interface CardPreviewRequest {
  readonly details: CardDetails;
  readonly anchorRect: CardPreviewAnchorRect;
}

export interface EntitySnapshot {
  id?: string;
  name?: string;
  cardId?: string;
  zone?: Zone;
  controller?: number;
  attack?: number;
  healthLimit?: number;
  cardType?: string;
  cardClass?: string;
  attachedToEntityId?: string;
  storedEntityId?: string;
  displayedCreatorEntityId?: string;
  zonePosition?: number;
}

export interface SecretCandidate {
  readonly cardId: string;
  readonly name: string;
  readonly status: "possible" | "excluded";
  readonly exclusionReason?:
    | "spell-played-without-trigger"
    | "minion-played-without-trigger"
    | "hero-attacked-without-trigger";
  readonly details?: CardDetails;
}

export interface OpponentSecretSlot {
  readonly entityId: string;
  readonly candidates: readonly SecretCandidate[];
  readonly revealedCardId?: string;
}

export interface BoardAttackSummary {
  readonly friendly: number;
  readonly opponent: number;
}

export interface HeroHealthLimitSummary {
  readonly friendly?: number;
  readonly opponent?: number;
}

export interface AttackLogEvent {
  type: "attack-change";
  entityId?: string;
  attack: number;
  raw: string;
}

export interface HeroHealthLimitLogEvent {
  type: "hero-health-limit-change";
  entity: EntitySnapshot;
  value: number;
  raw: string;
}

export interface ActionBoundaryLogEvent {
  type: "action-boundary";
  phase: "start" | "end";
  action: "play" | "attack" | "other";
  entity?: EntitySnapshot;
  target?: EntitySnapshot;
  raw: string;
}

export interface BlockBoundaryLogEvent {
  type: "block-boundary";
  phase: "start" | "end";
  blockType?: string;
  entity?: EntitySnapshot;
  target?: EntitySnapshot;
  raw: string;
}

export interface CausalTriggerLogEvent {
  type: "causal-trigger";
  phase: "start" | "end";
  trigger?: "deathrattle";
  entity?: EntitySnapshot;
  raw: string;
}

export interface ZoneChangeLogEvent {
  type: "zone-change";
  entityId?: string;
  cardName?: string;
  cardId?: string;
  fromZone?: Zone;
  toZone: Zone;
  controller?: number;
  raw: string;
}

export interface EntityLogEvent {
  type: "entity";
  entity: EntitySnapshot;
  creating?: boolean;
  raw: string;
}

export interface EntityReferenceLogEvent {
  type: "entity-reference";
  entityId?: string;
  relation: "attached" | "stored-entity";
  referencedEntityId: string;
  raw: string;
}

export interface EntityScriptDataLogEvent {
  type: "entity-script-data";
  entity: EntitySnapshot;
  index: number;
  value: number;
  raw: string;
}

export interface GeneratedEntityLogEvent {
  type: "generated-entity";
  entityId?: string;
  creatorEntityId?: string;
  raw: string;
}

export interface DeckShuffleLogEvent {
  type: "deck-shuffle";
  playerId: number;
  raw: string;
}

export interface ZonePositionLogEvent {
  type: "zone-position";
  entityId?: string;
  controller?: number;
  position: number;
  raw: string;
}

export interface ControllerLogEvent {
  type: "controller";
  entityId?: string;
  controller: number;
  raw: string;
}

export interface EntityClassLogEvent {
  type: "entity-class";
  entityId?: string;
  cardClass: string;
  raw: string;
}

export interface GameStartLogEvent {
  type: "game-start";
  timestamp?: string;
  raw: string;
}

export interface GameSetupCompleteLogEvent {
  type: "game-setup-complete";
  raw: string;
}

export interface GlobalEffectLogEvent {
  type: "global-effect";
  source: "start-of-game" | "played";
  entity: EntitySnapshot;
  raw: string;
}

export interface GameEndLogEvent {
  type: "game-end";
  raw: string;
}

export interface PlayerIdentityLogEvent {
  type: "player-identity";
  playerId: number;
  playerName: string;
  raw: string;
}

export interface PlayerCounterLogEvent {
  type: "player-counter";
  playerId?: number;
  playerName?: string;
  counter: "fatigue" | "corpses" | "spells-played";
  value: number;
  raw: string;
}

export type MatchFlowTag =
  | "TURN"
  | "STEP"
  | "NEXT_STEP"
  | "CURRENT_PLAYER"
  | "RESOURCES"
  | "RESOURCES_USED";

export interface MatchFlowLogEvent {
  type: "match-flow";
  tag: MatchFlowTag;
  value: string;
  entity: EntitySnapshot;
  raw: string;
}

export interface CardForgedLogEvent {
  type: "card-forged";
  entityId?: string;
  forged: boolean;
  raw: string;
}

export type ParsedLogEvent =
  | ZoneChangeLogEvent
  | EntityLogEvent
  | GeneratedEntityLogEvent
  | DeckShuffleLogEvent
  | ZonePositionLogEvent
  | ControllerLogEvent
  | EntityClassLogEvent
  | AttackLogEvent
  | HeroHealthLimitLogEvent
  | ActionBoundaryLogEvent
  | BlockBoundaryLogEvent
  | CausalTriggerLogEvent
  | EntityReferenceLogEvent
  | EntityScriptDataLogEvent
  | GameStartLogEvent
  | GameSetupCompleteLogEvent
  | GameEndLogEvent
  | GlobalEffectLogEvent
  | PlayerIdentityLogEvent
  | PlayerCounterLogEvent
  | MatchFlowLogEvent
  | CardForgedLogEvent;

export interface LogCandidate {
  path: string;
  label: string;
  exists: boolean;
  modifiedAt?: string;
}

export interface PublicLogConfigStatus {
  path: string;
  exists: boolean;
  hasPowerLog: boolean;
  hasZoneLog: boolean;
  hasDecksLog: boolean;
  hasArenaLog: boolean;
  backupPath?: string;
}

export type HearthstoneZone = Zone | "INVALID";

export type LogSource = "Power.log" | "Player.log";

export interface DeckImportResult {
  readonly name?: string;
  readonly heroClass?: string;
  readonly format?: string;
  readonly rawDeckString?: string;
  readonly cards: readonly DeckCard[];
  readonly warnings: readonly string[];
  readonly sourceText: string;
}

export interface CollectionDeck {
  readonly id: string;
  readonly deckId?: string;
  readonly name?: string;
  readonly heroClass?: string;
  readonly format?: string;
  readonly mode?: string;
  readonly cards: readonly DeckCard[];
  readonly rawDeckString?: string;
  readonly rawText: string;
  readonly sourcePath: string;
  readonly updatedAt: string;
  readonly warnings: readonly string[];
}

export interface CollectionDeckSummary {
  readonly id: string;
  readonly deckId?: string;
  readonly name?: string;
  readonly heroClass?: string;
  readonly format?: string;
  readonly mode?: string;
  readonly cardCount?: number;
  readonly cards?: readonly DeckCard[];
  readonly rawDeckString?: string;
  readonly sourcePath?: string;
  readonly updatedAt?: string;
  readonly warnings?: readonly string[];
}

export interface CollectionDeckScanResult {
  readonly status: "ok" | "missing-log" | "error" | "stale";
  readonly decks: readonly CollectionDeckSummary[];
  readonly activeDeck?: CollectionDeck;
  readonly updatedAt?: string;
  readonly sourcePath?: string;
  readonly databasePath?: string;
  readonly message?: string;
  readonly warning?: string;
}

export interface HearthstoneEntity {
  readonly entityId?: number;
  readonly name?: string;
  readonly cardId?: string;
  readonly playerId?: number;
  readonly zone?: HearthstoneZone | string;
  readonly zonePos?: number;
  readonly raw: string;
}

export interface BaseLogEvent {
  readonly source: LogSource;
  readonly timestamp?: string;
  readonly raw: string;
}

export interface GameStartedEvent extends BaseLogEvent {
  readonly type: "game-started";
}

export interface PlayerInfoEvent extends BaseLogEvent {
  readonly type: "player-info";
  readonly playerId: number;
  readonly name?: string;
  readonly isLocal?: boolean;
}

export interface ZoneChangeEvent extends BaseLogEvent {
  readonly type: "zone-change";
  readonly entity: HearthstoneEntity;
  readonly tag: string;
  readonly value: string;
}

export interface EntityRevealedEvent extends BaseLogEvent {
  readonly type: "entity-revealed";
  readonly entity: HearthstoneEntity;
  readonly cardId?: string;
}

export interface CardPlayedEvent extends BaseLogEvent {
  readonly type: "card-played";
  readonly entity: HearthstoneEntity;
  readonly blockType: string;
}

export type GameLogEvent =
  | GameStartedEvent
  | PlayerInfoEvent
  | ZoneChangeEvent
  | EntityRevealedEvent
  | CardPlayedEvent;

export interface SeenCard {
  readonly name?: string;
  readonly cardId?: string;
  readonly entityId?: number;
  readonly playerId?: number;
  readonly timestamp?: string;
  readonly raw: string;
}

export type MatchEvent =
  | {
      readonly type: "deck-loaded";
      readonly cards: readonly DeckCard[];
      readonly timestamp?: string;
    }
  | {
      readonly type: "card-drawn";
      readonly card: SeenCard;
    }
  | {
      readonly type: "opponent-card-played";
      readonly card: SeenCard;
    }
  | {
      readonly type: "log-event";
      readonly event: GameLogEvent;
    };

export interface MatchPlayer {
  readonly playerId: number;
  readonly name?: string;
  readonly isLocal?: boolean;
}

export interface MatchState {
  readonly friendlyPlayerId?: number;
  readonly opponentPlayerId?: number;
  readonly friendlyDeck: readonly DeckCard[];
  readonly drawnCards: readonly SeenCard[];
  readonly opponentPlayedCards: readonly SeenCard[];
  readonly players: readonly MatchPlayer[];
  readonly events: readonly MatchEvent[];
}

export interface CreateMatchStateOptions {
  readonly deck?: DeckImportResult;
  readonly friendlyPlayerId?: number;
  readonly opponentPlayerId?: number;
}
