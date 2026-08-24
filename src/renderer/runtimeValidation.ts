import {
  TRACKER_ACCENT_COLORS,
  type MatchHistoryResult,
  type PublicTrackerState,
  type TrackerSettings
} from "../shared/types";
import type { ArenaInsightsResult, CollectionInsightsResult } from "./types";

const trackerStatuses = new Set(["idle", "watching", "paused", "missing-log", "error"]);
const arenaStatuses = new Set(["inactive", "drafting", "redrafting", "complete", "playing"]);
const arenaScoreTiers = new Set(["s", "a", "b", "c", "d", "f", "unknown"]);
const matchModes = new Set(["standard", "wild", "arena", "unknown"]);
const matchResults = new Set(["win", "loss", "tie"]);
const eventKinds = new Set([
  "game-start", "game-end", "draw", "friendly-play", "opponent-play", "arena-pick", "zone-change", "info"
]);
const eventPlayers = new Set(["friendly", "opponent", "unknown"]);
const trackerZones = new Set(["DECK", "HAND", "PLAY", "GRAVEYARD", "REMOVEDFROMGAME", "SETASIDE", "SECRET", "UNKNOWN"]);
const publicCardZones = ["deck", "hand", "play", "secret", "graveyard", "removed"] as const;
const publicTrackingStatuses = new Set(["known", "partial", "unknown"]);
const publicTrackingConfidences = new Set(["confirmed", "inferred"]);
const deckIdentityStatuses = new Set(["confirmed", "probable", "waiting"]);
const deckIdentitySources = new Set(["decks-log", "screen", "inferred"]);
const MAX_PUBLIC_HISTORY_ITEMS = 30;
const MAX_OUTCOME_TREE_DEPTH = 16;
const MAX_OUTCOME_TREE_NODES = 512;

export function parsePublicTrackerState(value: unknown): PublicTrackerState {
  if (!isRecord(value) || typeof value.status !== "string" || !trackerStatuses.has(value.status) || !Array.isArray(value.deck) ||
      !value.deck.every((card) => isCardTrackerRow(card, false)) || !Array.isArray(value.opponentPlayed) ||
      !value.opponentPlayed.every((card) => isCardTrackerRow(card, true)) || !Array.isArray(value.events) ||
      !value.events.every(isTrackerEvent) || !isSummary(value.summary)) {
    throw new Error("记牌器状态数据无效，已拒绝更新界面。");
  }
  if (value.arena !== undefined && !isArenaState(value.arena)) {
    throw new Error("竞技场状态数据无效，已拒绝更新界面。");
  }
  if (!isOptionalZoneCards(value.globalEffects) || !isOptionalZoneCards(value.opponentGlobalEffects)) {
    throw new Error("全局影响数据无效，已拒绝更新界面。");
  }
  if (!isOptionalMatchCounters(value.matchCounters)) {
    throw new Error("本局公开计数数据无效，已拒绝更新界面。");
  }
  if (!isOptionalSmartCounters(value.smartCounters)) {
    throw new Error("智能卡牌计数数据无效，已拒绝更新界面。");
  }
  if (!isOptionalMatchFlow(value.matchFlow)) {
    throw new Error("对局进程数据无效，已拒绝更新界面。");
  }
  if (!isOptionalOpponentHand(value.opponentHand) || !isOptionalTurnTimer(value.turnTimer)) {
    throw new Error("对手手牌或回合计时数据无效，已拒绝更新界面。");
  }
  if (value.deckIdentity !== undefined && !isDeckIdentity(value.deckIdentity)) {
    throw new Error("套牌识别状态数据无效，已拒绝更新界面。");
  }
  if (!isPublicCardTracking(value.cardTracking)) {
    throw new Error("卡牌生命周期数据无效，已拒绝更新界面。");
  }
  return value as unknown as PublicTrackerState;
}

function isDeckIdentity(value: unknown): boolean {
  return isRecord(value) && hasOnlyKeys(value, [
    "status", "source", "deckId", "observedDistinctCards", "candidateCount", "bestScore", "scoreLead"
  ]) &&
    typeof value.status === "string" && deckIdentityStatuses.has(value.status) &&
    typeof value.source === "string" && deckIdentitySources.has(value.source) &&
    (value.deckId === undefined || isNonEmptyString(value.deckId)) &&
    isNonNegativeInteger(value.observedDistinctCards) &&
    isNonNegativeInteger(value.candidateCount) &&
    typeof value.bestScore === "number" && Number.isFinite(value.bestScore) && value.bestScore >= 0 &&
    typeof value.scoreLead === "number" && Number.isFinite(value.scoreLead) && value.scoreLead >= 0;
}

function isOptionalOpponentHand(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((entry) =>
    isRecord(entry) && hasOnlyKeys(entry, ["entityId", "cardId", "name", "drawnTurn", "created", "forged", "buffs", "count", "details"]) &&
    (isNonEmptyString(entry.entityId) || isNonEmptyString(entry.name)) && isOptionalString(entry.entityId) &&
    isOptionalString(entry.cardId) && isOptionalString(entry.name) && isOptionalPositiveInteger(entry.drawnTurn) &&
    (entry.created === undefined || typeof entry.created === "boolean") &&
    (entry.forged === undefined || typeof entry.forged === "boolean") &&
    (entry.buffs === undefined || (Array.isArray(entry.buffs) && entry.buffs.every(isNonEmptyString))) &&
    (entry.count === undefined || isPositiveInteger(entry.count)) && (entry.details === undefined || isCardDetails(entry.details))
  ));
}

