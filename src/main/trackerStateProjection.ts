import type {
  ArenaState,
  PublicCardTracking,
  PublicCardZoneGroup,
  PublicPlayerCardTracking,
  PublicTrackerState
} from "../shared/types.js";

export type TrackerStateCapability =
  | "full"
  | "friendly"
  | "opponent"
  | "arena-choice"
  | "board-attack"
  | "friendly-attack"
  | "opponent-attack"
  | "friendly-health"
  | "opponent-health"
  | "secret"
  | "smart-counter"
  | `smart-counter:${string}`;

export function projectTrackerState(
  capability: TrackerStateCapability,
  state: PublicTrackerState
): PublicTrackerState {
  if (capability === "full" || capability === "friendly" || capability === "opponent") {
    return state;
  }

  const projected: PublicTrackerState = {
    status: state.status,
    ...(state.gameActive === undefined ? {} : { gameActive: state.gameActive }),
    deck: [],
    opponentPlayed: [],
    events: [],
    summary: { totalCards: 0, remainingCards: 0, drawnCards: 0, opponentPlayedCount: 0 },
    cardTracking: projectCardTracking(state.cardTracking, capability === "secret")
  };

  if (capability === "board-attack") return { ...projected, boardAttack: state.boardAttack };
  if (capability === "friendly-attack") return {
    ...projected,
    boardAttack: { friendly: state.boardAttack?.friendly ?? 0, opponent: 0 }
  };
  if (capability === "opponent-attack") return {
    ...projected,
    boardAttack: { friendly: 0, opponent: state.boardAttack?.opponent ?? 0 }
  };
  if (capability === "friendly-health") return {
    ...projected,
    heroHealthLimit: state.heroHealthLimit?.friendly === undefined
      ? undefined
      : { friendly: state.heroHealthLimit.friendly }
  };
  if (capability === "opponent-health") return {
    ...projected,
    heroHealthLimit: state.heroHealthLimit?.opponent === undefined
      ? undefined
      : { opponent: state.heroHealthLimit.opponent }
  };
  if (capability === "smart-counter" || capability.startsWith("smart-counter:")) {
    const counterId = capability.slice("smart-counter:".length);
    const counters = state.smartCounters ?? [];
    return {
      ...projected,
      smartCounters: counterId ? counters.filter((counter) => counter.id === counterId) : counters
    };
  }
  if (capability === "arena-choice") return { ...projected, arena: projectArena(state.arena) };
  return projected;
}

function projectArena(arena: ArenaState | undefined): ArenaState | undefined {
  if (!arena) return undefined;
  return {
    status: arena.status,
    currentChoices: arena.currentChoices,
    picks: [],
    deck: arena.deck.map(({ name, count, cardId }) => ({
      name,
      count,
      ...(cardId === undefined ? {} : { cardId })
    })),
    draftCount: arena.status === "inactive" ? 0 : arena.draftCount,
    unresolvedCount: arena.unresolvedCount,
    ...(arena.hero === undefined ? {} : { hero: arena.hero }),
    ...(arena.scoreSource === undefined ? {} : { scoreSource: arena.scoreSource }),
    ...(arena.ratingsVersion === undefined ? {} : { ratingsVersion: arena.ratingsVersion }),
    ...(arena.lastUpdated === undefined ? {} : { lastUpdated: arena.lastUpdated }),
    ...(arena.error === undefined ? {} : { error: arena.error })
  };
}

function projectCardTracking(source: PublicCardTracking, includeSecrets: boolean): PublicCardTracking {
  const friendly = emptyPlayerTracking(false);
  const opponent = emptyPlayerTracking(true);
  const secret = includeSecrets ? source.opponent.current.secret : emptyZone(false);
  const slots = includeSecrets ? source.opponentSecretSlots : [];
  const cardKeys = new Set(secret.cards.map((card) => card.cardKey));

  return {
    schemaVersion: 1,
    gameKey: source.gameKey,
    friendly,
    opponent: {
      ...opponent,
      current: { ...opponent.current, secret }
    },
    opponentSecretSlots: slots,
    detailsByCardKey: filterCardMap(source.detailsByCardKey, cardKeys),
    contextDetailsBySideAndCardKey: {
      friendly: {},
      opponent: filterCardMap(source.contextDetailsBySideAndCardKey.opponent, cardKeys)
    }
  };
}

function emptyPlayerTracking(opponent: boolean): PublicPlayerCardTracking {
  return {
    current: {
      deck: emptyZone(opponent),
      hand: emptyZone(opponent),
      play: emptyZone(false),
      secret: emptyZone(false),
      graveyard: emptyZone(false),
      removed: emptyZone(false)
    },
    burned: { totalCount: 0, items: [], truncated: false },
    used: { totalCount: 0, items: [], truncated: false }
  };
}

function emptyZone(unknown: boolean): PublicCardZoneGroup {
  return unknown
    ? { status: "unknown", knownCount: 0, cards: [] }
    : { status: "known", knownCount: 0, totalCount: 0, cards: [] };
}

function filterCardMap<T>(source: Readonly<Record<string, T>>, cardKeys: ReadonlySet<string>): Readonly<Record<string, T>> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => cardKeys.has(key)));
}
