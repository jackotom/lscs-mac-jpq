import { createEmptyDeckRows, deckCardKey, parseDeckText } from "./deck.js";
import { normalizeZone, parseLogLine, type FriendlyDeckSnapshot } from "./powerLogParser.js";
import {
  createCardIdNameLookup,
  isRandomSpellPoolCard,
  listCardInfos,
  normalizeCardId,
  toCardDetails,
  toRelatedCardInfo,
  type CardOutcomeNode,
  type CardOutcomeSection,
  type CardDatabase,
  type CardDetails,
  type CardInfo
} from "./cardDatabase.js";
import type {
  CardTrackerRow,
  CollectionDeck,
  DeckCard,
  DeckIdentityEvidence,
  DeckIdentitySource,
  EntitySnapshot,
  OpponentSecretSlot,
  ParsedLogEvent,
  PlayerMatchCounters,
  PublicCardHistoryGroup,
  PublicCardContextDetails,
  PublicCardTracking,
  PublicCardZone,
  PublicCardZoneGroup,
  PublicKnownCard,
  PublicTrackerState,
  TrackerEvent,
  TrackerZoneCard,
  Zone
} from "./types.js";
import { SecretTracker } from "./secretTracker.js";
import { resolveMatchCardRelations } from "./matchCardRelations.js";
import { MatchFlow } from "./matchFlow.js";
import { buildSmartCardCounters } from "./smartCounters.js";

interface EngineOptions {
  deckText?: string;
  cardDatabase?: CardDatabase;
  cardDatabaseWarnings?: readonly string[];
  collectionDecks?: readonly CollectionDeck[];
}

interface FriendlyObservation {
  readonly entityId?: string;
  readonly cardName: string;
  readonly rawCardName?: string;
  readonly cardId?: string;
  readonly kind: "draw" | "play";
  readonly fromZone?: Zone;
  readonly toZone: Zone;
  readonly raw: string;
  applied: boolean;
}

type ExplicitDeckIdentitySource = Exclude<DeckIdentitySource, "inferred">;

interface CollectionDeckPreviewOptions {
  readonly expectedSize?: number;
  readonly source?: ExplicitDeckIdentitySource;
}

type CardOutcomeSide = "friendly" | "opponent";

interface CardOutcomeLogSource {
  readonly counterKey: string;
  readonly dedupGroup: string;
}

interface RecordedCardOutcomeNode {
  readonly key: string;
  readonly entityId?: string;
  readonly card: CardInfo;
  readonly children: RecordedCardOutcomeNode[];
}

interface RecordedCardOutcome {
  readonly key: string;
  readonly source: CardInfo;
  readonly cards: RecordedCardOutcomeNode[];
  readonly keepWhenEmpty: boolean;
}

interface CompletedCardOutcome extends RecordedCardOutcome {
  readonly completionSequence: number;
}

interface CardOutcomeBlockFrame {
  readonly key: string;
  readonly blockType?: string;
  readonly entityId?: string;
  readonly entity?: EntitySnapshot;
  readonly target?: EntitySnapshot;
  readonly parent?: CardOutcomeBlockFrame;
  readonly rootSemanticKey: string;
  readonly rootLogSource: CardOutcomeLogSource;
  readonly parentCards?: RecordedCardOutcomeNode[];
  readonly parentSourceEntityId?: string;
  readonly parentAcceptsFullEntityOutcomes?: boolean;
  side?: CardOutcomeSide;
  usageId?: string;
  sourceEntityId?: string;
  cards?: RecordedCardOutcomeNode[];
  acceptsFullEntityOutcomes?: boolean;
  capture?: RecordedCardOutcome;
  configured?: boolean;
  suppressed?: boolean;
}

interface RecordedCardUse {
  readonly usageId: string;
  readonly sequence: number;
  readonly entityId: string;
  readonly side: CardOutcomeSide;
  readonly action: "play";
  readonly turn?: number;
  readonly cardId?: string;
  readonly name?: string;
}

interface RecordedBurn {
  readonly burnId: string;
  readonly sequence: number;
  readonly entityId: string;
  readonly side: CardOutcomeSide;
  readonly turn?: number;
  readonly cardId?: string;
  readonly name?: string;
  readonly confidence: "inferred";
  readonly transitionFingerprint: string;
}

interface MutablePublicZoneGroup {
  totalCount: number;
  readonly cards: Map<string, PublicKnownCard>;
}

const GENERATED_DECK_ROW_NAME = "对局生成的未知牌";
const MISSING_COLLECTION_DECK_ROW_NAME = "日志缺失的收藏牌";
const INSERTED_UNKNOWN_DECK_ROW_NAME = "被塞入的未知牌";
const UNRESOLVED_HAND_CARD_NAME = "未识别手牌";
const GALACTIC_PROJECTION_ORB_CARD_ID = "toy_378";
const KELTHUZAD_CARD_IDS = new Set(["rev_514", "core_rev_514"]);
const KELTHUZAD_UNSTABLE_SKELETON_CARD_IDS = new Set(["rev_845", "core_rev_845"]);
const THE_FINS_BEYOND_TIME_CARD_IDS = new Set(["time_706"]);
const FRIENDLY_HAND_ZONES = new Set<Zone>(["HAND"]);
const FRIENDLY_OTHER_ZONES = new Set<Zone>(["PLAY", "GRAVEYARD", "REMOVEDFROMGAME", "SECRET"]);
const OPPONENT_OTHER_ZONES = new Set<Zone>(["PLAY", "GRAVEYARD", "REMOVEDFROMGAME", "SETASIDE", "SECRET"]);
const PUBLIC_CARD_ZONES = new Set<Zone>(["DECK", "HAND", "PLAY", "SECRET", "GRAVEYARD", "REMOVEDFROMGAME"]);
const DISPLAYABLE_CARD_TYPE_IDS = new Set([4, 5, 7, 39]);
const NON_DISPLAYABLE_CARD_TYPE_IDS = new Set([2, 3, 6, 10]);
const DISPLAYABLE_CARD_TYPES = new Set(["MINION", "SPELL", "WEAPON", "LOCATION", "随从", "法术", "武器", "地标"]);
const NON_DISPLAYABLE_CARD_TYPES = new Set([
  "PLAYER",
  "HERO",
  "HEROPOWER",
  "ENCHANTMENT",
  "玩家",
  "英雄",
  "英雄技能",
  "附魔"
]);

export class TrackerEngine {
  private deckCards: DeckCard[] = [];
  private deckCode: string | undefined;
  private deckName: string | undefined;
  private autoMatchedDeckId: string | undefined;
  private deckIdentity: DeckIdentityEvidence = createWaitingDeckIdentity();
  private deckRows = new Map<string, CardTrackerRow>();
  private opponentRows = new Map<string, CardTrackerRow>();
  private globalEffects = new Map<string, EntitySnapshot>();
  private opponentGlobalEffects = new Map<string, EntitySnapshot>();
  private events: TrackerEvent[] = [];
  private entities = new Map<string, EntitySnapshot>();
  private collectionDecks: CollectionDeck[] = [];
  private friendlyObservations: FriendlyObservation[] = [];
  private eventCounter = 0;
  private status: PublicTrackerState["status"] = "idle";
  private gameActive = false;
  private gameSetupComplete = false;
  private logPath: string | undefined;
  private error: string | undefined;
  private friendlyController: number | undefined;
  private configuredFriendlyController: number | undefined;
  private deckRowsByCardId = new Map<string, CardTrackerRow>();
  private cardNameByCardId = new Map<string, string>();
  private cardInfoByCardId = new Map<string, CardInfo>();
  private cardInfoByName = new Map<string, CardInfo>();
  private cardDatabase: CardDatabase | undefined;
  private pendingControllerEvents: ParsedLogEvent[] = [];
  private unresolvedDrawEntityIds = new Set<string>();
  private pendingUnknownDeckExitZones = new Map<string, Zone>();
  private generatedEntityIds = new Set<string>();
  private insertedDeckEntityRowKeys = new Map<string, string>();
  private deckPlacementCandidates = new Set<string>();
  private deckPlacements = new Map<string, "top" | "bottom">();
  private deckPositionInvalidatedEntityIds = new Set<string>();
  private pendingEntityDetail: EntitySnapshot | undefined;
  private pendingEntityDetailZoneEvents: Extract<ParsedLogEvent, { type: "zone-change" }>[] = [];
  private playerIdByName = new Map<string, number>();
  private playerIdentityIds = new Set<number>();
  private unknownPlayerIds = new Set<number>();
  private matchCountersByPlayerId = new Map<number, PlayerMatchCounters>();
  private kelthuzadResurrectionCountByController = new Map<number, number>();
  private openingHandEntityIdsByController = new Map<number, readonly string[]>();
  private openingHandsCaptured = false;
  private friendlyDeckSnapshot: FriendlyDeckSnapshot | undefined;
  private usingUnmatchedDeckSnapshot = false;
  private lastGameStartTimestamp: string | undefined;
  private gameSequence = 0;
  private cardHistorySequence = 0;
  private gameKey = "no-game";
  private cardUses: RecordedCardUse[] = [];
  private burns: RecordedBurn[] = [];
  private activeUsageIdByEntity = new Map<string, string>();
  private recordedBurnFingerprints = new Set<string>();
  private cardOutcomeCompletionSequence = 0;
  private friendlyDeadMinionsThisGame: CardInfo[] = [];
  private opponentDeadMinionsThisGame: CardInfo[] = [];
  private recordedDeathEntityIds = new Set<string>();
  private cardOutcomeBlockStack: CardOutcomeBlockFrame[] = [];
  private outcomesByUsageId = new Map<string, CompletedCardOutcome[]>();
  private completedCardOutcomeDedupKeys = new Set<string>();
  private cardOutcomeOccurrencesBySource = new Map<string, number>();
  private cardOutcomeFrameSequence = 0;
  private lastBlockBoundary:
    | { readonly fingerprint: string; readonly source: string }
    | undefined;
  private pendingKnownEntityReturn: EntitySnapshot | undefined;
  private pendingKnownEntityReturnCandidateIds = new Set<string>();
  private matchFlow: MatchFlow;
  private secretTracker: SecretTracker;

  constructor(options: EngineOptions = {}) {
    this.matchFlow = this.createMatchFlow();
    this.secretTracker = new SecretTracker(options.cardDatabase);
    if (options.cardDatabase) {
      this.setCardDatabase(options.cardDatabase);
    }

    if (options.deckText) {
      this.importDeck(options.deckText, options.cardDatabase, options.cardDatabaseWarnings);
    }

    if (options.collectionDecks) {
      this.setCollectionDecks(options.collectionDecks);
    }
  }

  setCardDatabase(cardDatabase?: CardDatabase) {
    this.cardDatabase = cardDatabase;
    this.secretTracker = new SecretTracker(cardDatabase);
    this.cardNameByCardId = cardDatabase ? new Map(createCardIdNameLookup(cardDatabase)) : new Map();
    this.cardInfoByCardId = new Map();
    this.cardInfoByName = new Map();
    for (const card of cardDatabase ? listCardInfos(cardDatabase) : []) {
      if (card.cardId ?? card.id) {
        this.cardInfoByCardId.set(normalizeCardId(card.cardId ?? card.id!), card);
      }
      this.cardInfoByName.set(normalizeCardKey(card.name), card);
    }
  }

  setFriendlyController(controller?: number) {
    this.configuredFriendlyController = controller;
    this.applyFriendlyController(controller);
  }

  private applyFriendlyController(controller?: number) {
    this.friendlyController = controller;
    this.flushPendingControllerEvents();
  }

  importDeck(deckText: string, cardDatabase?: CardDatabase, cardDatabaseWarnings: readonly string[] = []) {
    if (cardDatabase) {
      this.setCardDatabase(cardDatabase);
    }

    const imported = parseDeckText(deckText, cardDatabase, cardDatabaseWarnings);
    this.deckCards = imported.cards;
    this.deckCode = imported.rawCode;
    this.deckName = undefined;
    this.autoMatchedDeckId = undefined;
    this.resetDeckIdentity();
    this.deckRows = new Map(createEmptyDeckRows(imported.cards).map((row) => [deckCardKey(row), row]));
    this.rebuildDeckCardIdIndex();
    this.opponentRows.clear();
    this.globalEffects.clear();
    this.opponentGlobalEffects.clear();
    this.events = [];
    this.entities.clear();
    this.friendlyObservations = [];
    this.pendingControllerEvents = [];
    this.unresolvedDrawEntityIds.clear();
    this.generatedEntityIds.clear();
    this.insertedDeckEntityRowKeys.clear();
    this.clearDeckInsertionTracking();
    this.pendingEntityDetail = undefined;
    this.pendingEntityDetailZoneEvents = [];
    this.pendingKnownEntityReturn = undefined;
    this.pendingKnownEntityReturnCandidateIds.clear();
    this.clearMatchCounters();
    this.kelthuzadResurrectionCountByController.clear();
    this.clearMatchCardHistory();
    this.matchFlow = this.createMatchFlow();
    this.eventCounter = 0;
    this.gameActive = false;
    this.gameSetupComplete = false;
    this.error = imported.warnings[0];
    this.addEvent("info", "unknown", {
      cardName: imported.cards.length ? `已导入 ${imported.cards.length} 种卡牌` : "未导入卡牌列表"
    });
  }

  setCollectionDecks(decks: readonly CollectionDeck[]) {
    this.collectionDecks = decks.filter((deck) => deck.cards.length > 0);
    if (!this.autoMatchedDeckId) {
      this.resetDeckIdentity();
    }
    if (this.collectionDecks.length > 0 && this.deckRows.size === 0) {
      this.tryAutoMatchDeck();
    }
  }

  activateCollectionDeck(deckId: string): boolean {
    const deck = this.collectionDecks.find((candidate) => candidate.id === deckId);
    if (!deck || !this.gameActive) {
      return false;
    }

    if (!this.matchesFriendlyDeckSnapshot(deck)) {
      return false;
    }

    if (this.deckRows.size > 0 && this.autoMatchedDeckId === undefined && !this.usingUnmatchedDeckSnapshot) {
      return false;
    }

    if (this.autoMatchedDeckId === deck.id) {
      this.confirmExplicitDeckIdentity(deck.id, "decks-log");
      return true;
    }

    this.activateAutoMatchedDeck(deck);
    this.confirmExplicitDeckIdentity(deck.id, "decks-log");
    return true;
  }

  activateExplicitCollectionDeck(deckId: string, options: { expectedSize?: number } = {}): boolean {
    const deck = this.collectionDecks.find((candidate) => candidate.id === deckId);
    if (!deck || !this.gameActive) {
      return false;
    }

    const deckSize = deck.cards.reduce((total, card) => total + card.count, 0);
    if (this.friendlyDeckSnapshot && deckSize > this.friendlyDeckSnapshot.initialDeckSize) {
      return false;
    }

    if (this.autoMatchedDeckId === deck.id) {
      this.confirmExplicitDeckIdentity(deck.id, "decks-log");
      return true;
    }

    this.activateExplicitDeck(deck, options);
    this.confirmExplicitDeckIdentity(deck.id, "decks-log");
    return true;
  }