function isOptionalTurnTimer(value: unknown): boolean {
  return value === undefined || (
    isRecord(value) && hasOnlyKeys(value, ["turn", "activeSide", "startedAt", "durationSeconds"]) &&
    isOptionalPositiveInteger(value.turn) &&
    (value.activeSide === undefined || value.activeSide === "friendly" || value.activeSide === "opponent") &&
    (value.startedAt === undefined || (isNonEmptyString(value.startedAt) && Number.isFinite(Date.parse(value.startedAt)))) &&
    isNonNegativeInteger(value.durationSeconds)
  );
}

export function parseTrackerSettings(value: unknown): TrackerSettings {
  if (!hasExactKeys(value, ["ladder", "arena", "general", "overlay", "appearance", "other"]) ||
      !isTrackerModeSettings(value.ladder) || !isTrackerModeSettings(value.arena) ||
      !isGeneralSettings(value.general) || !isOverlaySettings(value.overlay) ||
      !isAppearanceSettings(value.appearance) || !isOtherSettings(value.other)) {
    throw new Error("设置数据无效，已拒绝更新界面。");
  }
  return value as unknown as TrackerSettings;
}

export function parseMatchHistoryResult(value: unknown): MatchHistoryResult {
  if (!isRecord(value)) {
    throw invalidMatchHistory();
  }

  if (value.status === "error") {
    if (typeof value.error !== "string" || !value.error.trim()) {
      throw invalidMatchHistory();
    }
    return value as unknown as MatchHistoryResult;
  }

  if (value.status !== "ok" || !Array.isArray(value.matches) || !isMatchHistorySummary(value.summary) ||
      !value.matches.every(isMatchRecord) || value.summary.total !== value.matches.length ||
      value.summary.total !== value.summary.wins + value.summary.losses + value.summary.ties) {
    throw invalidMatchHistory();
  }

  return value as unknown as MatchHistoryResult;
}

export function parseArenaInsightsResult(value: unknown): ArenaInsightsResult {
  if (!isRecord(value)) throw new Error("竞技场档案数据无效，已拒绝更新界面。");
  if (value.status === "error" && isArenaInsightsMeta(value) && isNonEmptyString(value.error) &&
      isOptionalArenaInsightArrays(value)) return value as unknown as ArenaInsightsResult;
  if (value.status !== "ok" || !isArenaInsightsMeta(value) ||
      !Array.isArray(value.runs) || !value.runs.every(isArenaInsightRun) ||
      !Array.isArray(value.highWinDecks) || !value.highWinDecks.every(isArenaInsightRun) ||
      !value.highWinDecks.every((run) => (run as { wins: number }).wins >= 10) ||
      !Array.isArray(value.mulliganStats) || !value.mulliganStats.every(isArenaMulliganInsight) ||
      (value.summary !== undefined && !isArenaInsightSummary(value.summary))) {
    throw new Error("竞技场档案数据无效，已拒绝更新界面。");
  }
  return value as unknown as ArenaInsightsResult;
}

export function parseCollectionInsightsResult(value: unknown): CollectionInsightsResult {
  if (!isRecord(value)) throw new Error("收藏数据无效，已拒绝更新界面。");
  if (value.status === "error" && isNonEmptyString(value.error) && isOptionalCollectionSnapshot(value)) return value as unknown as CollectionInsightsResult;
  if (value.status !== "ok" || !isOneOf(value.source, ["log", "import", "manual"]) || !isValidDate(value.updatedAt) ||
      !Array.isArray(value.cards) || !value.cards.every(isCollectionInsightCard) ||
      !Array.isArray(value.packs) || !value.packs.every(isCollectionInsightPack) ||
      !Array.isArray(value.pity) || !value.pity.every(isCollectionInsightPity) ||
      !Array.isArray(value.cardBacks) || !value.cardBacks.every(isCollectionInsightCosmetic) ||
      !Array.isArray(value.heroSkins) || !value.heroSkins.every(isCollectionInsightCosmetic) ||
      !Array.isArray(value.coins) || !value.coins.every(isCollectionInsightCosmetic)) {
    throw new Error("收藏数据无效，已拒绝更新界面。");
  }
  return value as unknown as CollectionInsightsResult;
}

function isArenaInsightsMeta(value: Record<string, unknown>): boolean {
  return value.source === "本机竞技场档案" && isValidDate(value.updatedAt);
}

function isOptionalArenaInsightArrays(value: Record<string, unknown>): boolean {
  return (value.runs === undefined || (Array.isArray(value.runs) && value.runs.every(isArenaInsightRun))) &&
    (value.highWinDecks === undefined || (Array.isArray(value.highWinDecks) && value.highWinDecks.every(isArenaInsightRun) && value.highWinDecks.every((run) => (run as { wins: number }).wins >= 10))) &&
    (value.mulliganStats === undefined || (Array.isArray(value.mulliganStats) && value.mulliganStats.every(isArenaMulliganInsight))) &&
    (value.summary === undefined || isArenaInsightSummary(value.summary));
}

