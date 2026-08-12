import type { CardDetails, CardInfo } from "./cardDatabase.js";
import type { DeckCard, SmartCardCounter } from "./types.js";
import {
  evaluateSmartCounterRules,
  type SmartCounterPlayEvent
} from "./smartCounterRules.js";

export type SmartCounterCardUse = SmartCounterPlayEvent;

export interface BuildSmartCardCountersOptions {
  readonly uses: readonly SmartCounterCardUse[];
  readonly friendlyDeck: readonly DeckCard[];
  readonly currentTurn?: number;
  readonly activeSide?: "friendly" | "opponent";
  readonly resolveCard: (cardId?: string, name?: string, entityId?: string) => CardInfo | undefined;
  readonly toDetails: (card: CardInfo) => CardDetails | undefined;
}

export function buildSmartCardCounters(options: BuildSmartCardCountersOptions): readonly SmartCardCounter[] {
  return evaluateSmartCounterRules(options);
}