  previewCollectionDeck(
    deckId: string,
    optionsOrSource: CollectionDeckPreviewOptions | ExplicitDeckIdentitySource = {}
  ): boolean {
    const deck = this.collectionDecks.find((candidate) => candidate.id === deckId);
    if (!deck) {
      return false;
    }

    const options = typeof optionsOrSource === "string"
      ? { source: optionsOrSource }
      : optionsOrSource;
    const requestedSource = options.source ?? "screen";
    const source = requestedSource === "screen" &&
      this.deckIdentity.source === "decks-log" &&
      this.deckIdentity.deckId === deck.id
      ? "decks-log"
      : requestedSource;

    const deckSize = deck.cards.reduce((total, card) => total + card.count, 0);
    const missingCards = options.expectedSize && options.expectedSize > deckSize
      ? { name: MISSING_COLLECTION_DECK_ROW_NAME, count: options.expectedSize - deckSize }
      : undefined;
    this.deckCards = [...deck.cards.map((card) => ({ ...card })), ...(missingCards ? [missingCards] : [])];
    this.deckCode = deck.rawDeckString;
    this.deckName = deck.name ?? "当前套牌";
    this.autoMatchedDeckId = deck.id;
    this.confirmExplicitDeckIdentity(deck.id, source);
    this.deckRows = new Map(createEmptyDeckRows(this.deckCards).map((row) => [deckCardKey(row), row]));
    this.rebuildDeckCardIdIndex();
    this.usingUnmatchedDeckSnapshot = false;
    this.error = undefined;
    this.gameActive = false;
    this.gameSetupComplete = false;
    this.matchFlow = this.createMatchFlow();
    return true;
  }

  clearCollectionDeckPreview(): boolean {
    if (this.gameActive || !this.autoMatchedDeckId) {
      return false;
    }

    this.deckCards = [];
    this.deckCode = undefined;
    this.deckName = undefined;
    this.autoMatchedDeckId = undefined;
    this.resetDeckIdentity();
    this.deckRows.clear();
    this.deckRowsByCardId.clear();
    this.usingUnmatchedDeckSnapshot = false;
    return true;
  }

  setFriendlyDeckSnapshot(snapshot?: FriendlyDeckSnapshot) {
    this.friendlyDeckSnapshot = snapshot;
  }

  useUnmatchedDeckSnapshot(): boolean {
    const snapshot = this.friendlyDeckSnapshot;
    if (!this.gameActive || !snapshot || snapshot.initialDeckSize <= 0) {
      return false;
    }

    const placeholder: DeckCard = { name: "未识别的剩余牌", count: snapshot.initialDeckSize };
    this.deckCards = [placeholder];
    this.deckCode = undefined;
    this.deckName = "等待精确识别";
    this.autoMatchedDeckId = undefined;
    this.resetDeckIdentity();
    this.deckRows = new Map([
      [
        deckCardKey(placeholder),
        {
          name: placeholder.name,
          count: snapshot.initialDeckSize,
          remaining: snapshot.remainingDeckSize,
          drawn: Math.max(0, snapshot.initialDeckSize - snapshot.remainingDeckSize),
          played: 0
        }
      ]
    ]);
    this.rebuildDeckCardIdIndex();
    this.usingUnmatchedDeckSnapshot = true;
    this.addEvent("info", "friendly", { cardName: "游戏牌库与收藏记录不一致，正在等待精确识别" });
    return true;
  }

  loadDeckCards(cards: readonly DeckCard[], name: string) {
    this.deckCards = cards.map((card) => ({ ...card }));
    this.deckCode = undefined;
    this.deckName = name;
    this.autoMatchedDeckId = undefined;
    this.resetDeckIdentity();
    this.deckRows = new Map(createEmptyDeckRows(this.deckCards).map((row) => [deckCardKey(row), row]));
    this.rebuildDeckCardIdIndex();
    this.unresolvedDrawEntityIds.clear();
    this.generatedEntityIds.clear();
    this.insertedDeckEntityRowKeys.clear();
    this.clearDeckInsertionTracking();
    this.kelthuzadResurrectionCountByController.clear();
    this.error = undefined;
    this.gameActive = false;
    this.gameSetupComplete = false;
    this.matchFlow = this.createMatchFlow();
  }

  syncDeckCards(cards: readonly DeckCard[], name: string) {
    if (!this.gameActive) {
      this.loadDeckCards(cards, name);
      return;
    }

    const nextDeckCards = cards.map((card) => ({ ...card }));
    const nextBaseRows: CardTrackerRow[] = createEmptyDeckRows(nextDeckCards);
    const oldBaseRows = [...new Set(this.deckCards
      .map((card) => this.deckRows.get(deckCardKey(card)))
      .filter((row): row is CardTrackerRow => row !== undefined))];
    const oldKeyByRow = new Map<CardTrackerRow, string>();
    for (const [key, row] of this.deckRows) {
      oldKeyByRow.set(row, key);
    }

    const findUniqueRow = (
      rows: readonly CardTrackerRow[],
      card: Pick<DeckCard, "name" | "cardId">,
      namePeers?: readonly CardTrackerRow[]
    ) => {
      if (card.cardId) {
        const idMatches = rows.filter(
          (row) => row.cardId && normalizeCardId(row.cardId) === normalizeCardId(card.cardId!)
        );
        if (idMatches.length === 1) {
          return idMatches[0];
        }
        if (idMatches.length > 1) {
          return undefined;
        }
      }
      const nameMatches = rows.filter(
        (row) =>
          normalizeCardKey(row.name) === normalizeCardKey(card.name) &&
          (!card.cardId || !row.cardId)
      );
      if (
        namePeers &&
        namePeers.filter((row) => normalizeCardKey(row.name) === normalizeCardKey(card.name)).length !== 1
      ) {
        return undefined;
      }
      return nameMatches.length === 1 ? nameMatches[0] : undefined;
    };

    const insertedByOldKey = new Map<string, { count: number; remaining: number; drawn: number }>();
    for (const [entityId, rowKey] of this.insertedDeckEntityRowKeys) {
      const current = insertedByOldKey.get(rowKey) ?? { count: 0, remaining: 0, drawn: 0 };
      current.count += 1;
      if (this.entities.get(entityId)?.zone === "DECK") {
        current.remaining += 1;
      } else {
        current.drawn += 1;
      }
      insertedByOldKey.set(rowKey, current);
    }

    const usedOldRows = new Set<CardTrackerRow>();
    for (const nextRow of nextBaseRows) {
      let oldRow = findUniqueRow(oldBaseRows, nextRow, nextBaseRows);
      if (oldRow && usedOldRows.has(oldRow)) {
        oldRow = undefined;
      }
      if (!oldRow) {
        continue;
      }
      usedOldRows.add(oldRow);
      const inserted = insertedByOldKey.get(oldKeyByRow.get(oldRow) ?? "") ?? {
        count: 0,
        remaining: 0,
        drawn: 0
      };
      const drawn = Math.max(0, oldRow.drawn - inserted.drawn);
      nextRow.drawn = Math.min(nextRow.count, drawn);
      nextRow.remaining = Math.max(0, nextRow.count - nextRow.drawn);
      nextRow.played = oldRow.played;
    }

    const resolvedUnresolvedDraws = new Set<string>();
    for (const entityId of this.unresolvedDrawEntityIds) {
      const entity = this.entities.get(entityId);
      if (!entity) {
        continue;
      }
      const target = findUniqueRow(nextBaseRows, {
        name: this.resolveCardName(entity.name, entity.cardId) ?? entity.name ?? "",
        cardId: entity.cardId
      });
      if (!target) {
        continue;
      }
      target.drawn = Math.min(target.count, target.drawn + 1);
      target.remaining = Math.max(0, target.count - target.drawn);
      resolvedUnresolvedDraws.add(entityId);
    }

    const nextRows = new Map<string, CardTrackerRow>(
      nextBaseRows.map((row) => [deckCardKey(row), row])
    );
    const preservedDynamicRows = new Map<string, CardTrackerRow>();
    const preservedDynamicPlayedKeys = new Set<string>();
    for (const [entityId, oldRowKey] of this.insertedDeckEntityRowKeys) {
      const entity = this.entities.get(entityId);
      const oldRow = this.deckRows.get(oldRowKey);
      const target = entity
        ? findUniqueRow(nextBaseRows, {
            name: this.resolveCardName(entity.name, entity.cardId) ?? entity.name ?? oldRow?.name ?? "",
            cardId: entity.cardId
          })
        : undefined;
      const targetKey = target ? deckCardKey(target) : oldRowKey;
      let row = target ?? preservedDynamicRows.get(targetKey);
      if (!row) {
        row = {
          name: oldRow?.name ?? entity?.name ?? INSERTED_UNKNOWN_DECK_ROW_NAME,
          count: 0,
          remaining: 0,
          drawn: 0,
          played: 0,
          cardId: oldRow?.cardId ?? entity?.cardId
        };
        preservedDynamicRows.set(targetKey, row);
        nextRows.set(targetKey, row);
      }
      if (oldRow && !usedOldRows.has(oldRow) && !preservedDynamicPlayedKeys.has(oldRowKey)) {
        row.played += oldRow.played;
        preservedDynamicPlayedKeys.add(oldRowKey);
      }
      row.count += 1;
      if (entity?.zone === "DECK") {
        row.remaining += 1;
      } else {
        row.drawn += 1;
      }
      this.insertedDeckEntityRowKeys.set(entityId, targetKey);
    }

    for (const entityId of resolvedUnresolvedDraws) {
      this.unresolvedDrawEntityIds.delete(entityId);
    }
    this.deckCards = nextDeckCards;
    this.deckCode = undefined;
    this.deckName = name;
    this.autoMatchedDeckId = undefined;
    this.resetDeckIdentity();
    this.deckRows = nextRows;
    this.rebuildDeckCardIdIndex();
    this.usingUnmatchedDeckSnapshot = false;
    this.error = undefined;
  }

  clearArenaDeck() {
    if (this.deckName !== "竞技场牌库") {
      return;
    }

    this.deckCards = [];
    this.deckCode = undefined;
    this.deckName = undefined;
    this.autoMatchedDeckId = undefined;
    this.resetDeckIdentity();
    this.deckRows.clear();
    this.deckRowsByCardId.clear();
    this.unresolvedDrawEntityIds.clear();
    this.generatedEntityIds.clear();
    this.insertedDeckEntityRowKeys.clear();
    this.clearDeckInsertionTracking();
    this.kelthuzadResurrectionCountByController.clear();
    this.clearMatchCardHistory();
    this.matchFlow = this.createMatchFlow();
    this.gameKey = "no-game";
    this.gameActive = false;
  }

  resetForGame() {
    if (this.autoMatchedDeckId && this.deckIdentity.source === "inferred") {
      this.deckCards = [];
      this.deckCode = undefined;
      this.deckName = undefined;
      this.autoMatchedDeckId = undefined;
      this.resetDeckIdentity();
    }
    this.deckRows = new Map(createEmptyDeckRows(this.deckCards).map((row) => [deckCardKey(row), row]));
    this.rebuildDeckCardIdIndex();
    this.opponentRows.clear();
    this.globalEffects.clear();
    this.opponentGlobalEffects.clear();
    this.events = [];
    this.entities.clear();
    this.friendlyObservations = [];
    this.pendingControllerEvents = [];
    this.unresolvedDrawEntityIds.clear();
    this.generatedEntityIds.clear();
    this.insertedDeckEntityRowKeys.clear();
    this.clearDeckInsertionTracking();
    this.pendingEntityDetail = undefined;
    this.pendingEntityDetailZoneEvents = [];
    this.pendingKnownEntityReturn = undefined;
    this.pendingKnownEntityReturnCandidateIds.clear();
    this.clearMatchCounters();
    this.kelthuzadResurrectionCountByController.clear();
    this.clearMatchCardHistory();
    this.matchFlow = this.createMatchFlow();
    this.gameSequence += 1;
    this.gameKey = `game-${this.gameSequence}`;
    this.eventCounter = 0;
    this.friendlyController = this.configuredFriendlyController;
    this.gameActive = true;
    this.gameSetupComplete = false;
    this.friendlyDeckSnapshot = undefined;
    this.usingUnmatchedDeckSnapshot = false;
    if (!this.autoMatchedDeckId) {
      this.resetDeckIdentity();
    }
    this.lastGameStartTimestamp = undefined;
    this.addEvent("game-start", "unknown", { cardName: "新对局开始" });
  }

  resetAfterGame(options: { clearDeck?: boolean } = {}) {
    const clearDeck = options.clearDeck === true || this.usingUnmatchedDeckSnapshot;
    if (clearDeck) {
      this.deckCards = [];
      this.deckCode = undefined;
      this.deckName = undefined;
      this.autoMatchedDeckId = undefined;
      this.resetDeckIdentity();
      this.deckRows.clear();
      this.deckRowsByCardId.clear();
    } else {
      const collectionDeck = this.autoMatchedDeckId
        ? this.collectionDecks.find((deck) => deck.id === this.autoMatchedDeckId)
        : undefined;
      if (collectionDeck) {
        this.deckCards = collectionDeck.cards.map((card) => ({ ...card }));
        this.deckCode = collectionDeck.rawDeckString;
        this.deckName = collectionDeck.name ?? this.deckName ?? "当前套牌";
      }
      this.deckRows = new Map(createEmptyDeckRows(this.deckCards).map((row) => [deckCardKey(row), row]));
      this.rebuildDeckCardIdIndex();
    }
    this.opponentRows.clear();
    this.globalEffects.clear();
    this.opponentGlobalEffects.clear();
    this.events = [];
    this.entities.clear();
    this.friendlyObservations = [];
    this.pendingControllerEvents = [];
    this.unresolvedDrawEntityIds.clear();
    this.generatedEntityIds.clear();
    this.insertedDeckEntityRowKeys.clear();
    this.clearDeckInsertionTracking();
    this.pendingEntityDetail = undefined;
    this.pendingEntityDetailZoneEvents = [];
    this.pendingKnownEntityReturn = undefined;
    this.pendingKnownEntityReturnCandidateIds.clear();
    this.clearMatchCounters();
    this.kelthuzadResurrectionCountByController.clear();
    this.clearMatchCardHistory();
    this.matchFlow = this.createMatchFlow();
    this.gameKey = "no-game";
    this.eventCounter = 0;
    this.friendlyController = this.configuredFriendlyController;
    this.gameActive = false;
    this.gameSetupComplete = false;
    this.error = undefined;
    this.friendlyDeckSnapshot = undefined;
    this.usingUnmatchedDeckSnapshot = false;
    this.lastGameStartTimestamp = undefined;
    this.secretTracker.reset();
  }

  resetSession() {
    this.resetAfterGame({ clearDeck: true });
  }

  resetForLogSession() {
    const preserveImportedDeck =
      this.deckCards.length > 0 &&
      this.deckName === undefined &&
      this.autoMatchedDeckId === undefined &&
      !this.usingUnmatchedDeckSnapshot;
    this.resetAfterGame({ clearDeck: !preserveImportedDeck });
  }

  setStatus(status: PublicTrackerState["status"], logPath?: string, error?: string) {
    this.status = status;
    this.logPath = logPath;
    this.error = error;
  }

  hasActiveGame() {
    return this.gameActive;
  }

  getFriendlyController() {
    return this.friendlyController;
  }

  applyLine(line: string) {
    if (this.pendingEntityDetailZoneEvents.length > 0 && !/-\s+tag=[A-Z0-9_]+\s+value=/i.test(line)) {
      this.flushPendingEntityDetailZoneEvents();
    }
    const events = parseLogLine(line);
    for (const event of events) {
      if (event.type === "match-flow" && !/\bTAG_CHANGE\b/.test(line)) {
        continue;
      }
      this.applyParsedEvent(event);
    }
    this.applyEntityDetailContinuation(line, events);
  }

  applyText(text: string) {
    const lines = text.split(/\r?\n/);
    if (lines.at(-1) === "") {
      lines.pop();
    }
    for (const line of lines) {
      this.applyLine(line);
    }
  }