function isOptionalCollectionSnapshot(value: Record<string, unknown>): boolean {
  return (value.source === undefined || isOneOf(value.source, ["log", "import", "manual"])) &&
    (value.updatedAt === undefined || isValidDate(value.updatedAt)) &&
    (value.cards === undefined || (Array.isArray(value.cards) && value.cards.every(isCollectionInsightCard))) &&
    (value.packs === undefined || (Array.isArray(value.packs) && value.packs.every(isCollectionInsightPack))) &&
    (value.pity === undefined || (Array.isArray(value.pity) && value.pity.every(isCollectionInsightPity))) &&
    (value.cardBacks === undefined || (Array.isArray(value.cardBacks) && value.cardBacks.every(isCollectionInsightCosmetic))) &&
    (value.heroSkins === undefined || (Array.isArray(value.heroSkins) && value.heroSkins.every(isCollectionInsightCosmetic))) &&
    (value.coins === undefined || (Array.isArray(value.coins) && value.coins.every(isCollectionInsightCosmetic)));
}

function isArenaInsightRun(value: unknown): boolean {
  return isRecord(value) && isNonEmptyString(value.id) && isValidDate(value.startedAt) &&
    (value.endedAt === undefined || isValidDate(value.endedAt)) && isOptionalString(value.hero) &&
    isNonNegativeInteger(value.wins) && isNonNegativeInteger(value.losses) && isOptionalFiniteNumber(value.deckScore) &&
    Array.isArray(value.deck) && value.deck.every((card) => isRecord(card) && isNonEmptyString(card.name) && isPositiveInteger(card.count) && isOptionalString(card.cardId)) &&
    Array.isArray(value.rewards) && value.rewards.every((reward) => isRecord(reward) && isOneOf(reward.type, ["gold", "dust", "pack", "card", "other"]) && isOptionalString(reward.name) && isOptionalString(reward.cardId) && isOptionalNonNegativeInteger(reward.amount)) &&
    Array.isArray(value.mulligan) && value.mulligan.every(isArenaMulliganRecord) &&
    Array.isArray(value.recordedMatchIds) && value.recordedMatchIds.every(isNonEmptyString);
}

function isArenaMulliganRecord(value: unknown): boolean {
  return isRecord(value) && isNonEmptyString(value.cardName) && isOptionalString(value.cardId) &&
    (value.drawnBeforeMulligan === undefined || typeof value.drawnBeforeMulligan === "boolean") &&
    typeof value.keptInMulligan === "boolean" && typeof value.inHandAfterMulligan === "boolean" && typeof value.won === "boolean";
}

function isArenaInsightSummary(value: unknown): boolean {
  return isRecord(value) && isNonNegativeInteger(value.runCount) && isNonNegativeInteger(value.totalWins) &&
    isNonNegativeInteger(value.totalLosses) && isOptionalPercentage(value.winRate);
}

function isArenaMulliganInsight(value: unknown): boolean {
  return isRecord(value) && isNonEmptyString(value.cardName) && isOptionalString(value.cardId) &&
    isNonNegativeInteger(value.drawnBeforeMulligan) && isNonNegativeInteger(value.kept) &&
    isNonNegativeInteger(value.inHandAfterMulligan) && isNonNegativeInteger(value.wins) &&
    isOptionalPercentage(value.winRate) && value.wins <= value.inHandAfterMulligan;
}

function isCollectionInsightCard(value: unknown): boolean {
  return isRecord(value) && isNonEmptyString(value.cardId) && isOptionalString(value.name) &&
    isNonNegativeInteger(value.normal) && isNonNegativeInteger(value.golden);
}

function isCollectionInsightPack(value: unknown): boolean {
  return isRecord(value) && isNonEmptyString(value.id) && isNonEmptyString(value.set) && isValidDate(value.openedAt) &&
    Array.isArray(value.cards) && value.cards.every((card) => isRecord(card) &&
      isOneOf(card.rarity, ["common", "rare", "epic", "legendary"]) && isOptionalString(card.cardId) &&
      isOptionalString(card.name) && (card.golden === undefined || typeof card.golden === "boolean"));
}

function isCollectionInsightPity(value: unknown): boolean {
  return isRecord(value) && isNonEmptyString(value.set) && isNonNegativeInteger(value.packsSinceLegendary) &&
    isOptionalNonNegativeInteger(value.packsSinceEpic) && (value.epicLimit === undefined || value.epicLimit === 10) &&
    (value.legendaryLimit === undefined || value.legendaryLimit === 40) && typeof value.partial === "boolean";
}

function isCollectionInsightCosmetic(value: unknown): boolean {
  return isRecord(value) && isNonEmptyString(value.id) && isNonEmptyString(value.name);
}

