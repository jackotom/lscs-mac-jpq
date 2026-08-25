import type { PublicCardZone } from "../shared/types";
import type { OverlayCardTrackingView } from "./types";

export type TrackingLayoutMode = "short" | "tall" | "opponent";
export type TrackingPage = "current" | "history";
export type TrackingGroupKey = PublicCardZone | "burned" | "used" | "confirmed-hand";
export type SelectionOrigin = "system" | "user";

export interface TrackingSelection {
  readonly page: TrackingPage;
  readonly expanded: ReadonlySet<TrackingGroupKey>;
}

export function trackingLayoutModeForHeight(
  height: number
): Exclude<TrackingLayoutMode, "opponent"> | undefined {
  if (!Number.isFinite(height) || height <= 0) return undefined;
  return height < 400 ? "short" : "tall";
}

export function resolveFriendlyDefault(
  layoutMode: Exclude<TrackingLayoutMode, "opponent">,
  page: TrackingPage = "current"
): TrackingSelection {
  if (page === "history") {
    return {
      page,
      expanded: new Set<TrackingGroupKey>(layoutMode === "tall" ? ["burned", "used"] : ["burned"])
    };
  }
  return {
    page,
    expanded: new Set<TrackingGroupKey>(layoutMode === "tall" ? ["deck", "hand"] : ["deck"])
  };
}

export function resolveOpponentDefault(view: OverlayCardTrackingView): TrackingSelection {
  if (view.secretSlots.length > 0) {
    return selection("current", "secret");
  }
  if (view.current.hand.knownCount > 0 || view.current.hand.cards.length > 0) {
    return selection("current", "hand");
  }
  const handTotal = view.current.hand.totalCount;
  if (
    view.current.hand.status !== "known" ||
    (handTotal !== undefined && handTotal > view.current.hand.knownCount)
  ) {
    return selection("current", "hand");
  }
  if (
    view.current.deck.status !== "known" ||
    view.current.deck.knownCount > 0 ||
    (view.current.deck.totalCount ?? 0) > 0 ||
    view.current.deck.cards.length > 0
  ) {
    return selection("current", "deck");
  }
  if (view.burned.totalCount > 0 || view.burned.items.length > 0) {
    return selection("history", "burned");
  }
  if (view.used.totalCount > 0 || view.used.items.length > 0) {
    return selection("history", "used");
  }
  return selection("current", "deck");
}

function selection(page: TrackingPage, key: TrackingGroupKey): TrackingSelection {
  return { page, expanded: new Set<TrackingGroupKey>([key]) };
}
