import type { ArenaCardChoice, ArenaState, CardTrackerRow, DeckCard, PublicTrackerState, TrackerEvent, TrackerZoneCard } from "../shared/types";
import type {
  OverlayArenaChoice,
  OverlayCardItem,
  OverlayDeckIdentity,
  OverlayPanelViewModel,
  OverlayStatusTone
} from "./types";
import { toCardTrackingView } from "./cardTrackingView";
import { toMatchPulseViewFromState } from "./matchPulse";

export interface OverlayViewOptions {
  maxDeckRows?: number;
  maxRecentRows?: number;
  side?: "friendly" | "opponent";
  showSecretCandidates?: boolean;
}

const defaultMaxDeckRows = 40;
const defaultMaxRecentRows = 5;

const statusLabels: Record<
  PublicTrackerState["status"],
  {
    tone: OverlayStatusTone;
    label: string;
  }
> = {
  idle: { tone: "ready", label: "待命" },
  watching: { tone: "tracking", label: "监听中" },
  paused: { tone: "paused", label: "已暂停" },
  "missing-log": { tone: "offline", label: "缺少日志" },
  error: { tone: "error", label: "异常" }
};

export function toOverlayPanelViewModel(
  state: PublicTrackerState,
  options: OverlayViewOptions = {}
): OverlayPanelViewModel {
  const maxDeckRows = normalizeLimit(options.maxDeckRows, defaultMaxDeckRows);
  const maxRecentRows = normalizeLimit(options.maxRecentRows, defaultMaxRecentRows);
  const side = options.side ?? "friendly";
  const showSecretCandidates = options.showSecretCandidates ?? true;
  const deckIdentity = toOverlayDeckIdentity(state);
  const publishedIdentityUnconfirmed = isPublishedIdentityUnconfirmed(state);
  const baseCardTracking = toCardTrackingView(state.cardTracking, side, {
    showSecretCandidates
  });
  const cardTracking = side === "friendly" && publishedIdentityUnconfirmed
    ? concealFriendlyDeck(baseCardTracking)
    : baseCardTracking;
  const recentEvents = [...state.events].reverse();
  const logIssueStatus = toLogIssueStatus(state);
  const isRecognizingConstructedDeck = Boolean(
    !state.deckIdentity && state.constructedScreenMode && !state.autoMatchedDeckId
  );
  const hasUnknownConstructedDeck = publishedIdentityUnconfirmed || isRecognizingConstructedDeck;
  const shouldClearTrackedData = Boolean(logIssueStatus || hasUnknownConstructedDeck);
  const isUnknownActiveDeckCount =
    !shouldClearTrackedData &&
    state.gameActive === true &&
    !state.autoMatchedDeckId &&
    (!state.arena || state.arena.status === "inactive") &&
    state.deck.length === 0 &&
    state.summary.totalCards === 0 &&
    state.summary.remainingCards === 0;
  const constructedRecognitionStatus = isRecognizingConstructedDeck && state.error
    ? { tone: "error" as const, label: "识别失败" }
    : undefined;
  const hasActiveArena = Boolean(state.arena && state.arena.status !== "inactive");
  const isArenaDrafting = state.arena?.status === "drafting" || state.arena?.status === "redrafting";
  const waitingForGameStatus = state.status === "watching" &&
    state.gameActive !== true &&
    !isRecognizingConstructedDeck &&
    !isArenaDrafting
    ? {
        tone: "tracking" as const,
        label: "已识别炉石，等待开局",
        detail: "进入对局后自动开始记牌"
      }
    : undefined;
  const arena = hasActiveArena && state.arena && !logIssueStatus ? toArenaView(state.arena, maxDeckRows) : undefined;
  const matchPulse = shouldClearTrackedData ? undefined : toMatchPulseViewFromState(state);
  return {
    cardTracking,
    summary: {
      totalCards: shouldClearTrackedData ? 0 : state.summary.totalCards,
      remainingCards: hasUnknownConstructedDeck || isUnknownActiveDeckCount
        ? undefined
        : shouldClearTrackedData
          ? 0
          : state.summary.remainingCards,
      drawnCards: shouldClearTrackedData ? 0 : state.summary.drawnCards
    },
    deckIdentity,
    remainingDeck: shouldClearTrackedData ? [] : toRemainingDeckItems(state.deck, maxDeckRows),
    recentDraws: shouldClearTrackedData
      ? []
      : recentEvents.filter(isFriendlyDraw).slice(0, maxRecentRows).map((event) => toDrawItem(event, state.deck)),
    globalEffects: shouldClearTrackedData ? [] : toZoneCardItems(state.globalEffects ?? [], "global", maxDeckRows),
    opponentGlobalEffects: shouldClearTrackedData ? [] : toZoneCardItems(state.opponentGlobalEffects ?? [], "opponent-global", maxDeckRows),
    boardAttack: shouldClearTrackedData ? { friendly: 0, opponent: 0 } : state.boardAttack ?? { friendly: 0, opponent: 0 },
    friendlyCounters: shouldClearTrackedData ? undefined : state.matchCounters?.friendly,
    opponentCounters: shouldClearTrackedData ? undefined : state.matchCounters?.opponent,
    ...(matchPulse ? { matchPulse } : {}),
    status: {
      ...(logIssueStatus ?? constructedRecognitionStatus ?? waitingForGameStatus ?? statusLabels[state.status]),
      detail: logIssueStatus
        ? "先点修复日志，完全退出并重新打开炉石，然后进入一局"
        : waitingForGameStatus
          ? waitingForGameDetail(state.error, waitingForGameStatus.label, waitingForGameStatus.detail)
          : state.error ?? statusDetail(state),
      updatedAtLabel: formatTimeLabel(state.lastUpdated)
    },
    arena
  };
}