function isValidDate(value: unknown): boolean {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function isSummary(value: unknown): boolean {
  return isRecord(value) && ["totalCards", "remainingCards", "drawnCards", "opponentPlayedCount"]
    .every((key) => isNonNegativeInteger(value[key]));
}

function isCardTrackerRow(value: unknown, allowZeroCount: boolean): boolean {
  return isRecord(value) && isNonEmptyString(value.name) &&
    (allowZeroCount ? isNonNegativeInteger(value.count) : isPositiveInteger(value.count)) &&
    isNonNegativeInteger(value.remaining) && isNonNegativeInteger(value.drawn) &&
    isNonNegativeInteger(value.played) && isOptionalString(value.cardId) &&
    (value.details === undefined || isCardDetails(value.details)) &&
    (value.unresolved === undefined || value.unresolved === true);
}

function isTrackerEvent(value: unknown): boolean {
  return isRecord(value) && isNonEmptyString(value.id) && isNonEmptyString(value.at) &&
    typeof value.kind === "string" && eventKinds.has(value.kind) &&
    typeof value.player === "string" && eventPlayers.has(value.player) &&
    isOptionalPositiveInteger(value.turn) && isOptionalString(value.cardName) &&
    isOptionalTrackerZone(value.fromZone) && isOptionalTrackerZone(value.toZone) &&
    isOptionalString(value.raw) && isOptionalString(value.cardId);
}

function isOptionalTrackerZone(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && trackerZones.has(value));
}

function isTrackerModeSettings(value: unknown): boolean {
  return hasExactKeys(value, ["friendlyDeckTracker", "opponentDeckTracker"]) &&
    typeof value.friendlyDeckTracker === "boolean" &&
    typeof value.opponentDeckTracker === "boolean";
}

function isGeneralSettings(value: unknown): boolean {
  return hasExactKeys(value, [
    "launchAtLogin", "startMinimized", "showGameStatusIcon", "minimizeToMenuBar",
    "focusOnOpen", "gameDetection", "gameLanguage", "windowMatching"
  ]) &&
    [value.launchAtLogin, value.startMinimized, value.showGameStatusIcon, value.minimizeToMenuBar, value.focusOnOpen]
      .every((item) => typeof item === "boolean") &&
    isOneOf(value.gameDetection, ["automatic", "manual"]) &&
    isOneOf(value.gameLanguage, ["zh-CN", "zh-TW", "en-US"]) &&
    isOneOf(value.windowMatching, ["smart", "title", "process"]);
}

function isOverlaySettings(value: unknown): boolean {
  return isRecord(value) && hasOnlyKeys(value, [
    "enabled", "showOnlyInGame", "theme", "arenaHeroWinRateRanking", "showFriendlyAttack", "showOpponentAttack", "secretPrediction", "smartCardCounters", "position",
    "offsetX", "offsetY", "opacity", "hideInFullscreen", "hiddenSmartCounterIds"
  ]) &&
    [value.enabled, value.showOnlyInGame, value.arenaHeroWinRateRanking, value.showFriendlyAttack, value.showOpponentAttack, value.secretPrediction, value.smartCardCounters, value.hideInFullscreen]
      .every((item) => typeof item === "boolean") &&
    isOneOf(value.theme, ["light", "dark"]) &&
    isOneOf(value.position, ["left", "right"]) &&
    isNumberInRange(value.offsetX, -200, 200) &&
    isNumberInRange(value.offsetY, -200, 200) &&
    isNumberInRange(value.opacity, 30, 100) &&
    (value.hiddenSmartCounterIds === undefined || (
      Array.isArray(value.hiddenSmartCounterIds) &&
      value.hiddenSmartCounterIds.every(isNonEmptyString)
    ));
}

function isOptionalSmartCounters(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((counter) =>
    isRecord(counter) && hasOnlyKeys(counter, ["id", "ruleId", "side", "label", "value", "target", "scope", "cardId", "details"]) &&
    isSafeSmartCounterId(counter.id) &&
    (counter.ruleId === undefined || isSafeSmartCounterId(counter.ruleId)) &&
    isOneOf(counter.side, ["friendly", "opponent"]) &&
    isNonEmptyString(counter.label) &&
    isNonNegativeInteger(counter.value) &&
    (counter.target === undefined || isPositiveInteger(counter.target)) &&
    (counter.scope === undefined || isOneOf(counter.scope, ["current-turn", "previous-turn"])) &&
    isOptionalString(counter.cardId) &&
    (counter.details === undefined || isCardDetails(counter.details))
  ));
}

function isSafeSmartCounterId(value: unknown): boolean {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,127}$/u.test(value);
}

function isAppearanceSettings(value: unknown): boolean {
  return hasExactKeys(value, ["theme", "accentColor", "fontSize", "zoom", "animations", "cardImageQuality"]) &&
    isOneOf(value.theme, ["dark", "light", "system"]) &&
    isOneOf(value.accentColor, TRACKER_ACCENT_COLORS) &&
    isOneOf(value.fontSize, ["small", "medium", "large"]) &&
    isNumberInRange(value.zoom, 80, 120) &&
    typeof value.animations === "boolean" &&
    isOneOf(value.cardImageQuality, ["low", "high"]);
}

