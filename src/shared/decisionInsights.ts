import type { MatchMode } from "./types.js";

export interface MulliganObservation {
  readonly cardId: string;
  readonly cardName: string;
  readonly drawnBeforeMulligan: boolean;
  readonly keptInMulligan: boolean;
  readonly inHandAfterMulligan: boolean;
}

export interface MatchDetails {
  readonly friendlyClass?: string;
  readonly opponentClass?: string;
  readonly initiative?: "first" | "second";
  readonly durationSeconds?: number;
  readonly turns?: number;
  readonly deckKey?: string;
  readonly mulligan?: readonly MulliganObservation[];
}

export interface DecisionCard {
  readonly entityId: string;
  readonly cardId: string;
  readonly name: string;
}

export interface DecisionOffer {
  readonly id: string;
  readonly kind: "mulligan" | "discover";
  readonly cards: readonly DecisionCard[];
}

export interface DecisionCardStats {
  readonly cardId: string;
  readonly samples: number;
  readonly winRate: number;
  readonly keepRate?: number;
  readonly keepSamples?: number;
  readonly drawnWinRate?: number;
  readonly metric?: "mulligan" | "discovered" | "drawn";
}

export interface DecisionInsight extends DecisionOffer {
  readonly mode: MatchMode;
  readonly status: "loading" | "ready" | "unavailable";
  readonly source: string;
  readonly updatedAt?: string;
  readonly note?: string;
  readonly stats: readonly DecisionCardStats[];
}
