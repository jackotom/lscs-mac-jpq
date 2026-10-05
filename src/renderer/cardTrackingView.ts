import type {
  PublicCardHistoryGroup,
  PublicCardHistoryItem,
  PublicCardContextDetails,
  PublicCardTracking,
  PublicCardZone,
  PublicCardZoneGroup
} from "../shared/types";
import type { CardDetails } from "../shared/cardDatabase";
import type {
  OverlayCardHistoryView,
  OverlayCardItem,
  OverlayCardTrackingView,
  OverlayCardZoneView,
  OverlayHistoryItem,
  OverlaySecretSlot
} from "./types";

const cardZones = ["deck", "hand", "play", "secret", "graveyard", "removed"] as const;

export function toCardTrackingView(
  tracking: PublicCardTracking,
  side: "friendly" | "opponent",
  options: { showSecretCandidates: boolean }
): OverlayCardTrackingView {
  const player = tracking[side];
  const secretSlots = side === "opponent"
    ? toSecretSlots(tracking, options.showSecretCandidates)
    : [];

  return {
    status: "ready",
    gameKey: tracking.gameKey,
    side,
    current: Object.fromEntries(cardZones.map((zone) => [
      zone,
      toCurrentGroup(tracking, zone, player.current[zone], side, secretSlots.length)
    ])) as Readonly<Record<PublicCardZone, OverlayCardZoneView>>,
    burned: toHistoryGroup(tracking, side, "burned", player.burned),
    used: toHistoryGroup(tracking, side, "used", player.used),
    secretSlots,
    ...(tracking.deckInsertions?.[side]
      ? { deckInsertions: tracking.deckInsertions[side] }
      : {})
  };
}

function toCurrentGroup(
  tracking: PublicCardTracking,
  zone: PublicCardZone,
  group: PublicCardZoneGroup,
  side: "friendly" | "opponent",
  secretSlotCount: number
): OverlayCardZoneView {
  const cards = group.cards.map((card): OverlayCardItem => {
    const details = detailsForSide(tracking, side, card.cardKey);
    return {
      id: `${zone}-${card.cardKey}`,
      name: card.name,
      count: card.count,
      cost: details?.manaCost,
      thumbnailUrl: details?.imageUrl ?? details?.cropImageUrl,
      details
    };
  });
  return {
    key: zone,
    status: group.status,
    knownCount: group.knownCount,
    totalCount: group.totalCount,
    countLabel: side === "opponent" && zone === "secret"
      ? `当前 ${secretSlotCount}`
      : toZoneCountLabel(group),
    cards: side === "friendly" && zone === "deck"
      ? [...cards].sort(compareDeckCards)
      : cards
  };
}

function compareDeckCards(left: OverlayCardItem, right: OverlayCardItem): number {
  const leftCost = left.cost ?? Number.POSITIVE_INFINITY;
  const rightCost = right.cost ?? Number.POSITIVE_INFINITY;
  return leftCost - rightCost || left.name.localeCompare(right.name, "zh-CN");
}

function toZoneCountLabel(group: PublicCardZoneGroup): string {
  if (group.totalCount !== undefined) {
    return String(group.totalCount);
  }
  if (group.status !== "known") {
    return group.knownCount > 0 ? `≥${group.knownCount}` : "?";
  }
  return String(group.knownCount);
}

function toHistoryGroup(
  tracking: PublicCardTracking,
  side: "friendly" | "opponent",
  key: "burned" | "used",
  group: PublicCardHistoryGroup
): OverlayCardHistoryView {
  return {
    key,
    totalCount: group.totalCount,
    countLabel: group.truncated
      ? `最近 ${group.items.length} / 共 ${group.totalCount}`
      : String(group.totalCount),
    truncated: group.truncated,
    items: group.items.map((item) => toHistoryItem(tracking, side, item))
  };
}

function toHistoryItem(
  tracking: PublicCardTracking,
  side: "friendly" | "opponent",
  item: PublicCardHistoryItem
): OverlayHistoryItem {
  const baseDetails = item.card
    ? detailsForSide(tracking, side, item.card.cardKey)
    : undefined;
  const details = mergeHistoryDetails(baseDetails, item.outcomeSections, item.card);

  return {
    id: item.id,
    sequence: item.sequence,
    ...(item.turn === undefined ? {} : { turn: item.turn }),
    displayName: item.card?.name,
    ...(item.card?.cardId ? { cardId: item.card.cardId } : {}),
    hidden: item.card === undefined,
    confidence: item.confidence,
    details
  };
}

function detailsForSide(
  tracking: PublicCardTracking,
  side: "friendly" | "opponent",
  cardKey: string
): CardDetails | undefined {
  const base = tracking.detailsByCardKey[cardKey];
  const context: PublicCardContextDetails | undefined =
    tracking.contextDetailsBySideAndCardKey[side][cardKey];
  return base && context ? { ...base, ...context } : base;
}

function mergeHistoryDetails(
  baseDetails: CardDetails | undefined,
  outcomeSections: PublicCardHistoryItem["outcomeSections"],
  card: PublicCardHistoryItem["card"]
): CardDetails | undefined {
  if (!baseDetails) {
    if (outcomeSections === undefined || card === undefined) {
      return undefined;
    }
    return {
      dbfId: dbfIdFromCardKey(card.cardKey),
      name: card.name,
      cardId: card.cardId,
      isSpell: false,
      relatedCards: [],
      cardOutcomeSections: outcomeSections
    };
  }
  if (outcomeSections === undefined) {
    return baseDetails;
  }
  return {
    ...baseDetails,
    cardOutcomeSections: outcomeSections
  };
}

function dbfIdFromCardKey(cardKey: string): number {
  const match = /^dbf:(\d+)$/iu.exec(cardKey);
  return match ? Number(match[1]) : 0;
}

function toSecretSlots(
  tracking: PublicCardTracking,
  showSecretCandidates: boolean
): readonly OverlaySecretSlot[] {
  return tracking.opponentSecretSlots.map((slot, slotIndex) => ({
    id: slot.entityId,
    label: `? ${slotIndex + 1}`,
    candidates: showSecretCandidates
      ? slot.candidates.map((candidate) => ({
          id: candidate.cardId,
          name: candidate.name,
          status: candidate.status,
          exclusionReason: candidate.exclusionReason,
          details: candidate.details
        }))
      : []
  }));
}