function isOtherSettings(value: unknown): boolean {
  return hasExactKeys(value, [
    "autoUpdateCards", "updateFrequency", "matchRetentionDays", "notifyUpdates",
    "notifyAnnouncements", "verboseLogs"
  ]) &&
    [value.autoUpdateCards, value.notifyUpdates, value.notifyAnnouncements, value.verboseLogs]
      .every((item) => typeof item === "boolean") &&
    isOneOf(value.updateFrequency, ["daily", "weekly", "manual"]) &&
    isOneOf(value.matchRetentionDays, [30, 90, 180]);
}

function isOptionalZoneCards(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every(isZoneCard));
}

function isZoneCard(value: unknown): boolean {
  return isRecord(value) && isNonEmptyString(value.name) && isPositiveInteger(value.count) &&
    isOptionalString(value.cardId) && (value.details === undefined || isRecord(value.details));
}

function isPublicCardTracking(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "schemaVersion", "gameKey", "friendly", "opponent", "opponentSecretSlots",
    "detailsByCardKey", "contextDetailsBySideAndCardKey", "deckInsertions"
  ]) || value.schemaVersion !== 1 || !isNonEmptyString(value.gameKey) ||
      !Array.isArray(value.opponentSecretSlots) || !isRecord(value.detailsByCardKey) ||
      !isPublicCardContextBySide(value.contextDetailsBySideAndCardKey) ||
      (value.deckInsertions !== undefined && !isPublicDeckInsertionsBySide(value.deckInsertions))) {
    return false;
  }

  const outcomeBudget = { nodes: 0 };
  if (!isPublicPlayerCardTracking(value.friendly, outcomeBudget) ||
      !isPublicPlayerCardTracking(value.opponent, outcomeBudget) ||
      !hasUniqueStrings(value.opponentSecretSlots, "entityId") ||
      !value.opponentSecretSlots.every(isOpponentSecretSlot) ||
      !Object.entries(value.detailsByCardKey).every(([cardKey, details]) =>
        isNonEmptyString(cardKey) && isCardDetails(details))) {
    return false;
  }

  const opponent = value.opponent as Record<string, unknown>;
  const current = opponent.current as Record<string, unknown>;
  const secret = current.secret as Record<string, unknown>;
  return secret.totalCount === value.opponentSecretSlots.length;
}

function isPublicDeckInsertionsBySide(value: unknown): boolean {
  return hasExactKeys(value, ["friendly", "opponent"]) &&
    isPublicDeckInsertionTracking(value.friendly) &&
    isPublicDeckInsertionTracking(value.opponent);
}

function isPublicDeckInsertionTracking(value: unknown): boolean {
  return hasExactKeys(value, ["groups", "placements"]) &&
    Array.isArray(value.groups) &&
    hasUniqueStrings(value.groups, "sourceEntityId") &&
    value.groups.every((group) =>
      isRecord(group) &&
      hasExactKeys(group, ["sourceEntityId", "sourceName", "remainingCount"]) &&
      isNonEmptyString(group.sourceEntityId) &&
      isNonEmptyString(group.sourceName) &&
      isPositiveInteger(group.remainingCount)
    ) &&
    Array.isArray(value.placements) &&
    hasUniqueStrings(value.placements, "entityId") &&
    value.placements.every((placement) =>
      isRecord(placement) &&
      hasOnlyKeys(placement, ["entityId", "position", "cardName", "cardId"]) &&
      isNonEmptyString(placement.entityId) &&
      isOneOf(placement.position, ["top", "bottom"]) &&
      isOptionalString(placement.cardName) &&
      isOptionalString(placement.cardId)
    );
}

function isPublicPlayerCardTracking(value: unknown, outcomeBudget: OutcomeTreeBudget): boolean {
  if (!hasExactKeys(value, ["current", "burned", "used"])) {
    return false;
  }
  const current = value.current;
  return hasExactKeys(current, publicCardZones) &&
    publicCardZones.every((zone) => isPublicCardZoneGroup(current[zone])) &&
    isPublicCardHistoryGroup(value.burned, outcomeBudget) &&
    isPublicCardHistoryGroup(value.used, outcomeBudget);
}

function isPublicCardZoneGroup(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ["status", "knownCount", "totalCount", "cards"]) ||
      typeof value.status !== "string" || !publicTrackingStatuses.has(value.status) ||
      !isNonNegativeInteger(value.knownCount) || !Array.isArray(value.cards) ||
      !value.cards.every(isPublicKnownCard)) {
    return false;
  }

  const knownCount = value.cards.reduce<number>(
    (total, card) => total + (card as { count: number }).count,
    0
  );
  if (knownCount !== value.knownCount) {
    return false;
  }

  if (value.status === "known") {
    return isNonNegativeInteger(value.totalCount) && value.totalCount === value.knownCount;
  }
  if (value.status === "partial") {
    return isNonNegativeInteger(value.totalCount) && value.totalCount > value.knownCount;
  }
  return value.totalCount === undefined;
}

function isPublicKnownCard(value: unknown): boolean {
  return isRecord(value) && hasOnlyKeys(value, ["cardKey", "cardId", "name", "count"]) &&
    isNonEmptyString(value.cardKey) && isOptionalString(value.cardId) &&
    isNonEmptyString(value.name) && isPositiveInteger(value.count);
}