  getState(): PublicTrackerState {
    const deck = Array.from(this.deckRows.values()).sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name));
    const friendlyHand = this.buildFriendlyZoneCards(FRIENDLY_HAND_ZONES);
    const friendlyOther = this.buildFriendlyZoneCards(FRIENDLY_OTHER_ZONES);
    const opponentZones = this.buildOpponentZones();
    const opponentPlayed = Array.from(this.opponentRows.values()).sort((a, b) => b.played - a.played || a.name.localeCompare(b.name));
    const opponentSecretSlots = this.secretTracker.getSlots();
    const calculatedSummary = {
      totalCards: deck.reduce((total, row) => total + row.count, 0),
      remainingCards: deck.reduce((total, row) => total + row.remaining, 0),
      drawnCards: deck.reduce((total, row) => total + row.drawn, 0),
      opponentPlayedCount: opponentPlayed.reduce((total, row) => total + row.played, 0)
    };
    const snapshot = this.deckRows.size > 0 ? this.friendlyDeckSnapshot : undefined;
    const insertedDeckSize = this.insertedDeckEntityRowKeys.size;
    const insertedDeckRemaining = [...this.insertedDeckEntityRowKeys.keys()].filter(
      (entityId) => this.entities.get(entityId)?.zone === "DECK"
    ).length;
    const summary = snapshot
      ? {
          totalCards: snapshot.initialDeckSize + insertedDeckSize,
          remainingCards: snapshot.remainingDeckSize + insertedDeckRemaining,
          drawnCards: Math.max(
            0,
            snapshot.initialDeckSize + insertedDeckSize - snapshot.remainingDeckSize - insertedDeckRemaining
          ),
          opponentPlayedCount: calculatedSummary.opponentPlayedCount
        }
      : calculatedSummary;
    const matchFlow = this.gameActive ? this.matchFlow.snapshot() : undefined;

    return {
      status: this.status,
      gameActive: this.gameActive,
      logPath: this.logPath,
      deckCode: this.deckCode,
      deckName: this.deckName,
      autoMatchedDeckId: this.autoMatchedDeckId,
      deckIdentity: this.deckIdentity,
      deck: deck.map((row) => this.withCardDetails(row, true)),
      friendlyHand,
      friendlyOther,
      opponentDeck: opponentZones.deck,
      opponentHand: opponentZones.hand,
      opponentOther: opponentZones.other,
      globalEffects: this.buildGlobalEffects(this.globalEffects),
      opponentGlobalEffects: this.buildGlobalEffects(this.opponentGlobalEffects),
      opponentDeckCount: opponentZones.deckCount,
      opponentHandCount: opponentZones.handCount,
      opponentPlayed: opponentPlayed.map((row) => this.withCardDetails(row, "opponent")),
      opponentSecrets: opponentSecretSlots,
      boardAttack: this.buildBoardAttack(),
      matchCounters: this.buildMatchCounters(),
      smartCounters: buildSmartCardCounters({
        uses: this.cardUses,
        friendlyDeck: this.deckCards,
        currentTurn: matchFlow?.globalTurn,
        activeSide: matchFlow?.activeSide,
        resolveCard: (cardId, name, entityId) => this.resolveCardInfo(cardId, name, entityId),
        toDetails: (card) => this.cardDatabase ? toCardDetails(this.cardDatabase, card) : undefined
      }),
      ...(matchFlow ? { matchFlow } : {}),
      events: this.events.slice(-120).reverse(),
      summary,
      lastUpdated: new Date().toISOString(),
      error: this.error,
      cardTracking: this.buildCardTracking(opponentSecretSlots)
    };
  }

  private applyParsedEvent(event: ParsedLogEvent, replayingPendingControllerEvent = false) {
    if (!replayingPendingControllerEvent && this.shouldWaitForFriendlyController(event)) {
      this.pendingControllerEvents.push(event);
      return;
    }

    if (event.type === "game-start") {
      if (event.timestamp && event.timestamp === this.lastGameStartTimestamp) {
        return;
      }
      this.resetForGame();
      this.lastGameStartTimestamp = event.timestamp;
      this.secretTracker.reset();
      return;
    }

    if (event.type === "game-end") {
      this.resetAfterGame();
      return;
    }

    if (event.type === "match-flow") {
      this.matchFlow.accept(event);
      return;
    }

    if (event.type === "game-setup-complete") {
      if (/\btag=STEP\s+value=(?:MAIN_READY|MAIN_ACTION)\b/iu.test(event.raw)) {
        this.captureOpeningHands();
      }
      this.gameSetupComplete = true;
      return;
    }

    if (event.type === "player-identity") {
      this.rememberPlayerIdentity(event.playerId, event.playerName);
      this.matchFlow.accept(event);
      return;
    }

    if (event.type === "player-counter") {
      if (this.gameActive) {
        this.updatePlayerCounter(event);
      }
      return;
    }

    if (event.type === "deck-shuffle") {
      if (this.gameActive && this.gameSetupComplete) {
        this.invalidateDeckPositions(event.playerId);
      }
      return;
    }

    if (event.type === "global-effect") {
      const controller = event.entity.controller;
      const target = this.isFriendlyController(controller)
        ? this.globalEffects
        : this.isKnownOpponentController(controller) ? this.opponentGlobalEffects : undefined;
      if (!target) return;
      const key = event.entity.id ?? `${controller}:${normalizeCardId(event.entity.cardId ?? "")}`;
      target.set(key, event.entity);
      return;
    }

    if (event.type === "block-boundary") {
      if (
        /\bTriggerKeyword=SECRET\b/i.test(event.raw) &&
        event.entity?.id &&
        this.isKnownOpponentController(event.entity.controller)
      ) {
        this.secretTracker.observeSecretActivity(event.entity.id);
      }
      const frame = this.applyCardOutcomeBoundary(event);
      if (frame) {
        this.applySecretActionBoundary(event.phase, frame);
      }
      return;
    }

    if (event.type === "causal-trigger") {
      if (event.phase === "end") {
        this.finalizePendingKnownEntityReturn();
        return;
      }
      this.pendingKnownEntityReturn = event.trigger === "deathrattle" && event.entity?.id
        ? this.findKnownEntityStoredByAttachment(event.entity.id)
        : undefined;
      this.pendingKnownEntityReturnCandidateIds.clear();
      return;
    }

    if (event.type === "entity-reference") {
      const field = event.relation === "attached" ? "attachedToEntityId" : "storedEntityId";
      this.mergeEntity({ id: event.entityId, [field]: event.referencedEntityId });
      return;
    }

    if (event.type === "entity-script-data") {
      const knownEntity = event.entity.id ? this.entities.get(event.entity.id) : undefined;
      const cardId = normalizeCardId(event.entity.cardId ?? knownEntity?.cardId ?? "");
      const controller = event.entity.controller ?? knownEntity?.controller;
      if (
        event.index === 1 &&
        KELTHUZAD_CARD_IDS.has(cardId) &&
        controller !== undefined &&
        Number.isInteger(event.value) &&
        event.value >= 0
      ) {
        this.kelthuzadResurrectionCountByController.set(controller, event.value);
      }
      return;
    }

    if (event.type === "generated-entity") {
      if (this.gameSetupComplete && event.entityId) {
        this.mergeEntity({
          id: event.entityId,
          displayedCreatorEntityId: event.creatorEntityId
        });
        this.generatedEntityIds.add(event.entityId);
        this.reconcileInsertedDeckEntity(event.entityId);
      }
      return;
    }

    if (event.type === "entity") {
      const existing = event.entity.id ? this.entities.get(event.entity.id) : undefined;
      const merged = this.mergeEntity(existing?.zone ? { ...event.entity, zone: existing.zone } : event.entity);
      if (
        event.creating &&
        merged?.id &&
        !merged.cardId &&
        this.pendingKnownEntityReturn
      ) {
        this.pendingKnownEntityReturnCandidateIds.add(merged.id);
      }
      if (merged?.id) {
        this.reconcileInsertedDeckEntity(merged.id);
        this.resolvePendingUnknownDeckExit(merged, event.raw);
        this.resolveCurrentCardOutcomeFrame(merged);
        if (/\bFULL_ENTITY\b/.test(event.raw)) {
          this.recordFullEntityCardOutcome(merged);
        }
      }
      const info = event.entity.cardId ? this.cardInfoByCardId.get(normalizeCardId(event.entity.cardId)) : undefined;
      if (this.isKnownOpponentController(event.entity.controller) && info?.cardType === "英雄") {
        this.secretTracker.setOpponentClass(info.heroClasses?.[0]);
      }
      if (merged?.id && merged.zone === "SECRET" && merged.cardId && this.isKnownOpponentController(merged.controller)) {
        this.secretTracker.revealSecret(merged.id, merged.cardId);
      }
      return;
    }

    if (event.type === "attack-change") {
      this.mergeEntity({ id: event.entityId, attack: event.attack });
      return;
    }

    if (event.type === "entity-class") {
      const merged = this.mergeEntity({ id: event.entityId, cardClass: event.cardClass });
      if (merged?.id && merged.zone === "SECRET" && this.isKnownOpponentController(merged.controller)) {
        this.secretTracker.setSecretClass(merged.id, merged.cardClass);
      }
      return;
    }

    if (event.type === "action-boundary") {
      if (event.phase === "start") {
        const existing = event.entity?.id ? this.entities.get(event.entity.id) : undefined;
        const cardId = event.entity?.cardId ?? existing?.cardId;
        const controller = event.entity?.controller ?? existing?.controller;
        const info = this.findCardInfo(cardId, event.entity?.name ?? existing?.name);
        const isFriendlyPlay = event.action === "play" && this.isFriendlyController(controller);
        const isOpponentPlay = event.action === "play" && this.isKnownOpponentController(controller);
        if (this.gameActive && event.entity?.id && (isFriendlyPlay || isOpponentPlay)) {
          const use = this.recordCardUse(
            event.entity.id,
            isFriendlyPlay ? "friendly" : "opponent",
            cardId,
            event.entity.name ?? existing?.name
          );
          this.bindPendingCardOutcomeFrame(use);
        }
      }
      return;
    }

    if (event.type === "controller") {
      const merged = this.mergeEntity({ id: event.entityId, controller: event.controller });
      if (merged?.id) {
        this.reconcileInsertedDeckEntity(merged.id);
        this.flushPendingControllerEvents(merged.id);
      }
      return;
    }

    if (event.type === "zone-position") {
      const existing = event.entityId ? this.entities.get(event.entityId) : undefined;
      const merged = this.mergeEntity({
        id: event.entityId,
        controller: event.controller ?? existing?.controller,
        zonePosition: event.position
      });
      if (merged?.id) {
        this.updateDeckPlacement(merged);
      }
      return;
    }

    const existing = event.entityId ? this.entities.get(event.entityId) : undefined;
    const cardId = event.cardId ?? existing?.cardId;
    const cardName = this.resolveCardName(event.cardName ?? existing?.name, cardId);
    const controller = event.controller ?? existing?.controller;
    const fromZone = replayingPendingControllerEvent
      ? event.fromZone ?? existing?.zone
      : existing?.zone === event.toZone
        ? existing.zone
        : event.fromZone ?? existing?.zone;

    if (event.entityId && this.gameSetupComplete) {
      if (event.toZone === "DECK" && fromZone !== "DECK") {
        this.deckPlacementCandidates.add(event.entityId);
        this.deckPositionInvalidatedEntityIds.delete(event.entityId);
      } else if (fromZone === "DECK" && event.toZone !== "DECK") {
        this.deckPlacementCandidates.delete(event.entityId);
        this.deckPlacements.delete(event.entityId);
        this.deckPositionInvalidatedEntityIds.delete(event.entityId);
      }
    }

    if (event.entityId && event.toZone === "HAND" && fromZone !== "HAND") {
      this.activeUsageIdByEntity.delete(event.entityId);
    }

    if (event.entityId && event.toZone === "PLAY" && fromZone !== "PLAY") {
      this.recordedDeathEntityIds.delete(event.entityId);
    }

    const transitionSide = this.isFriendlyController(controller)
      ? "friendly"
      : this.isKnownOpponentController(controller) ? "opponent" : undefined;
    const handCountBefore = transitionSide
      ? this.countCardsInZone(controller, "HAND")
      : undefined;
    if (
      this.gameActive &&
      event.entityId &&
      transitionSide &&
      fromZone === "DECK" &&
      event.toZone === "GRAVEYARD" &&
      handCountBefore === 10
    ) {
      this.recordBurn({
        entityId: event.entityId,
        side: transitionSide,
        cardId,
        name: cardName,
        fromZone,
        toZone: event.toZone,
        raw: event.raw
      });
    }

    if (event.entityId) {
      const merged = this.mergeEntity({
        id: event.entityId,
        name: cardName,
        cardId,
        zone: event.toZone,
        controller
      });
      if (merged?.id) {
        this.reconcileInsertedDeckEntity(merged.id);
      }
    }

    const deckRow = this.resolveDeckRow(cardName, cardId) ?? this.resolveDeckRow(event.cardName ?? existing?.name, cardId);
    const isFriendly =
      this.isFriendlyController(controller) ||
      (deckRow !== undefined && controller === undefined);
    const isOpponent = this.isKnownOpponentController(controller);
    const cardInfo = this.findCardInfo(cardId, cardName);

    if (
      this.gameActive &&
      event.entityId &&
      fromZone === "PLAY" &&
      event.toZone === "GRAVEYARD" &&
      cardInfo?.cardType === "随从" &&
      (isFriendly || isOpponent)
    ) {
      this.recordDeadMinion(event.entityId, cardInfo, isFriendly ? "friendly" : "opponent");
    }

    if (event.entityId && isOpponent) {
      if (event.toZone === "SECRET") {
        this.secretTracker.enterSecret(event.entityId, existing?.cardClass);
        if (cardId) this.secretTracker.revealSecret(event.entityId, cardId);
      } else if (fromZone === "SECRET") {
        if (cardId) this.secretTracker.revealSecret(event.entityId, cardId);
        this.secretTracker.leaveSecret(event.entityId);
      }
    }

    const insertedDeckRow = event.entityId ? this.getInsertedDeckRow(event.entityId) : undefined;
    if (!this.insertedDeckEntityRowKeys.has(event.entityId ?? "")) {
      this.updateFriendlyDeckSnapshot(isFriendly, fromZone, event.toZone);
    }

    if (!cardName) {
      if (
        event.entityId &&
        isFriendly &&
        fromZone === "DECK" &&
        event.toZone !== "DECK" &&
        event.toZone !== "HAND"
      ) {
        this.pendingUnknownDeckExitZones.set(event.entityId, event.toZone);
      }
      if (insertedDeckRow && fromZone !== event.toZone) {
        if (fromZone === "DECK") {
          decrementRemaining(insertedDeckRow);
          insertedDeckRow.drawn += 1;
        } else if (event.toZone === "DECK") {
          insertedDeckRow.remaining = Math.min(insertedDeckRow.count, insertedDeckRow.remaining + 1);
          insertedDeckRow.drawn = Math.max(0, insertedDeckRow.drawn - 1);
        }
      }
      return;
    }

    if (deckRow && isFriendly && cardId && !deckRow.cardId) {
      deckRow.cardId = cardId;
      this.deckRowsByCardId.set(normalizeCardId(cardId), deckRow);
    }

    if (
      this.gameActive &&
      fromZone === "DECK" &&
      event.toZone === "HAND" &&
      !deckRow &&
      this.deckRows.size === 0 &&
      this.isFriendlyController(controller)
    ) {
      const observation = this.observeFriendlyCard({
        entityId: event.entityId,
        cardName,
        rawCardName: event.cardName ?? existing?.name,
        cardId,
        kind: "draw",
        fromZone,
        toZone: event.toZone,
        raw: event.raw,
        applied: false
      });
      if (observation.applied) {
        return;
      }
    }

    if (this.gameActive && isFriendly && fromZone === "DECK" && event.toZone === "HAND" && !deckRow) {
      const generatedRow = this.getGeneratedDeckRow();
      const unresolvedRow = this.getUnresolvedDeckRow();
      const fallbackRow = generatedRow && generatedRow.remaining > 0
        ? generatedRow
        : unresolvedRow && unresolvedRow.remaining > 0
          ? unresolvedRow
          : undefined;
      if (fallbackRow) {
        decrementRemaining(fallbackRow);
        fallbackRow.drawn += 1;
        if (fallbackRow.unresolved && event.entityId) {
          this.unresolvedDrawEntityIds.add(event.entityId);
        }
        this.addEvent("draw", "friendly", { cardName, cardId, fromZone, toZone: event.toZone, raw: event.raw });
        return;
      }
    }

    if (deckRow && isFriendly && fromZone === "DECK" && event.toZone === "HAND") {
      decrementRemaining(deckRow);
      deckRow.drawn += 1;
      this.addEvent("draw", "friendly", { cardName, cardId, fromZone, toZone: event.toZone, raw: event.raw });
      return;
    }

    if (deckRow && isFriendly && fromZone === "DECK" && event.toZone !== "DECK") {
      decrementRemaining(deckRow);
      deckRow.drawn += 1;
      this.addEvent("zone-change", "friendly", { cardName, cardId, fromZone, toZone: event.toZone, raw: event.raw });
      if (event.toZone !== "PLAY") {
        return;
      }
    }

    if (deckRow && isFriendly && fromZone === "HAND" && event.toZone === "DECK") {
      deckRow.remaining = Math.min(deckRow.count, deckRow.remaining + 1);
      deckRow.drawn = Math.max(0, deckRow.drawn - 1);
      this.addEvent("zone-change", "friendly", { cardName, cardId, fromZone, toZone: event.toZone, raw: event.raw });
      return;
    }

    if (
      !deckRow &&
      isFriendly &&
      fromZone === "HAND" &&
      event.toZone === "DECK" &&
      event.entityId &&
      this.unresolvedDrawEntityIds.delete(event.entityId)
    ) {
      const unresolvedRow = this.getUnresolvedDeckRow();
      if (unresolvedRow) {
        unresolvedRow.remaining = Math.min(unresolvedRow.count, unresolvedRow.remaining + 1);
        unresolvedRow.drawn = Math.max(0, unresolvedRow.drawn - 1);
        this.addEvent("zone-change", "friendly", { cardName, cardId, fromZone, toZone: event.toZone, raw: event.raw });
      }
      return;
    }

    if (event.toZone === "PLAY") {
      if (!deckRow && this.deckRows.size === 0 && this.gameActive && this.isFriendlyController(controller)) {
        const observation = this.observeFriendlyCard({
          entityId: event.entityId,
          cardName,
          rawCardName: event.cardName ?? existing?.name,
          cardId,
          kind: "play",
          fromZone,
          toZone: event.toZone,
          raw: event.raw,
          applied: false
        });
        if (observation.applied) {
          return;
        }
      }

      if (isFriendly && deckRow) {
        deckRow.played += 1;
        this.addEvent("friendly-play", "friendly", { cardName, cardId, fromZone, toZone: event.toZone, raw: event.raw });
      } else if (isOpponent) {
        this.incrementOpponentPlayed(cardName, cardId);
        this.addEvent("opponent-play", "opponent", { cardName, cardId, fromZone, toZone: event.toZone, raw: event.raw });
      }
      return;
    }

    if (event.toZone !== fromZone) {
      this.addEvent("zone-change", isFriendly ? "friendly" : "unknown", {
        cardName,
        cardId,
        fromZone,
        toZone: event.toZone,
        raw: event.raw
      });
    }
  }

  private mergeEntity(entity: Partial<EntitySnapshot>) {
    if (!entity.id) {
      return undefined;
    }
    const current = this.entities.get(entity.id) ?? { id: entity.id };
    const next = { ...current, ...withoutUndefined(entity), id: entity.id };
    this.entities.set(entity.id, next);
    return next;
  }

  private finalizePendingKnownEntityReturn() {
    const source = this.pendingKnownEntityReturn;
    const candidates = source
      ? [...this.pendingKnownEntityReturnCandidateIds]
          .map((entityId) => this.entities.get(entityId))
          .filter((entity): entity is EntitySnapshot =>
            Boolean(
              entity?.id &&
              entity.zone === "HAND" &&
              entity.controller === source.controller &&
              !entity.cardId
            )
          )
      : [];
    if (source?.cardId && candidates.length === 1) {
      const [candidate] = candidates;
      this.entities.set(candidate.id!, {
        ...candidate,
        name: source.name,
        cardId: source.cardId
      });
    }
    this.pendingKnownEntityReturn = undefined;
    this.pendingKnownEntityReturnCandidateIds.clear();
  }

  private findKnownEntityStoredByAttachment(attachedEntityId: string): EntitySnapshot | undefined {
    const candidates = new Map<string, EntitySnapshot>();
    for (const linkEntity of this.entities.values()) {
      if (linkEntity.attachedToEntityId !== attachedEntityId || !linkEntity.storedEntityId) {
        continue;
      }
      const storedEntity = this.entities.get(linkEntity.storedEntityId);
      if (
        storedEntity?.id &&
        storedEntity.cardId &&
        storedEntity.controller !== undefined &&
        this.isKnownOpponentController(storedEntity.controller)
      ) {
        candidates.set(storedEntity.id, storedEntity);
      }
    }
    return candidates.size === 1 ? candidates.values().next().value : undefined;
  }

  private applyEntityDetailContinuation(line: string, events: readonly ParsedLogEvent[]) {
    const detailEvent = events.find((event): event is Extract<ParsedLogEvent, { type: "entity" }> => event.type === "entity");
    const matchFlowEvent = events.find(
      (event): event is Extract<ParsedLogEvent, { type: "match-flow" }> => event.type === "match-flow"
    );
    if (/(?:FULL_ENTITY|SHOW_ENTITY)\s+-\s+(?:Creating|Updating)\b/.test(line)) {
      this.pendingEntityDetail = detailEvent?.entity.id
        ? (this.entities.get(detailEvent.entity.id) ?? detailEvent.entity)
        : undefined;
      return;
    }

    const tag = line.match(/-\s+tag=([A-Z0-9_]+)\s+value=([^\s]+)/i);
    if (!tag) {
      this.pendingEntityDetail = undefined;
      return;
    }

    if (!this.pendingEntityDetail?.id) {
      return;
    }

    const [, tagName, tagValue] = tag;
    if (matchFlowEvent) {
      this.matchFlow.accept({
        ...matchFlowEvent,
        entity: this.pendingEntityDetail
      });
    }
    if (tagName === "CONTROLLER") {
      const controller = Number(tagValue);
      if (Number.isFinite(controller)) {
        this.mergeEntity({ id: this.pendingEntityDetail.id, controller });
        this.pendingEntityDetail = { ...this.pendingEntityDetail, controller };
        this.flushPendingEntityDetailZoneEvents(controller);
      }
      return;
    }

    if (tagName === "ATK") {
      const attack = Number(tagValue);
      if (Number.isFinite(attack)) this.pendingEntityDetail = this.mergeEntity({ ...this.pendingEntityDetail, attack });
      return;
    }

    if (tagName === "CARDTYPE") {
      this.pendingEntityDetail = this.mergeEntity({ ...this.pendingEntityDetail, cardType: tagValue });
      return;
    }

    if (tagName === "CLASS") {
      this.pendingEntityDetail = this.mergeEntity({ ...this.pendingEntityDetail, cardClass: tagValue });
      if (
        this.pendingEntityDetail?.id &&
        this.pendingEntityDetail.zone === "SECRET" &&
        this.isKnownOpponentController(this.pendingEntityDetail.controller)
      ) {
        this.secretTracker.setSecretClass(this.pendingEntityDetail.id, tagValue);
      }
      return;
    }

    if (tagName === "ATTACHED" || tagName === "TAG_SCRIPT_DATA_NUM_1") {
      if (
        tagName === "TAG_SCRIPT_DATA_NUM_1" &&
        KELTHUZAD_CARD_IDS.has(normalizeCardId(this.pendingEntityDetail.cardId ?? "")) &&
        this.pendingEntityDetail.controller !== undefined
      ) {
        const resurrectionCount = Number(tagValue);
        if (Number.isInteger(resurrectionCount) && resurrectionCount >= 0) {
          this.kelthuzadResurrectionCountByController.set(
            this.pendingEntityDetail.controller,
            resurrectionCount
          );
        }
      }
      this.pendingEntityDetail = this.mergeEntity({
        ...this.pendingEntityDetail,
        ...(tagName === "ATTACHED"
          ? { attachedToEntityId: tagValue }
          : { storedEntityId: tagValue })
      });
      return;
    }

    if (tagName !== "ZONE") {
      return;
    }

    const toZone = normalizeZone(tagValue);
    const zoneEvent: Extract<ParsedLogEvent, { type: "zone-change" }> = {
      type: "zone-change",
      entityId: this.pendingEntityDetail.id,
      cardName: this.pendingEntityDetail.name,
      cardId: this.pendingEntityDetail.cardId,
      fromZone: this.pendingEntityDetail.zone,
      toZone,
      controller: this.pendingEntityDetail.controller,
      raw: line
    };
    if (this.pendingEntityDetail.controller === undefined) {
      this.pendingEntityDetailZoneEvents.push(zoneEvent);
      this.pendingEntityDetail = { ...this.pendingEntityDetail, zone: toZone };
      return;
    }

    this.applyParsedEvent(zoneEvent);
    this.pendingEntityDetail = this.entities.get(this.pendingEntityDetail.id) ?? {
      ...this.pendingEntityDetail,
      zone: toZone
    };
  }

  private flushPendingEntityDetailZoneEvents(controller?: number) {
    if (this.pendingEntityDetailZoneEvents.length === 0) {
      return;
    }

    const pending = this.pendingEntityDetailZoneEvents;
    this.pendingEntityDetailZoneEvents = [];
    for (const event of pending) {
      this.applyParsedEvent({
        ...event,
        controller: event.controller ?? controller
      });
    }

    if (this.pendingEntityDetail?.id) {
      this.pendingEntityDetail = this.entities.get(this.pendingEntityDetail.id) ?? this.pendingEntityDetail;
    }
  }

  private incrementOpponentPlayed(cardName: string, cardId?: string) {
    const key = cardId ? normalizeCardId(cardId) : normalizeCardKey(cardName);
    const current = this.opponentRows.get(key) ?? {
      name: cardName,
      count: 0,
      remaining: 0,
      drawn: 0,
      played: 0,
      cardId
    };
    current.played += 1;
    this.opponentRows.set(key, current);
  }

  private buildBoardAttack() {
    let friendly = 0;
    let opponent = 0;
    for (const entity of this.entities.values()) {
      if (entity.zone !== "PLAY" || !entity.attack || entity.attack < 0) continue;
      const cardInfo = entity.cardId
        ? this.cardInfoByCardId.get(normalizeCardId(entity.cardId))
        : entity.name ? this.cardInfoByName.get(normalizeCardKey(entity.name)) : undefined;
      const cardType = (entity.cardType ?? cardInfo?.cardType)?.toLocaleUpperCase();
      if (cardType !== "随从" && cardType !== "MINION" && cardType !== "英雄" && cardType !== "HERO") continue;
      if (this.isFriendlyController(entity.controller)) friendly += entity.attack;
      else if (this.isKnownOpponentController(entity.controller)) opponent += entity.attack;
    }
    return { friendly, opponent };
  }

  private observeFriendlyCard(observation: FriendlyObservation) {
    this.friendlyObservations.push(observation);
    this.tryAutoMatchDeck();
    return observation;
  }

  private tryAutoMatchDeck() {
    if (
      !this.gameActive ||
      (this.deckRows.size > 0 && !this.usingUnmatchedDeckSnapshot) ||
      this.collectionDecks.length === 0 ||
      this.friendlyObservations.length === 0
    ) {
      return;
    }

    const matchingObservations = collapseFriendlyObservations(this.friendlyObservations);
    const matches = this.collectionDecks
      .filter((deck) => this.matchesFriendlyDeckSnapshot(deck))
      .map((deck) => ({ deck, score: scoreCollectionDeck(deck, matchingObservations) }))
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score);

    const observedDistinctCards = new Set(matchingObservations.map((observation) => observationKey(observation))).size;
    const best = matches[0];
    const second = matches[1];
    const scoreLead = best ? best.score - (second?.score ?? 0) : 0;

    if (!best) {
      this.deckIdentity = {
        status: "waiting",
        source: "inferred",
        observedDistinctCards,
        candidateCount: 0,
        bestScore: 0,
        scoreLead: 0
      };
      return;
    }

    const isUniqueCandidate = matches.length === 1;
    const hasStrictLeader = scoreLead > 0;
    const status = isUniqueCandidate && observedDistinctCards >= 2
      ? "confirmed"
      : isUniqueCandidate || hasStrictLeader
        ? "probable"
        : "waiting";
    this.deckIdentity = {
      status,
      source: "inferred",
      ...(status === "waiting" ? {} : { deckId: best.deck.id }),
      observedDistinctCards,
      candidateCount: matches.length,
      bestScore: best.score,
      scoreLead
    };

    if (status !== "confirmed") {
      return;
    }

    this.activateAutoMatchedDeck(best.deck);
  }

  private activateAutoMatchedDeck(deck: CollectionDeck) {
    const generatedDeckCard = this.createGeneratedDeckCard(deck);
    this.deckCards = [...deck.cards.map((card) => ({ ...card })), ...(generatedDeckCard ? [generatedDeckCard] : [])];
    this.deckCode = deck.rawDeckString;
    this.deckName = deck.name ?? "自动匹配套牌";
    this.autoMatchedDeckId = deck.id;
    this.deckRows = new Map(createEmptyDeckRows(this.deckCards).map((row) => [deckCardKey(row), row]));
    this.rebuildDeckCardIdIndex();
    this.initializeGeneratedDeckRow(generatedDeckCard);
    this.usingUnmatchedDeckSnapshot = false;
    this.error = undefined;
    this.addEvent("info", "friendly", { cardName: `已自动匹配：${this.deckName}` });
    this.applyPendingFriendlyObservations();
  }

  private activateExplicitDeck(deck: CollectionDeck, options: { expectedSize?: number }) {
    const missingDeckCard = this.createMissingCollectionDeckCard(deck, options.expectedSize);
    this.deckCards = [...deck.cards.map((card) => ({ ...card })), ...(missingDeckCard ? [missingDeckCard] : [])];
    this.deckCode = deck.rawDeckString;
    this.deckName = deck.name ?? "当前套牌";
    this.autoMatchedDeckId = deck.id;
    this.deckRows = new Map(createEmptyDeckRows(this.deckCards).map((row) => [deckCardKey(row), row]));
    this.rebuildDeckCardIdIndex();
    this.initializeMissingCollectionDeckRow(missingDeckCard, deck);
    this.usingUnmatchedDeckSnapshot = false;
    this.error = undefined;
    this.addEvent("info", "friendly", { cardName: `已读取当前套牌：${this.deckName}` });
    this.applyPendingFriendlyObservations();
  }

  private confirmExplicitDeckIdentity(deckId: string, source: ExplicitDeckIdentitySource) {
    this.deckIdentity = {
      status: "confirmed",
      source,
      deckId,
      observedDistinctCards: new Set(
        collapseFriendlyObservations(this.friendlyObservations).map((observation) => observationKey(observation))
      ).size,
      candidateCount: 1,
      bestScore: 0,
      scoreLead: 0
    };
  }

  private resetDeckIdentity() {
    this.deckIdentity = createWaitingDeckIdentity();
  }

  private applyPendingFriendlyObservations() {
    for (const observation of this.friendlyObservations) {
      if (observation.applied) {
        continue;
      }

      const deckRow =
        this.resolveDeckRow(observation.cardName, observation.cardId) ?? this.resolveDeckRow(observation.rawCardName);
      if (!deckRow) {
        continue;
      }

      if (observation.cardId && !deckRow.cardId) {
        deckRow.cardId = observation.cardId;
        this.deckRowsByCardId.set(normalizeCardId(observation.cardId), deckRow);
      }

      if (observation.kind === "draw") {
        decrementRemaining(deckRow);
        deckRow.drawn += 1;
        this.addEvent("draw", "friendly", observationToEventPayload(observation));
      } else {
        deckRow.played += 1;
        this.addEvent("friendly-play", "friendly", observationToEventPayload(observation));
      }

      observation.applied = true;
    }
  }

  private rebuildDeckCardIdIndex() {
    this.deckRowsByCardId.clear();
    for (const row of this.deckRows.values()) {
      if (row.cardId) {
        this.deckRowsByCardId.set(normalizeCardId(row.cardId), row);
      }
    }
  }

  private matchesFriendlyDeckSnapshot(deck: CollectionDeck) {
    const expectedSize = this.friendlyDeckSnapshot?.baseDeckSize ?? this.friendlyDeckSnapshot?.initialDeckSize;
    return expectedSize === undefined || deck.cards.reduce((total, card) => total + card.count, 0) === expectedSize;
  }

  private createGeneratedDeckCard(deck: CollectionDeck): DeckCard | undefined {
    const snapshot = this.friendlyDeckSnapshot;
    const baseDeckSize = deck.cards.reduce((total, card) => total + card.count, 0);
    if (!snapshot || snapshot.baseDeckSize !== baseDeckSize) {
      return undefined;
    }

    const extraCards = snapshot.initialDeckSize - baseDeckSize;
    return extraCards > 0 ? { name: GENERATED_DECK_ROW_NAME, count: extraCards } : undefined;
  }

  private createMissingCollectionDeckCard(deck: CollectionDeck, expectedSize?: number): DeckCard | undefined {
    const targetSize = this.friendlyDeckSnapshot?.initialDeckSize ?? expectedSize;
    if (!targetSize) {
      return undefined;
    }

    const knownDeckSize = deck.cards.reduce((total, card) => total + card.count, 0);
    const missingCards = targetSize - knownDeckSize;
    return missingCards > 0 ? { name: MISSING_COLLECTION_DECK_ROW_NAME, count: missingCards } : undefined;
  }

  private initializeGeneratedDeckRow(generatedDeckCard: DeckCard | undefined) {
    if (!generatedDeckCard || !this.friendlyDeckSnapshot) {
      return;
    }

    const row = this.deckRows.get(deckCardKey(generatedDeckCard));
    if (!row) {
      return;
    }

    const baseDeckSize = this.friendlyDeckSnapshot.baseDeckSize ?? 0;
    const remaining = Math.max(0, Math.min(row.count, this.friendlyDeckSnapshot.remainingDeckSize - baseDeckSize));
    row.remaining = remaining;
    row.drawn = row.count - remaining;
  }

  private initializeMissingCollectionDeckRow(missingDeckCard: DeckCard | undefined, deck: CollectionDeck) {
    if (!missingDeckCard || !this.friendlyDeckSnapshot) {
      return;
    }

    const row = this.deckRows.get(deckCardKey(missingDeckCard));
    if (!row) {
      return;
    }

    const knownDeckSize = deck.cards.reduce((total, card) => total + card.count, 0);
    const remaining = Math.max(0, Math.min(row.count, this.friendlyDeckSnapshot.remainingDeckSize - knownDeckSize));
    row.remaining = remaining;
    row.drawn = row.count - remaining;
  }

  private getGeneratedDeckRow() {
    return this.deckRows.get(deckCardKey({ name: GENERATED_DECK_ROW_NAME }));
  }

  private getUnresolvedDeckRow() {
    return [...this.deckRows.values()].find((row) => row.unresolved);
  }

  private getInsertedDeckRow(entityId: string) {
    const rowKey = this.insertedDeckEntityRowKeys.get(entityId);
    return rowKey ? this.deckRows.get(rowKey) : undefined;
  }

  private clearDeckInsertionTracking() {
    this.deckPlacementCandidates.clear();
    this.deckPlacements.clear();
    this.deckPositionInvalidatedEntityIds.clear();
  }

  private invalidateDeckPositions(controller: number) {
    for (const [entityId] of this.deckPlacements) {
      if (this.entities.get(entityId)?.controller === controller) {
        this.deckPlacements.delete(entityId);
      }
    }
    for (const entityId of new Set([
      ...this.generatedEntityIds,
      ...this.deckPlacementCandidates
    ])) {
      const entity = this.entities.get(entityId);
      if (entity?.controller === controller && entity.zone === "DECK") {
        this.deckPositionInvalidatedEntityIds.add(entityId);
      }
    }
  }

  private updateDeckPlacement(entity: EntitySnapshot) {
    if (
      !this.gameActive ||
      !this.gameSetupComplete ||
      !entity.id ||
      entity.zone !== "DECK" ||
      !entity.zonePosition ||
      this.deckPositionInvalidatedEntityIds.has(entity.id) ||
      (!this.generatedEntityIds.has(entity.id) && !this.deckPlacementCandidates.has(entity.id))
    ) {
      return;
    }

    const deckSize = this.currentDeckSizeForController(entity.controller);
    const position = entity.zonePosition === 1
      ? "top"
      : deckSize !== undefined && deckSize > 1 && entity.zonePosition === deckSize
        ? "bottom"
        : undefined;
    if (position) {
      this.deckPlacements.set(entity.id, position);
    } else {
      this.deckPlacements.delete(entity.id);
    }
  }

  private currentDeckSizeForController(controller: number | undefined) {
    if (controller === undefined) {
      return undefined;
    }
    if (this.isFriendlyController(controller) && this.friendlyDeckSnapshot) {
      const insertedRemaining = [...this.insertedDeckEntityRowKeys.keys()].filter(
        (entityId) => this.entities.get(entityId)?.zone === "DECK"
      ).length;
      return this.friendlyDeckSnapshot.remainingDeckSize + insertedRemaining;
    }
    if (this.isFriendlyController(controller)) {
      return [...this.deckRows.values()].reduce((total, row) => total + row.remaining, 0);
    }
    return this.countCardsInZone(controller, "DECK");
  }

  private buildDeckInsertionTracking(side: CardOutcomeSide) {
    const sourceGroups = new Map<string, {
      sourceEntityId: string;
      sourceName: string;
      remainingCount: number;
    }>();
    for (const entityId of this.generatedEntityIds) {
      const entity = this.entities.get(entityId);
      const entitySide = this.isFriendlyController(entity?.controller)
        ? "friendly"
        : this.isKnownOpponentController(entity?.controller) ? "opponent" : undefined;
      if (
        entitySide !== side ||
        entity?.zone !== "DECK" ||
        !entity.displayedCreatorEntityId
      ) {
        continue;
      }
      const source = this.entities.get(entity.displayedCreatorEntityId);
      const sourceCardName = this.resolveCardName(source?.name, source?.cardId) ?? "卡牌效果";
      const existing = sourceGroups.get(entity.displayedCreatorEntityId);
      sourceGroups.set(entity.displayedCreatorEntityId, existing
        ? { ...existing, remainingCount: existing.remainingCount + 1 }
        : {
            sourceEntityId: entity.displayedCreatorEntityId,
            sourceName: `${sourceCardName}创建`,
            remainingCount: 1
          });
    }

    const placements = [...this.deckPlacements.entries()]
      .flatMap(([entityId, position]) => {
        const entity = this.entities.get(entityId);
        const entitySide = this.isFriendlyController(entity?.controller)
          ? "friendly"
          : this.isKnownOpponentController(entity?.controller) ? "opponent" : undefined;
        if (entitySide !== side || entity?.zone !== "DECK") {
          return [];
        }
        const cardName = this.resolveCardName(entity.name, entity.cardId);
        return [{
          entityId,
          position,
          zonePosition: entity.zonePosition,
          ...(cardName ? { cardName } : {}),
          ...(entity.cardId ? { cardId: entity.cardId } : {})
        }];
      })
      .sort((left, right) =>
        (left.zonePosition ?? Number.MAX_SAFE_INTEGER) -
        (right.zonePosition ?? Number.MAX_SAFE_INTEGER)
      )
      .map(({ zonePosition: _zonePosition, ...placement }) => placement);

    return {
      groups: [...sourceGroups.values()].sort((left, right) =>
        left.sourceName.localeCompare(right.sourceName)
      ),
      placements
    };
  }

  private reconcileInsertedDeckEntity(entityId: string) {
    if (!this.gameActive || !this.generatedEntityIds.has(entityId)) {
      return;
    }

    const entity = this.entities.get(entityId);
    if (!entity || entity.zone !== "DECK" || !this.isFriendlyController(entity.controller)) {
      return;
    }

    const resolvedName = this.resolveCardName(entity.name, entity.cardId);
    const targetRow = this.resolveDeckRow(resolvedName, entity.cardId);
    const targetName = targetRow?.name ?? resolvedName ?? INSERTED_UNKNOWN_DECK_ROW_NAME;
    const targetCardId = targetRow?.cardId ?? entity.cardId;
    const targetKey = targetRow
      ? deckCardKey(targetRow)
      : deckCardKey({ name: targetName, cardId: targetCardId });
    const currentKey = this.insertedDeckEntityRowKeys.get(entityId);

    if (!currentKey) {
      const row = targetRow ?? {
        name: targetName,
        count: 0,
        remaining: 0,
        drawn: 0,
        played: 0,
        cardId: targetCardId
      };
      row.count += 1;
      row.remaining += 1;
      if (!targetRow) {
        this.deckRows.set(targetKey, row);
        if (row.cardId) {
          this.deckRowsByCardId.set(normalizeCardId(row.cardId), row);
        }
      }
      this.insertedDeckEntityRowKeys.set(entityId, targetKey);
      return;
    }

    if (currentKey === targetKey) {
      const row = this.deckRows.get(currentKey);
      if (row && row.name === INSERTED_UNKNOWN_DECK_ROW_NAME && resolvedName) {
        row.name = resolvedName;
      }
      return;
    }

    const currentRow = this.deckRows.get(currentKey);
    if (currentRow) {
      currentRow.count = Math.max(0, currentRow.count - 1);
      currentRow.remaining = Math.max(0, currentRow.remaining - 1);
      if (currentRow.count === 0) {
        this.deckRows.delete(currentKey);
      }
    }

    const row = targetRow ?? {
      name: targetName,
      count: 0,
      remaining: 0,
      drawn: 0,
      played: 0,
      cardId: targetCardId
    };
    row.count += 1;
    row.remaining += 1;
    if (!targetRow) {
      this.deckRows.set(targetKey, row);
      if (row.cardId) {
        this.deckRowsByCardId.set(normalizeCardId(row.cardId), row);
      }
    }
    this.insertedDeckEntityRowKeys.set(entityId, targetKey);
  }

  private updateFriendlyDeckSnapshot(isFriendly: boolean, fromZone: Zone | undefined, toZone: Zone) {
    const snapshot = this.friendlyDeckSnapshot;
    if (!snapshot || !isFriendly) {
      return;
    }

    const delta = fromZone === "DECK" && toZone !== "DECK"
      ? -1
      : fromZone !== "DECK" && toZone === "DECK"
        ? 1
        : 0;
    if (delta === 0) {
      return;
    }

    this.friendlyDeckSnapshot = {
      ...snapshot,
      remainingDeckSize: Math.max(0, Math.min(snapshot.initialDeckSize, snapshot.remainingDeckSize + delta))
    };
  }

  private resolveDeckRow(cardName?: string, cardId?: string): CardTrackerRow | undefined {
    if (cardId) {
      const row = this.deckRowsByCardId.get(normalizeCardId(cardId));
      if (row) {
        return row;
      }
    }

    if (!cardName) {
      return undefined;
    }

    const matches = [...this.deckRows.values()].filter((row) => normalizeCardKey(row.name) === normalizeCardKey(cardName));
    if (matches.length !== 1) {
      return undefined;
    }

    const row = matches[0];
    return cardId && row.cardId ? undefined : row;
  }

  private buildFriendlyZoneCards(zones: ReadonlySet<Zone>): TrackerZoneCard[] {
    if (this.friendlyController === undefined) {
      return [];
    }

    const cards = new Map<string, TrackerZoneCard>();
    for (const entity of this.entities.values()) {
      if (entity.controller !== this.friendlyController || !entity.zone || !zones.has(entity.zone)) {
        continue;
      }

      const card = this.resolveTrackerZoneCard(entity) ?? (
        zones === FRIENDLY_HAND_ZONES && !this.isKnownNonDisplayableEntity(entity)
          ? { name: UNRESOLVED_HAND_CARD_NAME, count: 1 }
          : undefined
      );
      if (!card) {
        continue;
      }

      const key = card.cardId ? `id:${normalizeCardId(card.cardId)}` : `name:${normalizeCardKey(card.name)}`;
      const current = cards.get(key);
      if (current) {
        current.count += 1;
      } else {
        cards.set(key, card);
      }
    }

    return [...cards.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  private resolveTrackerZoneCard(entity: EntitySnapshot): TrackerZoneCard | undefined {
    const deckRow = this.resolveDeckRow(entity.name, entity.cardId);
    const cardInfo =
      this.findCardInfo(entity.cardId, entity.name) ?? this.findCardInfo(deckRow?.cardId, deckRow?.name);
    const displayClassification = cardInfo ? classifyCardInfo(cardInfo) : "unknown";

    if (displayClassification === "non-displayable") {
      return undefined;
    }

    if (!deckRow && displayClassification !== "displayable") {
      return undefined;
    }

    const name = deckRow?.name ?? cardInfo?.name ?? entity.name;
    if (!name) {
      return undefined;
    }

    const cardId = deckRow?.cardId ?? entity.cardId ?? cardInfo?.cardId ?? cardInfo?.id;
    return {
      name,
      count: 1,
      ...(cardId ? { cardId } : {}),
      ...(cardInfo && this.cardDatabase
        ? { details: this.buildLegacyInlineCardDetails(cardInfo, "friendly") }
        : {})
    };
  }

  private buildOpponentZones() {
    const deck = new Map<string, TrackerZoneCard>();
    const hand = new Map<string, TrackerZoneCard>();
    const other = new Map<string, TrackerZoneCard>();
    let deckCount = 0;
    let handCount = 0;

    for (const entity of this.entities.values()) {
      if (!this.isKnownOpponentController(entity.controller) || !entity.zone) continue;
      if (entity.zone === "DECK") deckCount += 1;
      if (entity.zone === "HAND") handCount += 1;

      const target = entity.zone === "DECK"
        ? deck
        : entity.zone === "HAND"
          ? hand
          : OPPONENT_OTHER_ZONES.has(entity.zone) ? other : undefined;
      if (!target) continue;

      const card = this.resolveOpponentZoneCard(entity);
      if (!card) {
        continue;
      }
      addZoneCard(target, card);
    }

    return {
      deck: sortZoneCards(deck.values()),
      hand: sortZoneCards(hand.values()),
      other: sortZoneCards(other.values()),
      deckCount,
      handCount
    };
  }

  private buildCardTracking(opponentSecretSlots: readonly OpponentSecretSlot[]): PublicCardTracking {
    const friendly: PublicCardTracking["friendly"] = {
      current: this.buildPublicCurrentZones("friendly", opponentSecretSlots),
      burned: this.buildPublicBurnHistory("friendly"),
      used: this.buildPublicUseHistory("friendly")
    };
    const opponent: PublicCardTracking["opponent"] = {
      current: this.buildPublicCurrentZones("opponent", opponentSecretSlots),
      burned: this.buildPublicBurnHistory("opponent"),
      used: this.buildPublicUseHistory("opponent")
    };
    return {
      schemaVersion: 1,
      gameKey: this.gameKey,
      friendly,
      opponent,
      opponentSecretSlots,
      detailsByCardKey: this.buildPublicCardDetailsIndex(friendly, opponent),
      contextDetailsBySideAndCardKey: {
        friendly: this.buildPublicCardContextDetailsIndex(friendly, "friendly"),
        opponent: this.buildPublicCardContextDetailsIndex(opponent, "opponent")
      },
      deckInsertions: {
        friendly: this.buildDeckInsertionTracking("friendly"),
        opponent: this.buildDeckInsertionTracking("opponent")
      }
    };
  }

  private buildPublicCardDetailsIndex(
    friendly: PublicCardTracking["friendly"],
    opponent: PublicCardTracking["opponent"]
  ): Readonly<Record<string, CardDetails>> {
    if (!this.cardDatabase) {
      return {};
    }

    const detailsByCardKey: Record<string, CardDetails> = {};
    const addCard = (card: Omit<PublicKnownCard, "count">) => {
      if (detailsByCardKey[card.cardKey]) {
        return;
      }
      const cardInfo = this.findCardInfo(card.cardId, card.name);
      if (!cardInfo) {
        return;
      }
      detailsByCardKey[card.cardKey] = toCardDetails(this.cardDatabase!, cardInfo);
    };
    const addPlayerCards = (player: PublicCardTracking["friendly"]) => {
      for (const group of Object.values(player.current)) {
        for (const card of group.cards) {
          addCard(card);
        }
      }
      for (const history of [player.used, player.burned]) {
        for (const item of history.items) {
          if (item.card) {
            addCard(item.card);
          }
        }
      }
    };

    addPlayerCards(friendly);
    addPlayerCards(opponent);
    return detailsByCardKey;
  }

  private buildPublicCardContextDetailsIndex(
    player: PublicCardTracking["friendly"],
    side: CardOutcomeSide
  ): Readonly<Record<string, PublicCardContextDetails>> {
    if (!this.cardDatabase) {
      return {};
    }

    const detailsByCardKey: Record<string, PublicCardContextDetails> = {};
    const addCard = (card: Omit<PublicKnownCard, "count">) => {
      if (detailsByCardKey[card.cardKey]) {
        return;
      }
      const cardInfo = this.findCardInfo(card.cardId, card.name);
      if (!cardInfo) {
        return;
      }
      const details = this.buildCardContextDetails(cardInfo, side);
      if (Object.keys(details).length > 0) {
        detailsByCardKey[card.cardKey] = details;
      }
    };

    for (const group of Object.values(player.current)) {
      for (const card of group.cards) {
        addCard(card);
      }
    }
    for (const history of [player.used, player.burned]) {
      for (const item of history.items) {
        if (item.card) {
          addCard(item.card);
        }
      }
    }
    return detailsByCardKey;
  }

  private buildPublicCurrentZones(
    side: CardOutcomeSide,
    opponentSecretSlots: readonly OpponentSecretSlot[]
  ): Readonly<Record<PublicCardZone, PublicCardZoneGroup>> {
    const groups = createMutablePublicZoneGroups();

    if (side === "friendly") {
      for (const row of this.deckRows.values()) {
        if (row.remaining <= 0) {
          continue;
        }
        groups.deck.totalCount += row.remaining;
        if (row.unresolved) {
          continue;
        }
        const card = this.toPublicKnownCard(row.cardId, row.name);
        if (card) {
          addPublicKnownCard(groups.deck.cards, { ...card, count: row.remaining });
        }
      }
    }

    for (const entity of this.entities.values()) {
      if (!this.isCountableCardEntity(entity)) {
        continue;
      }
      const entitySide = this.isFriendlyController(entity.controller)
        ? "friendly"
        : this.isKnownOpponentController(entity.controller) ? "opponent" : undefined;
      if (entitySide !== side) {
        continue;
      }
      const publicZone = toPublicCardZone(entity.zone);
      if (!publicZone || (side === "friendly" && publicZone === "deck") || (side === "opponent" && publicZone === "secret")) {
        continue;
      }
      const group = groups[publicZone];
      group.totalCount += 1;
      const card = this.toPublicKnownCard(entity.cardId, entity.name);
      if (card) {
        addPublicKnownCard(group.cards, card);
      }
    }

    if (side === "opponent") {
      groups.secret.totalCount = opponentSecretSlots.length;
      groups.secret.cards.clear();
      for (const slot of opponentSecretSlots) {
        const card = slot.revealedCardId
          ? this.toPublicKnownCard(slot.revealedCardId)
          : undefined;
        if (card) {
          addPublicKnownCard(groups.secret.cards, card);
        }
      }
    }

    return {
      deck: finalizePublicZoneGroup(groups.deck),
      hand: finalizePublicZoneGroup(groups.hand),
      play: finalizePublicZoneGroup(groups.play),
      secret: finalizePublicZoneGroup(groups.secret),
      graveyard: finalizePublicZoneGroup(groups.graveyard),
      removed: finalizePublicZoneGroup(groups.removed)
    };
  }

  private buildPublicUseHistory(side: CardOutcomeSide): PublicCardHistoryGroup {
    const records = this.cardUses.filter((use) => use.side === side);
    const items = records.slice(-30).reverse().map((use) => {
      const card = this.toPublicHistoryCard(use.entityId, use.cardId, use.name);
      const outcomeSections = this.buildCardOutcomeSectionsForUsage(use.usageId);
      return {
        id: use.usageId,
        sequence: use.sequence,
        entityId: use.entityId,
        ...(use.turn !== undefined ? { turn: use.turn } : {}),
        ...(card ? { card } : {}),
        ...(outcomeSections.length > 0 ? { outcomeSections } : {}),
        confidence: "confirmed" as const
      };
    });
    return {
      totalCount: records.length,
      items,
      truncated: records.length > items.length
    };
  }

  private resolveCardInfo(cardId?: string, name?: string, entityId?: string): CardInfo | undefined {
    const finalEntity = entityId ? this.entities.get(entityId) : undefined;
    const resolvedCardId = finalEntity?.cardId ?? cardId;
    const resolvedName = finalEntity?.name ?? name;
    const byId = resolvedCardId ? this.cardInfoByCardId.get(normalizeCardId(resolvedCardId)) : undefined;
    return byId ?? (resolvedName ? this.cardInfoByName.get(normalizeCardKey(resolvedName)) : undefined);
  }

  private buildPublicBurnHistory(side: CardOutcomeSide): PublicCardHistoryGroup {
    const records = this.burns.filter((burn) => burn.side === side);
    const items = records.slice(-30).reverse().map((burn) => {
      const card = this.toPublicHistoryCard(burn.entityId, burn.cardId, burn.name);
      return {
        id: burn.burnId,
        sequence: burn.sequence,
        entityId: burn.entityId,
        ...(burn.turn !== undefined ? { turn: burn.turn } : {}),
        ...(card ? { card } : {}),
        confidence: burn.confidence
      };
    });
    return {
      totalCount: records.length,
      items,
      truncated: records.length > items.length
    };
  }

  private toPublicHistoryCard(
    entityId: string,
    recordedCardId?: string,
    recordedName?: string
  ): Omit<PublicKnownCard, "count"> | undefined {
    const entity = this.entities.get(entityId);
    const lookupCardId = recordedCardId ?? entity?.cardId;
    const lookupName = recordedName ?? entity?.name;
    const cardInfo = this.findCardInfo(lookupCardId, lookupName);
    const cardId = recordedCardId ?? entity?.cardId ?? cardInfo?.cardId ?? cardInfo?.id;
    const name = recordedName ?? entity?.name ?? cardInfo?.name;
    if (!name) {
      return undefined;
    }
    return {
      cardKey: createPublicCardKey(cardId, name),
      ...(cardId ? { cardId } : {}),
      name
    };
  }

  private toPublicKnownCard(cardId?: string, rawName?: string): PublicKnownCard | undefined {
    const cardInfo = this.findCardInfo(cardId, rawName);
    const name = cardInfo?.name ?? this.resolveCardName(rawName, cardId);
    const resolvedCardId = cardId ?? cardInfo?.cardId ?? cardInfo?.id;
    if (!name) {
      return undefined;
    }
    return {
      cardKey: createPublicCardKey(resolvedCardId, name),
      ...(resolvedCardId ? { cardId: resolvedCardId } : {}),
      name,
      count: 1
    };
  }

  private countCardsInZone(controller: number | undefined, zone: Zone): number | undefined {
    if (controller === undefined) {
      return undefined;
    }
    return [...this.entities.values()].filter(
      (entity) =>
        entity.controller === controller &&
        entity.zone === zone &&
        this.isCountableCardEntity(entity)
    ).length;
  }

  private isCountableCardEntity(entity: EntitySnapshot): boolean {
    if (!entity.zone || !PUBLIC_CARD_ZONES.has(entity.zone) || entity.attachedToEntityId) {
      return false;
    }
    const cardInfo = this.findCardInfo(entity.cardId, entity.name);
    if (cardInfo && classifyCardInfo(cardInfo) === "non-displayable") {
      return false;
    }
    if (entity.cardType) {
      const cardType = entity.cardType.replace(/[\s_-]+/g, "").toUpperCase();
      if (NON_DISPLAYABLE_CARD_TYPES.has(cardType) || cardType === "GAME") {
        return false;
      }
    }
    return true;
  }

  private buildGlobalEffects(effects: ReadonlyMap<string, EntitySnapshot>) {
    const cards = new Map<string, TrackerZoneCard>();
    for (const entity of effects.values()) {
      const cardInfo = this.findCardInfo(entity.cardId, entity.name);
      const name = cardInfo?.name ?? entity.name;
      if (!name) continue;
      const cardId = entity.cardId ?? cardInfo?.cardId ?? cardInfo?.id;
      addZoneCard(cards, {
        name,
        count: 1,
        ...(cardId ? { cardId } : {}),
        ...(cardInfo && this.cardDatabase
          ? { details: this.buildLegacyInlineCardDetails(cardInfo, "none") }
          : {})
      });
    }
    return sortZoneCards(cards.values());
  }

  private resolveOpponentZoneCard(entity: EntitySnapshot): TrackerZoneCard | undefined {
    const cardInfo = this.findCardInfo(entity.cardId, entity.name);
    if (cardInfo && classifyCardInfo(cardInfo) === "non-displayable") return undefined;
    const name = cardInfo?.name ?? entity.name;
    if (!name) return undefined;
    const cardId = entity.cardId ?? cardInfo?.cardId ?? cardInfo?.id;
    return {
      name,
      count: 1,
      ...(cardId ? { cardId } : {}),
      ...(cardInfo && this.cardDatabase
        ? { details: this.buildLegacyInlineCardDetails(cardInfo, "opponent") }
        : {})
    };
  }

  private isKnownNonDisplayableEntity(entity: EntitySnapshot): boolean {
    const cardInfo = this.findCardInfo(entity.cardId, entity.name);
    return cardInfo !== undefined && classifyCardInfo(cardInfo) === "non-displayable";
  }

  private findCardInfo(cardId?: string, name?: string): CardInfo | undefined {
    return (
      (cardId ? this.cardInfoByCardId.get(normalizeCardId(cardId)) : undefined) ??
      (name ? this.cardInfoByName.get(normalizeCardKey(name)) : undefined)
    );
  }

  private isFriendlyController(controller?: number) {
    return this.friendlyController !== undefined && controller === this.friendlyController;
  }

  private createMatchFlow() {
    return new MatchFlow(() => this.friendlyController);
  }

  private currentMatchTurn() {
    return this.matchFlow.snapshot()?.globalTurn;
  }

  private isKnownOpponentController(controller?: number) {
    return this.friendlyController !== undefined && controller !== undefined && controller !== this.friendlyController;
  }

  private rememberPlayerIdentity(playerId: number, playerName: string) {
    const normalizedName = normalizePlayerIdentityName(playerName);
    if (!normalizedName) {
      return;
    }
    this.playerIdentityIds.add(playerId);
    if (normalizedName === "UNKNOWN HUMAN PLAYER") {
      this.unknownPlayerIds.add(playerId);
      return;
    }

    this.playerIdByName.set(normalizedName, playerId);
    const withoutBattleTag = normalizedName.replace(/#\d+$/, "");
    if (withoutBattleTag !== normalizedName) {
      this.playerIdByName.set(withoutBattleTag, playerId);
    }
  }

  private updatePlayerCounter(event: Extract<ParsedLogEvent, { type: "player-counter" }>) {
    const playerId = event.playerId ?? this.resolveCounterPlayerId(event.playerName);
    if (playerId === undefined || event.value < 0) {
      return;
    }

    let counters: PlayerMatchCounters = this.matchCountersByPlayerId.get(playerId) ?? {};
    if (event.counter === "fatigue") {
      if (event.value > 0) {
        counters = { ...counters, nextFatigueDamage: event.value + 1 };
      } else {
        const { nextFatigueDamage: _nextFatigueDamage, ...remainingCounters } = counters;
        counters = remainingCounters;
      }
    } else if (event.counter === "corpses") {
      counters = { ...counters, corpses: event.value };
    } else {
      counters = { ...counters, spellsPlayed: event.value };
    }

    if (Object.keys(counters).length > 0) {
      this.matchCountersByPlayerId.set(playerId, counters);
    } else {
      this.matchCountersByPlayerId.delete(playerId);
    }
  }

  private resolveCounterPlayerId(playerName?: string) {
    const normalizedName = normalizePlayerIdentityName(playerName);
    if (!normalizedName) {
      return undefined;
    }

    const exactPlayerId = this.playerIdByName.get(normalizedName);
    if (exactPlayerId !== undefined) {
      return exactPlayerId;
    }

    return this.playerIdentityIds.size === 2 && this.unknownPlayerIds.size === 1
      ? this.unknownPlayerIds.values().next().value
      : undefined;
  }

  private buildMatchCounters(): PublicTrackerState["matchCounters"] {
    if (this.friendlyController === undefined || this.matchCountersByPlayerId.size === 0) {
      return undefined;
    }

    const friendly = this.matchCountersByPlayerId.get(this.friendlyController) ?? {};
    let opponent: PlayerMatchCounters = {};
    for (const [playerId, counters] of this.matchCountersByPlayerId) {
      if (playerId !== this.friendlyController) {
        opponent = { ...opponent, ...counters };
      }
    }

    return {
      friendly: { ...friendly },
      opponent
    };
  }

  private clearMatchCounters() {
    this.playerIdByName.clear();
    this.playerIdentityIds.clear();
    this.unknownPlayerIds.clear();
    this.matchCountersByPlayerId.clear();
  }

  private shouldWaitForFriendlyController(event: ParsedLogEvent) {
    if (event.type === "zone-change") {
      return this.friendlyController === undefined && this.resolveZoneEventController(event) !== undefined;
    }
    if (event.type !== "action-boundary" || event.phase !== "start" || event.action !== "play" || !event.entity?.id) {
      return false;
    }
    const controller = event.entity.controller ?? this.entities.get(event.entity.id)?.controller;
    return this.friendlyController === undefined || controller === undefined;
  }

  private flushPendingControllerEvents(entityId?: string) {
    if (this.friendlyController === undefined || this.pendingControllerEvents.length === 0) return;
    const ready: ParsedLogEvent[] = [];
    const waiting: ParsedLogEvent[] = [];
    for (const event of this.pendingControllerEvents) {
      const pendingEntityId = event.type === "action-boundary"
        ? event.entity?.id
        : event.type === "zone-change" ? event.entityId : undefined;
      const controller = event.type === "action-boundary"
        ? event.entity?.controller ?? (pendingEntityId ? this.entities.get(pendingEntityId)?.controller : undefined)
        : event.type === "zone-change" ? this.resolveZoneEventController(event) : undefined;
      if ((entityId === undefined || pendingEntityId === entityId) && controller !== undefined) {
        ready.push(event);
      } else {
        waiting.push(event);
      }
    }
    this.pendingControllerEvents = waiting;
    ready.forEach((event) => this.applyParsedEvent(event, true));
  }

  private resolveZoneEventController(event: ParsedLogEvent) {
    if (event.type !== "zone-change") {
      return undefined;
    }

    return event.controller ?? (event.entityId ? this.entities.get(event.entityId)?.controller : undefined);
  }

  private resolveCardName(rawName?: string, cardId?: string): string | undefined {
    if (cardId) {
      const deckRow = this.deckRowsByCardId.get(normalizeCardId(cardId));
      if (deckRow) {
        return deckRow.name;
      }

      const localizedName = this.cardNameByCardId.get(normalizeCardId(cardId));
      if (localizedName) {
        return localizedName;
      }
    }

    return rawName;
  }

  private addEvent(kind: TrackerEvent["kind"], player: TrackerEvent["player"], payload: Partial<TrackerEvent>) {
    this.eventCounter += 1;
    const turn = this.currentMatchTurn();
    this.events.push({
      id: `${Date.now()}-${this.eventCounter}`,
      at: new Date().toISOString(),
      kind,
      player,
      ...(turn !== undefined ? { turn } : {}),
      ...payload
    });
  }

  private withCardDetails(row: CardTrackerRow, context: "none" | "friendly" | "opponent" | true = "none"): CardTrackerRow {
    if (!this.cardDatabase) {
      return row;
    }

    const card = (row.cardId ? this.cardInfoByCardId.get(normalizeCardId(row.cardId)) : undefined) ?? this.cardInfoByName.get(normalizeCardKey(row.name));
    if (!card) {
      return row;
    }

    const details = this.buildLegacyInlineCardDetails(card, context);
    return { ...row, details };
  }

  private buildLegacyInlineCardDetails(
    card: CardInfo,
    context: "none" | "friendly" | "opponent" | true
  ): CardDetails {
    const details = context === "friendly" || context === true
      ? this.buildCardDetails(card, "friendly")
      : context === "opponent"
        ? this.buildCardDetails(card, "opponent")
        : toCardDetails(this.cardDatabase!, card);
    const {
      cardPoolSections: _cardPoolSections,
      cardOutcomeSections: _cardOutcomeSections,
      ...inlineDetails
    } = details;
    return inlineDetails;
  }

  private recordCardUse(
    entityId: string,
    side: CardOutcomeSide,
    cardId?: string,
    rawName?: string
  ): RecordedCardUse {
    const activeUsageId = this.activeUsageIdByEntity.get(entityId);
    const activeUse = activeUsageId
      ? this.cardUses.find((use) => use.usageId === activeUsageId)
      : undefined;
    if (activeUse) {
      return activeUse;
    }

    const sequence = this.nextCardHistorySequence();
    const name = this.resolveCardName(rawName, cardId);
    const turn = this.currentMatchTurn();
    const use: RecordedCardUse = {
      usageId: `${this.gameKey}:use:${sequence}`,
      sequence,
      entityId,
      side,
      action: "play",
      ...(turn !== undefined ? { turn } : {}),
      ...(cardId ? { cardId } : {}),
      ...(name ? { name } : {})
    };
    this.cardUses.push(use);
    this.activeUsageIdByEntity.set(entityId, use.usageId);
    return use;
  }

  private bindPendingCardOutcomeFrame(use: RecordedCardUse) {
    const frame = [...this.cardOutcomeBlockStack]
      .reverse()
      .find((candidate) =>
        !candidate.parent &&
        !candidate.suppressed &&
        !candidate.usageId &&
        (candidate.side === undefined || candidate.side === use.side) &&
        (candidate.sourceEntityId ?? candidate.entityId) === use.entityId
      );
    if (frame) {
      frame.side ??= use.side;
      frame.usageId = use.usageId;
    }
  }

  private recordBurn(input: {
    readonly entityId: string;
    readonly side: CardOutcomeSide;
    readonly cardId?: string;
    readonly name?: string;
    readonly fromZone: Zone;
    readonly toZone: Zone;
    readonly raw: string;
  }) {
    const fingerprint = createBurnTransitionFingerprint(input);
    if (fingerprint && this.recordedBurnFingerprints.has(fingerprint)) {
      return;
    }
    if (fingerprint) {
      this.recordedBurnFingerprints.add(fingerprint);
    }

    const sequence = this.nextCardHistorySequence();
    const turn = this.currentMatchTurn();
    this.burns.push({
      burnId: `${this.gameKey}:burn:${sequence}`,
      sequence,
      entityId: input.entityId,
      side: input.side,
      ...(turn !== undefined ? { turn } : {}),
      ...(input.cardId ? { cardId: input.cardId } : {}),
      ...(input.name ? { name: input.name } : {}),
      confidence: "inferred",
      transitionFingerprint: fingerprint ?? `${this.gameKey}:burn-transition:${sequence}`
    });
  }

  private nextCardHistorySequence() {
    this.cardHistorySequence += 1;
    return this.cardHistorySequence;
  }

  private recordDeadMinion(entityId: string, card: CardInfo, player: "friendly" | "opponent") {
    if (this.recordedDeathEntityIds.has(entityId)) {
      return;
    }

    this.recordedDeathEntityIds.add(entityId);
    (player === "friendly" ? this.friendlyDeadMinionsThisGame : this.opponentDeadMinionsThisGame).push(card);
  }

  private clearMatchCardHistory() {
    this.cardUses = [];
    this.burns = [];
    this.activeUsageIdByEntity.clear();
    this.recordedBurnFingerprints.clear();
    this.cardHistorySequence = 0;
    this.cardOutcomeCompletionSequence = 0;
    this.friendlyDeadMinionsThisGame = [];
    this.opponentDeadMinionsThisGame = [];
    this.recordedDeathEntityIds.clear();
    this.openingHandEntityIdsByController.clear();
    this.openingHandsCaptured = false;
    this.pendingUnknownDeckExitZones.clear();
    this.cardOutcomeBlockStack = [];
    this.outcomesByUsageId.clear();
    this.completedCardOutcomeDedupKeys.clear();
    this.cardOutcomeOccurrencesBySource.clear();
    this.cardOutcomeFrameSequence = 0;
    this.lastBlockBoundary = undefined;
  }

  private captureOpeningHands() {
    if (this.openingHandsCaptured) {
      return;
    }

    this.openingHandsCaptured = true;
    const entityIdsByController = new Map<number, string[]>();
    for (const entity of this.entities.values()) {
      if (entity.zone !== "HAND" || entity.controller === undefined || !entity.id) {
        continue;
      }
      const entityIds = entityIdsByController.get(entity.controller) ?? [];
      entityIds.push(entity.id);
      entityIdsByController.set(entity.controller, entityIds);
    }
    this.openingHandEntityIdsByController = entityIdsByController;
  }

  private buildCardDetails(card: CardInfo, side: CardOutcomeSide): CardDetails {
    const details = toCardDetails(this.cardDatabase!, card);
    const cardOutcomeSections = this.buildCardOutcomeSectionsForCard(card, side);
    const contextDetails = this.buildCardContextDetails(card, side);
    return {
      ...details,
      ...contextDetails,
      ...(cardOutcomeSections.length > 0 ? { cardOutcomeSections } : {})
    };
  }

  private buildCardContextDetails(card: CardInfo, side: CardOutcomeSide): PublicCardContextDetails {
    const cardId = normalizeCardId(card.cardId ?? card.id ?? "");
    const friendlyUsed = this.resolveKnownCardsFromUses("friendly");
    const opponentUsed = this.resolveKnownCardsFromUses("opponent");
    const relationSections = resolveMatchCardRelations(card, {
      friendlyUsed,
      opponentUsed,
      friendlyDeadMinions: this.friendlyDeadMinionsThisGame,
      opponentDeadMinions: this.opponentDeadMinionsThisGame
    });
    const sideUsed = side === "friendly" ? friendlyUsed : opponentUsed;
    const playedSpellCards = cardId === GALACTIC_PROJECTION_ORB_CARD_ID
      ? sideUsed
          .filter((usedCard) => usedCard.cardType === "法术")
          .slice()
          .sort((left, right) =>
            (left.manaCost ?? Number.MAX_SAFE_INTEGER) - (right.manaCost ?? Number.MAX_SAFE_INTEGER)
          )
      : undefined;
    const playedSpellsThisGame = playedSpellCards?.map(toRelatedCardInfo);
    const counterPlayerId = side === "friendly"
      ? this.friendlyController
      : [...this.matchCountersByPlayerId.keys()].find((playerId) =>
          this.isKnownOpponentController(playerId)
        ) ?? [...this.entities.values()].find((entity) =>
          entity.controller !== undefined && this.isKnownOpponentController(entity.controller)
        )?.controller;
    const loggedSpellCount = counterPlayerId === undefined
      ? undefined
      : this.matchCountersByPlayerId.get(counterPlayerId)?.spellsPlayed;
    const playedSpellsThisGameCount = playedSpellsThisGame
      ? Math.max(loggedSpellCount ?? 0, playedSpellsThisGame.length)
      : undefined;
    const openingHandCards = side === "friendly" && THE_FINS_BEYOND_TIME_CARD_IDS.has(cardId)
      ? (this.friendlyController === undefined
          ? []
          : (this.openingHandEntityIdsByController.get(this.friendlyController) ?? [])
              .flatMap((entityId) => {
                const entity = this.entities.get(entityId);
                const openingCard = this.findCardInfo(entity?.cardId, entity?.name);
                return openingCard && !isCoinCard(openingCard)
                  ? [toRelatedCardInfo(openingCard)]
                  : [];
              }))
      : undefined;
    const fallbackResurrectionCount = this.gameActive && KELTHUZAD_CARD_IDS.has(cardId)
      ? (side === "friendly" ? this.friendlyDeadMinionsThisGame : this.opponentDeadMinionsThisGame)
          .filter((deadMinion) => KELTHUZAD_UNSTABLE_SKELETON_CARD_IDS.has(
            normalizeCardId(deadMinion.cardId ?? deadMinion.id ?? "")
          ))
          .length
      : undefined;
    const resurrectionCount = KELTHUZAD_CARD_IDS.has(cardId)
      ? (counterPlayerId === undefined
          ? undefined
          : this.kelthuzadResurrectionCountByController.get(counterPlayerId)) ?? fallbackResurrectionCount
      : undefined;
    const gameContextSections = [
      ...relationSections,
      ...(openingHandCards === undefined
        ? []
        : [{
            key: "friendly-opening-hand",
            title: "我的起始手牌",
            emptyText: this.openingHandsCaptured
              ? "本局起始手牌尚未识别"
              : "换牌结束后显示起始手牌",
            cards: openingHandCards
          }]),
      ...(resurrectionCount === undefined
        ? []
        : [{
            key: "kelthuzad-resurrection-count",
            title: "会复活",
            emptyText: resurrectionCount === 0
              ? "本局还没有不稳定的骷髅死亡"
              : "数量来自对局日志",
            cards: [],
            totalCount: resurrectionCount
          }])
    ];
    return {
      ...(gameContextSections.length > 0 ? { gameContextSections } : {}),
      ...(playedSpellsThisGame
        ? {
            playedSpellsThisGame,
            playedSpellsThisGameCount,
            ...(playedSpellsThisGameCount! > playedSpellsThisGame.length
              ? { playedSpellsThisGameIncomplete: true }
              : {})
          }
        : {})
    };
  }

  private resolveKnownCardsFromUses(side: CardOutcomeSide): CardInfo[] {
    return this.cardUses.flatMap((use) => {
      if (use.side !== side) {
        return [];
      }
      const entity = this.entities.get(use.entityId);
      const card = this.findCardInfo(use.cardId ?? entity?.cardId, use.name ?? entity?.name);
      return card ? [card] : [];
    });
  }

  private applyCardOutcomeBoundary(
    event: Extract<ParsedLogEvent, { type: "block-boundary" }>
  ): CardOutcomeBlockFrame | undefined {
    const fingerprint = blockBoundaryFingerprint(event);
    const source = cardOutcomeLogSource(event.raw).counterKey;
    if (
      this.lastBlockBoundary?.fingerprint === fingerprint &&
      this.lastBlockBoundary.source !== source &&
      isMirroredPowerLogSource(this.lastBlockBoundary.source) &&
      isMirroredPowerLogSource(source)
    ) {
      return undefined;
    }
    this.lastBlockBoundary = { fingerprint, source };

    if (event.phase === "end") {
      const frame = this.cardOutcomeBlockStack.pop();
      if (frame?.capture && !frame.suppressed) {
        this.completeCardOutcome(
          frame.capture,
          frame.usageId,
          frame.rootSemanticKey,
          frame.rootLogSource
        );
      }
      return frame;
    }

    const parent = this.cardOutcomeBlockStack.at(-1);
    const boundaryKey = `${event.blockType ?? "UNKNOWN"}:${event.entity?.id ?? "unknown"}:${fingerprint}`;
    this.cardOutcomeFrameSequence += 1;
    const frameKey = `${boundaryKey}:frame:${this.cardOutcomeFrameSequence}`;
    const frame: CardOutcomeBlockFrame = {
      key: frameKey,
      blockType: event.blockType,
      entityId: event.entity?.id,
      entity: event.entity,
      target: event.target,
      parent,
      rootSemanticKey: parent?.rootSemanticKey ?? boundaryKey,
      rootLogSource: parent?.rootLogSource ?? cardOutcomeLogSource(event.raw),
      parentCards: parent?.cards,
      parentSourceEntityId: parent?.sourceEntityId,
      parentAcceptsFullEntityOutcomes: parent?.acceptsFullEntityOutcomes,
      side: this.cardOutcomeSide(event.entity?.controller) ?? parent?.side,
      usageId: parent?.usageId,
      suppressed: parent?.suppressed
    };
    this.cardOutcomeBlockStack.push(frame);
    if (!frame.suppressed) {
      const existing = event.entity?.id ? this.entities.get(event.entity.id) : undefined;
      const entity = existing ? { ...existing, ...event.entity } : event.entity;
      if (entity) {
        this.configureCardOutcomeFrame(frame, entity);
      }
    }
    return frame;
  }

  private applySecretActionBoundary(
    phase: "start" | "end",
    frame: CardOutcomeBlockFrame
  ) {
    if (frame.blockType !== "PLAY" && frame.blockType !== "ATTACK") {
      return;
    }
    if (phase === "end") {
      this.secretTracker.endAction();
      return;
    }

    const existing = frame.entity?.id ? this.entities.get(frame.entity.id) : undefined;
    const entity = existing ? { ...existing, ...frame.entity } : frame.entity;
    const targetExisting = frame.target?.id ? this.entities.get(frame.target.id) : undefined;
    const target = targetExisting ? { ...targetExisting, ...frame.target } : frame.target;
    if (!entity || !this.isFriendlyController(entity.controller)) {
      this.secretTracker.beginAction("other");
      return;
    }

    if (frame.blockType === "PLAY") {
      const info = this.findCardInfo(entity.cardId, entity.name);
      const cardType = info?.cardType ?? entity.cardType;
      const kind = isCardType(cardType, "SPELL", "法术")
        ? "friendly-spell"
        : isCardType(cardType, "MINION", "随从") ? "friendly-minion" : "other";
      const canBeCountered = !info?.mechanics?.some((mechanic) =>
        mechanic === "CANT_BE_COUNTERED" || mechanic === "CANTBECOUNTERED"
      );
      this.secretTracker.beginAction({
        kind,
        canBeCountered,
        opponentBoardHasSpace: this.opponentBoardHasSpace()
      });
      return;
    }

    const targetInfo = this.findCardInfo(target?.cardId, target?.name);
    const targetCardType = targetInfo?.cardType ?? target?.cardType;
    const attacksOpponentHero =
      this.isKnownOpponentController(target?.controller) &&
      isCardType(targetCardType, "HERO", "英雄");
    this.secretTracker.beginAction({
      kind: attacksOpponentHero ? "friendly-attack-opponent-hero" : "other",
      opponentBoardHasSpace: this.opponentBoardHasSpace()
    });
  }

  private opponentBoardHasSpace(): boolean {
    const occupied = [...this.entities.values()].filter((entity) => {
      if (entity.zone !== "PLAY" || !this.isKnownOpponentController(entity.controller)) {
        return false;
      }
      const info = this.findCardInfo(entity.cardId, entity.name);
      const cardType = info?.cardType ?? entity.cardType;
      if (cardType) {
        return isCardType(cardType, "MINION", "随从") ||
          isCardType(cardType, "LOCATION", "地标");
      }
      return Boolean(entity.cardId || entity.name);
    }).length;
    return occupied < 7;
  }

  private resolveCurrentCardOutcomeFrame(entity: EntitySnapshot) {
    const frame = [...this.cardOutcomeBlockStack]
      .reverse()
      .find((candidate) => !candidate.configured && candidate.entityId === entity.id);
    if (frame && !frame.suppressed) {
      this.configureCardOutcomeFrame(frame, entity);
    }
  }

  private configureCardOutcomeFrame(frame: CardOutcomeBlockFrame, entity: EntitySnapshot) {
    const card = this.findCardInfo(entity.cardId, entity.name);
    if (!card) {
      return;
    }
    frame.configured = true;
    frame.side ??= this.cardOutcomeSide(entity.controller);

    if (card.cardType !== "法术") {
      frame.cards = frame.parentCards;
      frame.sourceEntityId = frame.parentSourceEntityId;
      frame.acceptsFullEntityOutcomes = frame.parentAcceptsFullEntityOutcomes;
      return;
    }

    if (entity.id && entity.id === frame.parentSourceEntityId) {
      frame.cards = frame.parentCards;
      frame.sourceEntityId = frame.parentSourceEntityId;
      frame.acceptsFullEntityOutcomes = frame.parentAcceptsFullEntityOutcomes;
      return;
    }

    if (frame.parentCards) {
      const node = frame.parentCards.find((candidate) => candidate.entityId === entity.id) ?? {
        key: frame.key,
        entityId: entity.id,
        card,
        children: []
      };
      if (!frame.parentCards.includes(node)) {
        frame.parentCards.push(node);
      }
      frame.cards = node.children;
    } else {
      frame.cards = [];
    }
    frame.sourceEntityId = entity.id;
    frame.acceptsFullEntityOutcomes = isRandomSpellPoolCard(card);
    if (!frame.parentCards) {
      frame.capture = {
        key: frame.key,
        source: card,
        cards: frame.cards,
        keepWhenEmpty: isRandomSpellPoolCard(card)
      };
    }
  }

  private recordFullEntityCardOutcome(entity: EntitySnapshot) {
    const frame = this.cardOutcomeBlockStack.at(-1);
    if (
      !frame?.cards ||
      !frame.acceptsFullEntityOutcomes ||
      frame.suppressed ||
      !entity.id ||
      entity.id === frame.sourceEntityId
    ) {
      return;
    }
    const card = this.findCardInfo(entity.cardId, entity.name);
    if (card?.cardType !== "法术" || frame.cards.some((candidate) => candidate.entityId === entity.id)) {
      return;
    }
    frame.cards.push({
      key: `entity:${entity.id}`,
      entityId: entity.id,
      card,
      children: []
    });
  }

  private completeCardOutcome(
    outcome: RecordedCardOutcome,
    usageId: string | undefined,
    rootSemanticKey: string,
    logSource: CardOutcomeLogSource
  ) {
    if (!usageId || (!outcome.keepWhenEmpty && outcome.cards.length === 0)) {
      return;
    }
    const captureFingerprint = [
      usageId,
      rootSemanticKey,
      cardOutcomeContentFingerprint(outcome)
    ].join(":");
    const sourceOccurrenceKey = `${logSource.counterKey}:${captureFingerprint}`;
    const occurrence = (this.cardOutcomeOccurrencesBySource.get(sourceOccurrenceKey) ?? 0) + 1;
    this.cardOutcomeOccurrencesBySource.set(sourceOccurrenceKey, occurrence);
    const dedupKey = `${logSource.dedupGroup}:${captureFingerprint}:occurrence:${occurrence}`;
    if (this.completedCardOutcomeDedupKeys.has(dedupKey)) {
      return;
    }
    this.completedCardOutcomeDedupKeys.add(dedupKey);
    this.cardOutcomeCompletionSequence += 1;
    const records = this.outcomesByUsageId.get(usageId) ?? [];
    records.push({
      ...outcome,
      completionSequence: this.cardOutcomeCompletionSequence
    });
    this.outcomesByUsageId.set(usageId, records);
  }

  private buildCardOutcomeSectionsForUsage(usageId: string): readonly CardOutcomeSection[] {
    const use = this.cardUses.find((candidate) => candidate.usageId === usageId);
    if (!use) {
      return [];
    }
    const outcomes = [...(this.outcomesByUsageId.get(usageId) ?? [])]
      .sort((left, right) => left.completionSequence - right.completionSequence);
    if (outcomes.length === 0) {
      return [];
    }
    return [{
      key: `${usageId}:outcome`,
      title: "本次实际施放",
      emptyText: "日志中没有识别到实际施放的法术",
      cards: outcomes.flatMap((outcome) => outcome.cards.map(toPublicCardOutcomeNode))
    }];
  }

  private buildCardOutcomeSectionsForCard(
    card: CardInfo,
    side: CardOutcomeSide
  ): readonly CardOutcomeSection[] {
    const cardId = normalizeCardId(card.cardId ?? card.id ?? "");
    const sections = this.cardUses
      .filter((use) => use.side === side && this.resolveCardUseId(use) === cardId)
      .flatMap((use) => this.buildCardOutcomeSectionsForUsage(use.usageId));
    return sections.map((section, index) => ({
      ...section,
      title: sections.length === 1 ? "本次实际施放" : `第${index + 1}次实际施放`
    }));
  }

  private resolveCardUseId(use: RecordedCardUse) {
    const entity = this.entities.get(use.entityId);
    const info = this.findCardInfo(use.cardId ?? entity?.cardId, use.name ?? entity?.name);
    return normalizeCardId(use.cardId ?? entity?.cardId ?? info?.cardId ?? info?.id ?? "");
  }

  private cardOutcomeSide(controller: number | undefined): CardOutcomeSide | undefined {
    return this.isFriendlyController(controller)
      ? "friendly"
      : this.isKnownOpponentController(controller) ? "opponent" : undefined;
  }

  private resolvePendingUnknownDeckExit(entity: EntitySnapshot, raw: string) {
    if (!entity.id || !entity.cardId || !this.pendingUnknownDeckExitZones.has(entity.id)) {
      return;
    }
    const toZone = this.pendingUnknownDeckExitZones.get(entity.id)!;
    this.pendingUnknownDeckExitZones.delete(entity.id);
    const card = this.findCardInfo(entity.cardId, entity.name);
    const deckRow = this.resolveDeckRow(card?.name ?? entity.name, entity.cardId);
    if (!deckRow) {
      return;
    }
    if (!deckRow.cardId) {
      deckRow.cardId = entity.cardId;
      this.deckRowsByCardId.set(normalizeCardId(entity.cardId), deckRow);
    }
    decrementRemaining(deckRow);
    deckRow.drawn += 1;
    this.addEvent("zone-change", "friendly", {
      cardName: card?.name ?? entity.name,
      cardId: entity.cardId,
      fromZone: "DECK",
      toZone,
      raw
    });
  }
}

function createMutablePublicZoneGroups(): Record<PublicCardZone, MutablePublicZoneGroup> {
  const createGroup = (): MutablePublicZoneGroup => ({ totalCount: 0, cards: new Map() });
  return {
    deck: createGroup(),
    hand: createGroup(),
    play: createGroup(),
    secret: createGroup(),
    graveyard: createGroup(),
    removed: createGroup()
  };
}

function finalizePublicZoneGroup(group: MutablePublicZoneGroup): PublicCardZoneGroup {
  const cards = [...group.cards.values()].sort((left, right) => left.name.localeCompare(right.name));
  const knownCount = cards.reduce((total, card) => total + card.count, 0);
  return {
    status: knownCount === group.totalCount ? "known" : "partial",
    knownCount,
    totalCount: group.totalCount,
    cards
  };
}

function addPublicKnownCard(target: Map<string, PublicKnownCard>, card: PublicKnownCard) {
  const existing = target.get(card.cardKey);
  target.set(card.cardKey, existing ? { ...existing, count: existing.count + card.count } : card);
}

function createPublicCardKey(cardId: string | undefined, name: string) {
  return cardId ? `id:${normalizeCardId(cardId)}` : `name:${normalizeCardKey(name)}`;
}

function toPublicCardZone(zone: Zone | undefined): PublicCardZone | undefined {
  if (zone === "DECK") return "deck";
  if (zone === "HAND") return "hand";
  if (zone === "PLAY") return "play";
  if (zone === "SECRET") return "secret";
  if (zone === "GRAVEYARD") return "graveyard";
  if (zone === "REMOVEDFROMGAME") return "removed";
  return undefined;
}

function createBurnTransitionFingerprint(input: {
  readonly entityId: string;
  readonly side: CardOutcomeSide;
  readonly fromZone: Zone;
  readonly toZone: Zone;
  readonly raw: string;
}) {
  const timestamp = input.raw.match(/\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/)?.[0];
  return timestamp
    ? `${timestamp}:${input.entityId}:${input.side}:${input.fromZone}->${input.toZone}`
    : undefined;
}

function toPublicCardOutcomeNode(node: RecordedCardOutcomeNode): CardOutcomeNode {
  return {
    key: node.key,
    card: toRelatedCardInfo(node.card),
    ...(node.children.length > 0 ? { children: node.children.map(toPublicCardOutcomeNode) } : {})
  };
}

function blockBoundaryFingerprint(event: Extract<ParsedLogEvent, { type: "block-boundary" }>): string {
  const timestamp = event.raw.match(/\b\d{2}:\d{2}:\d{2}\.\d+\b/)?.[0] ?? "";
  const boundary = event.raw.slice(Math.max(event.raw.indexOf("BLOCK_START"), event.raw.indexOf("BLOCK_END")));
  return `${event.phase}:${timestamp}:${boundary}`;
}

function isCardType(
  cardType: string | undefined,
  english: string,
  chinese: string
): boolean {
  const normalized = cardType?.trim().toUpperCase();
  return normalized === english || cardType?.trim() === chinese;
}

function cardOutcomeLogSource(raw: string): CardOutcomeLogSource {
  const source = raw.match(/\b(GameState|PowerTaskList)\.DebugPrintPower\(\)/)?.[1];
  if (source) {
    return {
      counterKey: source,
      dedupGroup: "hearthstone-power-log-copy"
    };
  }
  const fallback = raw.match(/\b([A-Za-z][\w.]*)\.DebugPrintPower\(\)/)?.[1] ?? "unknown";
  return {
    counterKey: fallback,
    dedupGroup: `source:${fallback}`
  };
}

function isMirroredPowerLogSource(source: string): boolean {
  return source === "GameState" || source === "PowerTaskList";
}

function cardOutcomeContentFingerprint(outcome: RecordedCardOutcome) {
  const cardIdentity = (card: CardInfo) => {
    const cardId = card.cardId ?? card.id;
    return cardId
      ? `id:${normalizeCardId(cardId)}`
      : `name:${normalizeCardKey(card.name)}`;
  };
  const serializeNode = (node: RecordedCardOutcomeNode): unknown => [
    cardIdentity(node.card),
    node.children.map(serializeNode)
  ];
  return JSON.stringify([
    cardIdentity(outcome.source),
    outcome.keepWhenEmpty,
    outcome.cards.map(serializeNode)
  ]);
}

function scoreCollectionDeck(deck: CollectionDeck, observations: readonly FriendlyObservation[]): number {
  const deckCounts = buildDeckCountIndex(deck.cards);
  const observedCounts = new Map<string, number>();
  let score = 0;

  for (const observation of observations) {
    const keys = observationKeys(observation);
    const key = keys.find((candidateKey) => deckCounts.has(candidateKey));
    if (!key) {
      return 0;
    }

    const nextObservedCount = (observedCounts.get(key) ?? 0) + 1;
    if (nextObservedCount > (deckCounts.get(key) ?? 0)) {
      return 0;
    }

    observedCounts.set(key, nextObservedCount);
    score += key.startsWith("id:") ? 3 : 1;
  }

  return score;
}

function buildDeckCountIndex(cards: readonly DeckCard[]) {
  const index = new Map<string, number>();
  for (const card of cards) {
    if (card.cardId) {
      index.set(`id:${normalizeCardId(card.cardId)}`, card.count);
    }
    index.set(`name:${normalizeCardKey(card.name)}`, card.count);
  }
  return index;
}

function observationKeys(observation: FriendlyObservation) {
  const keys = [`name:${normalizeCardKey(observation.cardName)}`];
  if (observation.rawCardName && normalizeCardKey(observation.rawCardName) !== normalizeCardKey(observation.cardName)) {
    keys.push(`name:${normalizeCardKey(observation.rawCardName)}`);
  }
  if (observation.cardId) {
    keys.unshift(`id:${normalizeCardId(observation.cardId)}`);
  }
  return keys;
}

function observationKey(observation: FriendlyObservation) {
  return observation.cardId ? `id:${normalizeCardId(observation.cardId)}` : `name:${normalizeCardKey(observation.cardName)}`;
}

function collapseFriendlyObservations(observations: readonly FriendlyObservation[]): FriendlyObservation[] {
  const withoutEntity: FriendlyObservation[] = [];
  const byEntity = new Map<string, FriendlyObservation>();
  for (const observation of observations) {
    if (observation.entityId === undefined) {
      withoutEntity.push(observation);
      continue;
    }
    const previous = byEntity.get(observation.entityId);
    if (!previous || observation.cardId || !previous.cardId) {
      byEntity.set(observation.entityId, observation);
    }
  }
  return [...withoutEntity, ...byEntity.values()];
}

function createWaitingDeckIdentity(): DeckIdentityEvidence {
  return {
    status: "waiting",
    source: "inferred",
    observedDistinctCards: 0,
    candidateCount: 0,
    bestScore: 0,
    scoreLead: 0
  };
}

function observationToEventPayload(observation: FriendlyObservation): Partial<TrackerEvent> {
  return {
    cardName: observation.cardName,
    cardId: observation.cardId,
    fromZone: observation.fromZone,
    toZone: observation.toZone,
    raw: observation.raw
  };
}

function decrementRemaining(row: CardTrackerRow) {
  row.remaining = Math.max(0, row.remaining - 1);
}

function addZoneCard(cards: Map<string, TrackerZoneCard>, card: TrackerZoneCard) {
  const key = card.cardId ? `id:${normalizeCardId(card.cardId)}` : `name:${normalizeCardKey(card.name)}`;
  const current = cards.get(key);
  if (current) current.count += card.count;
  else cards.set(key, card);
}

function sortZoneCards(cards: Iterable<TrackerZoneCard>, firstName?: string) {
  return [...cards].sort((left, right) => {
    if (left.name === firstName) return -1;
    if (right.name === firstName) return 1;
    return left.name.localeCompare(right.name);
  });
}

function isCoinCard(card: CardInfo): boolean {
  const cardId = normalizeCardId(card.cardId ?? card.id ?? "");
  const name = normalizeCardKey(card.name);
  return cardId === "game_005" ||
    /(?:^|_)coin\d*$/u.test(cardId) ||
    name === "幸运币" ||
    name === "the coin";
}

function normalizeCardKey(name: string) {
  return name.trim().toLocaleLowerCase();
}

function normalizePlayerIdentityName(name?: string) {
  return name?.replace(/\s+/g, " ").trim().toLocaleUpperCase();
}

function classifyCardInfo(card: CardInfo): "displayable" | "non-displayable" | "unknown" {
  if (card.cardTypeId !== undefined) {
    if (NON_DISPLAYABLE_CARD_TYPE_IDS.has(card.cardTypeId)) {
      return "non-displayable";
    }
    return DISPLAYABLE_CARD_TYPE_IDS.has(card.cardTypeId) ? "displayable" : "non-displayable";
  }

  if (card.cardType) {
    const cardType = card.cardType.replace(/[\s_-]+/g, "").toUpperCase();
    if (NON_DISPLAYABLE_CARD_TYPES.has(cardType)) {
      return "non-displayable";
    }
    return DISPLAYABLE_CARD_TYPES.has(cardType) ? "displayable" : "non-displayable";
  }

  const cardId = card.cardId ?? card.id;
  return cardId && /^HERO_/i.test(cardId) ? "non-displayable" : "unknown";
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