export function toOverlayDeckIdentity(state: PublicTrackerState): OverlayDeckIdentity {
  if (state.arena?.status && state.arena.status !== "inactive") {
    const confirmedCount = 30 - state.arena.unresolvedCount;
    return {
      name: "竞技场牌库",
      status: "arena",
      detail: state.arena.unresolvedCount > 0
        ? `已确认 ${confirmedCount}/30 · ${state.arena.unresolvedCount} 张待识别`
        : "已选 30/30"
    };
  }

  if (state.deckIdentity) {
    const identity = state.deckIdentity;
    if (identity.status === "confirmed") {
      const copy = confirmedIdentityCopy(identity.source);
      const name = state.deckName?.trim() || "已识别套牌";
      return {
        name,
        compactName: name,
        status: "confirmed",
        source: identity.source,
        detail: copy.detail,
        compactDetail: copy.compactDetail
      };
    }

    if (identity.candidateCount > 1) {
      return {
        name: "还不能确定是哪套",
        compactName: "还不能确定",
        status: "candidates",
        source: identity.source,
        candidateCount: identity.candidateCount,
        detail: `可能是 ${identity.candidateCount} 套；继续对局后会自动确认。`,
        compactDetail: `${identity.candidateCount} 套可能`
      };
    }

    const waitingCopy = waitingIdentityCopy(state);
    return {
      name: "等待套牌信息",
      compactName: "等待套牌",
      status: "waiting",
      source: identity.source,
      detail: waitingCopy.detail,
      compactDetail: waitingCopy.compactDetail
    };
  }

  if (state.autoMatchedDeckId) {
    const name = state.deckName?.trim() || "已识别套牌";
    return {
      name,
      compactName: name,
      status: "automatic",
      detail: "自动识别当前对局",
      compactDetail: "自动识别"
    };
  }

  if (state.constructedScreenMode) {
    return {
      name: "正在识别套牌",
      status: "waiting",
      detail: state.constructedScreenMode === "standard"
        ? "标准套牌识别中"
        : state.constructedScreenMode === "wild"
          ? "狂野套牌识别中"
          : "休闲套牌识别中",
      compactName: "正在识别套牌",
      compactDetail: "识别中"
    };
  }

  return {
    name: "等待识别",
    status: "waiting",
    detail: "抽到或打出卡牌后自动匹配",
    compactName: "等待识别",
    compactDetail: "等待识别"
  };
}

function confirmedIdentityCopy(source: NonNullable<PublicTrackerState["deckIdentity"]>["source"]) {
  if (source === "decks-log") {
    return { detail: "炉石已确认这套牌", compactDetail: "炉石确认" };
  }
  if (source === "screen") {
    return { detail: "已从游戏画面找到", compactDetail: "画面找到" };
  }
  return { detail: "已根据本局卡牌匹配", compactDetail: "本局匹配" };
}

function waitingIdentityCopy(state: PublicTrackerState) {
  if (state.constructedScreenMode) {
    return { detail: "停留在选牌页，记牌器会自动查找。", compactDetail: "进入选牌页" };
  }
  if (state.gameActive) {
    return { detail: "继续对局，出现更多卡牌后会自动查找。", compactDetail: "继续对局" };
  }
  return { detail: "进入选牌页或开始一局后会自动查找。", compactDetail: "等待开局" };
}

function isPublishedIdentityUnconfirmed(state: PublicTrackerState): boolean {
  return Boolean(
    state.deckIdentity &&
    state.deckIdentity.status !== "confirmed" &&
    (!state.arena || state.arena.status === "inactive")
  );
}