interface OutcomeTreeBudget {
  nodes: number;
}

function isPublicCardHistoryGroup(value: unknown, outcomeBudget: OutcomeTreeBudget): boolean {
  if (!hasExactKeys(value, ["totalCount", "items", "truncated"]) ||
      !isNonNegativeInteger(value.totalCount) || !Array.isArray(value.items) ||
      value.items.length > MAX_PUBLIC_HISTORY_ITEMS || value.items.length > value.totalCount ||
      typeof value.truncated !== "boolean" || value.truncated !== (value.totalCount > value.items.length) ||
      !hasUniqueStrings(value.items, "id")) {
    return false;
  }
  return value.items.every((item) => isPublicCardHistoryItem(item, outcomeBudget)) &&
    hasStrictlyDecreasingSequences(value.items);
}

function isPublicCardHistoryItem(value: unknown, outcomeBudget: OutcomeTreeBudget): boolean {
  return isRecord(value) &&
    hasOnlyKeys(value, ["id", "sequence", "entityId", "turn", "card", "confidence", "outcomeSections"]) &&
    isNonEmptyString(value.id) && isNonNegativeInteger(value.sequence) &&
    isNonEmptyString(value.entityId) &&
    (value.turn === undefined || isPositiveInteger(value.turn)) && (
      value.card === undefined ||
      (isRecord(value.card) && hasOnlyKeys(value.card, ["cardKey", "cardId", "name"]) &&
        isNonEmptyString(value.card.cardKey) && isOptionalString(value.card.cardId) &&
        isNonEmptyString(value.card.name))
    ) &&
    typeof value.confidence === "string" && publicTrackingConfidences.has(value.confidence) &&
    (value.outcomeSections === undefined || isCardOutcomeSections(value.outcomeSections, outcomeBudget));
}

function isOpponentSecretSlot(value: unknown): boolean {
  return isRecord(value) && hasOnlyKeys(value, ["entityId", "candidates", "revealedCardId"]) &&
    isNonEmptyString(value.entityId) && Array.isArray(value.candidates) &&
    value.candidates.every(isSecretCandidate) &&
    isOptionalString(value.revealedCardId);
}

function isSecretCandidate(value: unknown): boolean {
  return isRecord(value) && hasOnlyKeys(value, ["cardId", "name", "status", "exclusionReason", "details"]) &&
    isNonEmptyString(value.cardId) && isNonEmptyString(value.name) &&
    isOneOf(value.status, ["possible", "excluded"]) &&
    (value.exclusionReason === undefined || isOneOf(value.exclusionReason, [
      "spell-played-without-trigger",
      "minion-played-without-trigger",
      "hero-attacked-without-trigger"
    ])) &&
    (value.details === undefined || isCardDetails(value.details));
}

function isCardDetails(value: unknown): boolean {
  return isRecord(value) && isNonNegativeInteger(value.dbfId) && isNonEmptyString(value.name) &&
    typeof value.isSpell === "boolean" && Array.isArray(value.relatedCards) &&
    value.relatedCards.every(isRelatedCard) && !("cardOutcomeSections" in value);
}

function isRelatedCard(value: unknown): boolean {
  return isRecord(value) && isNonNegativeInteger(value.dbfId) && isNonEmptyString(value.name) &&
    isOptionalString(value.cardId) && isOptionalFiniteNumber(value.manaCost) &&
    isOptionalString(value.cardType) && isOptionalString(value.rarity) &&
    isOptionalString(value.text) && isOptionalString(value.imageUrl) &&
    isOptionalString(value.cropImageUrl);
}

function isPublicCardContextBySide(value: unknown): boolean {
  return hasExactKeys(value, ["friendly", "opponent"]) &&
    isCardContextMap(value.friendly) &&
    isCardContextMap(value.opponent);
}

function isCardContextMap(value: unknown): boolean {
  return isRecord(value) && Object.entries(value).every(([cardKey, details]) =>
    isNonEmptyString(cardKey) && isPublicCardContextDetails(details));
}

function isPublicCardContextDetails(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "gameContextSections",
    "playedSpellsThisGame",
    "playedSpellsThisGameCount",
    "playedSpellsThisGameIncomplete"
  ])) {
    return false;
  }
  const playedSpells = value.playedSpellsThisGame;
  const count = value.playedSpellsThisGameCount;
  const incomplete = value.playedSpellsThisGameIncomplete;
  return (
    value.gameContextSections === undefined ||
    isGameContextSections(value.gameContextSections)
  ) && (
    playedSpells === undefined ||
    (Array.isArray(playedSpells) && playedSpells.every(isRelatedCard))
  ) && (
    count === undefined ||
    (isNonNegativeInteger(count) && (!Array.isArray(playedSpells) || count >= playedSpells.length))
  ) && (
    incomplete === undefined ||
    typeof incomplete === "boolean"
  ) && (
    incomplete !== true ||
    count === undefined ||
    !Array.isArray(playedSpells) ||
    count > playedSpells.length
  );
}

function isGameContextSections(value: unknown): boolean {
  return Array.isArray(value) && value.every((section) =>
    isRecord(section) &&
    hasOnlyKeys(section, ["key", "title", "emptyText", "cards", "totalCount"]) &&
    isNonEmptyString(section.key) &&
    isNonEmptyString(section.title) &&
    isNonEmptyString(section.emptyText) &&
    Array.isArray(section.cards) &&
    section.cards.every(isRelatedCard) &&
    (section.totalCount === undefined ||
      (isNonNegativeInteger(section.totalCount) && section.totalCount >= section.cards.length)));
}

function isCardOutcomeSections(value: unknown, outcomeBudget: OutcomeTreeBudget): boolean {
  return Array.isArray(value) && value.every((section) =>
    isRecord(section) && isNonEmptyString(section.key) && isNonEmptyString(section.title) &&
    isNonEmptyString(section.emptyText) && Array.isArray(section.cards) &&
    section.cards.every((node) => isCardOutcomeNode(node, 1, outcomeBudget, new Set())));
}

function isCardOutcomeNode(
  value: unknown,
  depth: number,
  outcomeBudget: OutcomeTreeBudget,
  ancestors: Set<unknown>
): boolean {
  if (depth > MAX_OUTCOME_TREE_DEPTH || outcomeBudget.nodes >= MAX_OUTCOME_TREE_NODES ||
      !isRecord(value) || ancestors.has(value) || !isNonEmptyString(value.key) ||
      !isRelatedCard(value.card) ||
      (value.children !== undefined && !Array.isArray(value.children))) {
    return false;
  }

  outcomeBudget.nodes += 1;
  if (value.children === undefined) {
    return true;
  }

  ancestors.add(value);
  const childrenAreValid = value.children.every((child) =>
    isCardOutcomeNode(child, depth + 1, outcomeBudget, ancestors));
  ancestors.delete(value);
  return childrenAreValid;
}

function hasUniqueStrings(value: readonly unknown[], key: string): boolean {
  const seen = new Set<string>();
  return value.every((item) => {
    if (!isRecord(item) || !isNonEmptyString(item[key]) || seen.has(item[key])) {
      return false;
    }
    seen.add(item[key]);
    return true;
  });
}

function hasStrictlyDecreasingSequences(items: readonly unknown[]): boolean {
  let previousSequence = Number.POSITIVE_INFINITY;
  return items.every((item) => {
    if (!isRecord(item) || !isNonNegativeInteger(item.sequence) ||
        item.sequence >= previousSequence) {
      return false;
    }
    previousSequence = item.sequence;
    return true;
  });
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isOptionalMatchCounters(value: unknown): boolean {
  return value === undefined || (
    hasExactKeys(value, ["friendly", "opponent"]) &&
    isPlayerMatchCounters(value.friendly) &&
    isPlayerMatchCounters(value.opponent)
  );
}

function isOptionalMatchFlow(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "globalTurn", "activeSide", "phase", "friendly", "opponent"
  ])) {
    return false;
  }
  return isOptionalPositiveInteger(value.globalTurn) &&
    (value.activeSide === undefined || isOneOf(value.activeSide, ["friendly", "opponent"])) &&
    (value.phase === undefined || isOneOf(value.phase, ["mulligan", "start", "action", "end"])) &&
    isOptionalPlayerTurnState(value.friendly) &&
    isOptionalPlayerTurnState(value.opponent);
}

function isOptionalPlayerTurnState(value: unknown): boolean {
  return value === undefined || (
    isRecord(value) &&
    hasOnlyKeys(value, ["turn", "mana", "manaUsed"]) &&
    isOptionalPositiveInteger(value.turn) &&
    isOptionalNonNegativeInteger(value.mana) &&
    isOptionalNonNegativeInteger(value.manaUsed) &&
    (
      !isNonNegativeInteger(value.mana) ||
      !isNonNegativeInteger(value.manaUsed) ||
      value.manaUsed <= value.mana
    )
  );
}

function isPlayerMatchCounters(value: unknown): boolean {
  const keys = ["nextFatigueDamage", "corpses", "spellsPlayed"] as const;
  return isRecord(value) &&
    Object.keys(value).every((key) => keys.includes(key as typeof keys[number])) &&
    keys.every((key) => isOptionalNonNegativeInteger(value[key]));
}