function concealFriendlyDeck(
  tracking: OverlayPanelViewModel["cardTracking"]
): OverlayPanelViewModel["cardTracking"] {
  return {
    ...tracking,
    current: {
      ...tracking.current,
      deck: {
        key: "deck",
        status: "unknown",
        knownCount: 0,
        countLabel: "?",
        cards: []
      }
    }
  };
}

function toArenaView(state: ArenaState, maxDeckRows: number) {
  const confirmedCount = state.status === "inactive" ? 0 : 30 - state.unresolvedCount;
  const showDeckStats = state.status !== "playing";
  const visibleDeck = state.awaitingExactDeck && state.redraftPool?.length
    ? state.redraftPool
    : state.status === "redrafting" && state.redraftPool?.length
      ? state.redraftPool
    : state.deck;
  const visibleDeckCount = visibleDeck.reduce((total, card) => total + card.count, 0);
  const isChoosing = (state.status === "drafting" || state.status === "redrafting") && state.currentChoices.length >= 3;
  const choices = isChoosing
    ? [...state.currentChoices]
        .slice(0, 3)
        .sort((left, right) => (right.score ?? -1) - (left.score ?? -1))
        .map(toArenaChoice)
    : [];
  const latestPick = state.pendingRedraftChoices?.at(-1) ?? state.picks[state.picks.length - 1]?.chosen;

  return {
    isChoosing,
    showDeckStats,
    statusLabel: state.awaitingExactDeck
      ? state.status === "redrafting" ? "重选中" : "等待确认替换"
      : state.status === "drafting" ? "选牌中" : state.status === "redrafting" ? "重选中" : state.status === "playing" ? "对局中" : "等待开局",
    progress: state.awaitingExactDeck && state.redraftPool?.length
      ? `${visibleDeckCount}张候选 · 最终30`
      : state.unresolvedCount > 0 ? `已确认 ${confirmedCount}/30` : "30/30",
    confirmedCount,
    unresolvedCount: state.unresolvedCount,
    hero: state.hero?.name ?? "等待职业",
    scoreSource: state.scoreSource,
    error: state.error,
    choices,
    deck: [...visibleDeck]
      .sort(compareCardsByMana)
      .map((card) => ({
        id: `arena-deck-${stableCardIdentity(card)}`,
        name: card.name,
        cost: card.details?.manaCost,
        count: card.count,
        ...(showDeckStats ? { pickRate: card.pickRate, deckImpact: card.deckImpact } : {}),
        details: card.details,
        thumbnailUrl: card.details?.cropImageUrl ?? card.details?.imageUrl,
        unresolved: card.unresolved
      }))
      .slice(0, maxDeckRows),
    deckCount: visibleDeckCount,
    lastPick: latestPick ? toArenaChoice(latestPick) : undefined
  } satisfies NonNullable<OverlayPanelViewModel["arena"]>;
}

function toArenaChoice(
  choice: Pick<ArenaCardChoice, "cardId" | "name" | "score" | "details" | "quality" | "rating">
): OverlayArenaChoice {
  return {
    id: `arena-choice-${choice.cardId ?? choice.name}`,
    name: choice.name,
    score: choice.score,
    thumbnailUrl: choice.details?.cropImageUrl ?? choice.details?.imageUrl,
    details: choice.details,
    quality: choice.quality,
    rating: choice.rating,
    ratingSummary: formatRatingSummary(choice.rating)
  };
}

function formatRatingSummary(rating: ArenaCardChoice["rating"]): string | undefined {
  if (!rating) {
    return undefined;
  }

  const parts = [rating.hearthArena === undefined ? undefined : `HA ${rating.hearthArena}`];
  if (rating.firestone?.includedWinrate !== undefined) {
    parts.push(`入选胜率 ${rating.firestone.includedWinrate.toFixed(1)}%`);
  }
  if (rating.pickRate !== undefined) {
    parts.push(`选取率 ${rating.pickRate.toFixed(1)}%`);
  }
  if (rating.highWinPickRate !== undefined) {
    const label = rating.highWinThreshold === undefined ? "高胜选取" : `${rating.highWinThreshold}+胜选取`;
    parts.push(`${label} ${rating.highWinPickRate.toFixed(1)}%`);
  }
  if (rating.twelveWinRate !== undefined) {
    parts.push(`实际12胜 ${rating.twelveWinRate.toFixed(1)}%`);
  }
  return parts.filter((part): part is string => part !== undefined).join(" · ") || undefined;
}