function isArenaState(value: unknown): boolean {
  if (!isRecord(value) || typeof value.status !== "string" || !arenaStatuses.has(value.status) ||
      !isNonNegativeInteger(value.draftCount) || value.draftCount > 30 ||
      !isNonNegativeInteger(value.unresolvedCount) || value.unresolvedCount > 30 ||
      !Array.isArray(value.currentChoices) || !value.currentChoices.every(isArenaCardChoice) ||
      !Array.isArray(value.picks) || !value.picks.every(isArenaPick) ||
      !Array.isArray(value.deck) || !value.deck.every(isDeckCard) ||
      (value.redraftPool !== undefined && (!Array.isArray(value.redraftPool) || !value.redraftPool.every(isDeckCard))) ||
      (value.redraftTrackerDeck !== undefined && (!Array.isArray(value.redraftTrackerDeck) || !value.redraftTrackerDeck.every(isDeckCard))) ||
      (value.pendingRedraftChoices !== undefined &&
        (!Array.isArray(value.pendingRedraftChoices) || !value.pendingRedraftChoices.every(isArenaCardChoice))) ||
      (value.awaitingExactDeck !== undefined && typeof value.awaitingExactDeck !== "boolean") ||
      !isOptionalString(value.deckId) || !isOptionalString(value.redraftGenerationId) ||
      !isOptionalString(value.scoreSource) || !isOptionalString(value.lastUpdated) || !isOptionalString(value.error) ||
      !isOptionalNonNegativeNumber(value.ratingsVersion) || !isOptionalArenaHero(value.hero)) {
    return false;
  }

  const deckCount = value.deck.reduce<number>((total, card) => total + (card as { count: number }).count, 0);
  const confirmedCount = value.status === "inactive" ? 0 : 30 - value.unresolvedCount;
  return deckCount === confirmedCount && (value.status !== "inactive" || value.draftCount === 0);
}

function isDeckCard(value: unknown): value is Record<string, unknown> & { name: string; count: number } {
  return isRecord(value) && isNonEmptyString(value.name) && isPositiveInteger(value.count) &&
    isOptionalString(value.cardId) && isOptionalString(value.rawLine) &&
    isOptionalPercentage(value.pickRate) && isOptionalFiniteNumber(value.deckImpact) &&
    (value.details === undefined || isRecord(value.details)) &&
    (value.unresolved === undefined || value.unresolved === true);
}

function isArenaCardChoice(value: unknown): boolean {
  return isDeckCard(value) && isOptionalString(value.entityId) && isOptionalFiniteNumber(value.score) &&
    isOptionalString(value.scoreSource) && isOptionalArenaQuality(value.quality) && isOptionalArenaRating(value.rating);
}

function isArenaPick(value: unknown): boolean {
  return isRecord(value) && isPositiveInteger(value.slot) && isArenaCardChoice(value.chosen) &&
    Array.isArray(value.offered) && value.offered.every(isArenaCardChoice) &&
    isNonEmptyString(value.at) && Number.isFinite(Date.parse(value.at));
}

function isOptionalArenaHero(value: unknown): boolean {
  return value === undefined || (isRecord(value) && isNonEmptyString(value.name) &&
    isOptionalString(value.cardId) && isOptionalString(value.className));
}

function isOptionalArenaQuality(value: unknown): boolean {
  return value === undefined || (isRecord(value) && typeof value.tier === "string" && arenaScoreTiers.has(value.tier) &&
    isNonEmptyString(value.label));
}

function isOptionalArenaRating(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (!isRecord(value) || !numericFieldsAreOptional(value, [
    "hearthArena", "pickRate", "highWinPickRate", "highWinThreshold", "highWinPickRateImpact", "twelveWinRate",
    "deckImpact", "drawnImpact"
  ]) || !isOptionalPercentage(value.pickRate)) {
    return false;
  }
  return value.firestone === undefined || (isRecord(value.firestone) && numericFieldsAreOptional(value.firestone, [
    "includedWinrate", "playedWinrate", "sampleSize", "pickRate", "pickRateSampleSize", "highWinPickRate",
    "highWinPickRateSampleSize", "highWinThreshold", "highWinPickRateImpact", "twelveWinRate", "twelveWinRateSampleSize",
    "drawnWinrate", "drawnWins", "drawnSampleSize", "drawnImpact"
  ]) && isOptionalPercentage(value.firestone.pickRate));
}

function numericFieldsAreOptional(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => isOptionalFiniteNumber(value[key]));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isOptionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || isNonNegativeInteger(value);
}

function isOptionalPositiveInteger(value: unknown): boolean {
  return value === undefined || isPositiveInteger(value);
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isOptionalPercentage(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100);
}

function isOptionalNonNegativeNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function isMatchHistorySummary(value: unknown): value is Record<"total" | "wins" | "losses" | "ties" | "winRate", number> {
  if (!isRecord(value)) {
    return false;
  }
  const counts = [value.total, value.wins, value.losses, value.ties];
  return counts.every((count) => typeof count === "number" && Number.isInteger(count) && count >= 0) &&
    typeof value.winRate === "number" && Number.isFinite(value.winRate) && value.winRate >= 0 && value.winRate <= 100;
}

function isMatchRecord(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.id === "string" && Boolean(value.id.trim()) &&
    typeof value.result === "string" && matchResults.has(value.result) &&
    typeof value.mode === "string" && matchModes.has(value.mode) &&
    (value.deckName === undefined || typeof value.deckName === "string") &&
    typeof value.endedAt === "string" && Number.isFinite(Date.parse(value.endedAt));
}

function invalidMatchHistory(): Error {
  return new Error("对局历史数据无效，已拒绝更新界面。");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys<const T extends readonly string[]>(value: unknown, keys: T): value is Record<T[number], unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function isOneOf<const T>(value: unknown, values: readonly T[]): value is T {
  return values.includes(value as T);
}

function isNumberInRange(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;
}