function toLogIssueStatus(state: PublicTrackerState): { tone: OverlayStatusTone; label: string } | undefined {
  if (state.status === "missing-log") {
    return { tone: "offline", label: "缺少 Power.log" };
  }

  if (isPlayerOnlyLogPath(state.logPath)) {
    return { tone: "offline", label: "只有 Player.log" };
  }

  return undefined;
}

function toRemainingDeckItems(rows: readonly CardTrackerRow[], maxRows: number): OverlayCardItem[] {
  return [...rows]
    .filter((row) => row.remaining > 0)
    .sort(compareCardsByMana)
    .slice(0, maxRows)
    .map((row) => ({
      id: `deck-${stableCardIdentity(row)}`,
      name: row.name,
      cost: row.details?.manaCost,
      count: row.remaining,
      detail: `剩 ${row.remaining}/${row.count}`,
      thumbnailUrl: row.details?.cropImageUrl ?? row.details?.imageUrl,
      details: row.details,
      unresolved: row.unresolved
    }));
}

function toZoneCardItems(rows: readonly TrackerZoneCard[], prefix: string, maxRows: number): OverlayCardItem[] {
  return [...rows]
    .sort(compareCardsByMana)
    .slice(0, maxRows)
    .map((row) => ({
      id: `${prefix}-${stableCardIdentity(row)}`,
      name: row.name,
      cost: row.details?.manaCost,
      count: row.count,
      thumbnailUrl: row.details?.cropImageUrl ?? row.details?.imageUrl,
      details: row.details
    }));
}

function compareCardsByMana(
  left: Pick<CardTrackerRow | DeckCard | TrackerZoneCard, "name" | "details">,
  right: Pick<CardTrackerRow | DeckCard | TrackerZoneCard, "name" | "details">
) {
  const leftCost = left.details?.manaCost ?? Number.POSITIVE_INFINITY;
  const rightCost = right.details?.manaCost ?? Number.POSITIVE_INFINITY;
  return leftCost - rightCost || left.name.localeCompare(right.name, "zh-CN");
}

function stableCardIdentity(card: Pick<CardTrackerRow | DeckCard | TrackerZoneCard, "name" | "details"> & { cardId?: string }) {
  return card.cardId ?? card.details?.cardId ?? card.details?.dbfId ?? card.name;
}

function isFriendlyDraw(event: TrackerEvent): boolean {
  return event.kind === "draw" && event.player === "friendly";
}

function toDrawItem(event: TrackerEvent, rows: readonly CardTrackerRow[]): OverlayCardItem {
  return {
    id: event.id,
    name: event.cardName?.trim() || "未知卡牌",
    detail: `抽牌 ${formatTimeLabel(event.at)}`,
    details: findDetails(rows, event)
  };
}

function findDetails(rows: readonly CardTrackerRow[], event: TrackerEvent) {
  const normalizedCardId = event.cardId?.trim().toLocaleLowerCase();
  const byCardId = normalizedCardId
    ? rows.find((row) => row.cardId?.trim().toLocaleLowerCase() === normalizedCardId)
    : undefined;
  const byName = event.cardName?.trim()
    ? rows.find((row) => row.name.trim() === event.cardName?.trim())
    : undefined;
  return (byCardId ?? byName)?.details;
}

function statusDetail(state: PublicTrackerState): string {
  if (state.status === "error") {
    return state.error ?? "监听异常";
  }

  if (state.status === "missing-log") {
    return state.logPath ? `找不到 ${compactPath(state.logPath)}` : "未找到日志";
  }

  if (state.status === "watching") {
    return state.logPath ? `监听 ${compactPath(state.logPath)}` : "正在监听日志";
  }

  if (state.status === "paused") {
    return "监听已暂停";
  }

  return state.logPath ? `已选择 ${compactPath(state.logPath)}` : "等待开始监听";
}

function isPlayerOnlyLogPath(logPath: string | undefined): boolean {
  return Boolean(logPath?.trim().match(/(^|[\\/])Player\.log$/i));
}

function isRepeatedStatusMessage(label: string, detail: string): boolean {
  const normalize = (value: string) => value.trim().replace(/[。.!！]+$/u, "");
  return normalize(label) === normalize(detail);
}

function waitingForGameDetail(error: string | undefined, label: string, fallback: string): string {
  if (!error || isRepeatedStatusMessage(label, error)) {
    return fallback;
  }

  const detail = error.replace(/^已识别炉石[，,](?:正在)?等待开局[；;]\s*/u, "").trim();
  return detail && detail !== error.trim() ? detail : error;
}

function compactPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);

  if (parts.length <= 2) {
    return path;
  }

  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

function formatTimeLabel(value: string | undefined): string {
  if (!value) {
    return "刚刚";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}
