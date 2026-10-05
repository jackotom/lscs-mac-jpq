import { describe, expect, it } from "vitest";
import { parseMatchHistoryResult, parsePublicTrackerState } from "../src/renderer/runtimeValidation";
import { createPublicTrackerState } from "./fixtures/publicTrackerState";

const offer = {
  id: "mulligan-1", kind: "mulligan",
  cards: [
    { entityId: "1", cardId: "CS2_029", name: "火球术" },
    { entityId: "2", cardId: "CS2_029", name: "火球术" }
  ]
};
const insight = {
  ...offer, mode: "standard", status: "ready", source: "本机对局档案",
  updatedAt: "2026-10-05T01:00:00.000Z", note: "仅供参考",
  stats: [{ cardId: "CS2_029", samples: 10, winRate: 60, keepRate: 50, keepSamples: 20, drawnWinRate: 70, metric: "mulligan" }]
};
const details = {
  friendlyClass: "MAGE", opponentClass: "WARRIOR", initiative: "first", durationSeconds: 300,
  turns: 8, deckKey: "deck-1", mulligan: [{ cardId: "CS2_029", cardName: "火球术",
    drawnBeforeMulligan: true, keptInMulligan: true, inHandAfterMulligan: true }]
};
const state = () => ({ ...createPublicTrackerState(), gameActive: true,
  matchDetails: structuredClone(details), decisionOffer: structuredClone(offer), decisionInsight: structuredClone(insight) });
const history = (extra: object = {}) => ({ status: "ok", matches: [{ id: "match-1", mode: "standard", result: "win",
  endedAt: "2026-10-05T01:00:00Z", ...extra }], summary: { total: 1, wins: 1, losses: 0, ties: 0, winRate: 100 } });

describe("decision and match detail boundary", () => {
  it("accepts old history, valid new details and duplicate card IDs in an offer", () => {
    expect(() => parsePublicTrackerState(state())).not.toThrow();
    expect(() => parsePublicTrackerState(createPublicTrackerState())).not.toThrow();
    expect(() => parseMatchHistoryResult(history())).not.toThrow();
    expect(() => parseMatchHistoryResult(history({ details }))).not.toThrow();
  });

  it("rejects invalid or hidden fields in both current and historical details", () => {
    for (const invalid of [null, { turns: -1 }, { durationSeconds: Infinity }, { initiative: "third" },
      { opponentHand: ["SECRET"] }, { mulligan: [{ ...details.mulligan[0], keptInMulligan: "yes" }] },
      { mulligan: [{ ...details.mulligan[0], hiddenCard: "SECRET" }] },
      { mulligan: Array.from({ length: 51 }, () => details.mulligan[0]) }]) {
      expect(() => parsePublicTrackerState({ ...state(), matchDetails: invalid })).toThrow();
      expect(() => parseMatchHistoryResult(history({ details: invalid }))).toThrow();
    }
  });

  it("rejects malformed, oversized and duplicate-entity offers", () => {
    for (const invalid of [null, { ...offer, id: " " }, { ...offer, kind: "opponent" },
      { ...offer, cards: [] }, { ...offer, cards: [offer.cards[0], offer.cards[0]] },
      { ...offer, cards: Array.from({ length: 51 }, (_, i) => ({ ...offer.cards[0], entityId: String(i) })) },
      { ...offer, cards: [{ ...offer.cards[0], cardId: "x".repeat(1000) }] },
      { ...offer, cards: [{ ...offer.cards[0], hidden: true }] }, { ...offer, opponentHand: [] }]) {
      expect(() => parsePublicTrackerState({ ...state(), decisionOffer: invalid, decisionInsight: undefined })).toThrow();
    }
  });

  it("requires active game and exactly matching offer identity and cards", () => {
    for (const patch of [{ gameActive: false }, { gameActive: undefined }, { decisionOffer: undefined },
      { decisionInsight: { ...insight, id: "stale" } }, { decisionInsight: { ...insight, kind: "discover" } },
      { decisionInsight: { ...insight, cards: [{ entityId: "1", cardId: "SECRET", name: "隐藏牌" }] } }]) {
      expect(() => parsePublicTrackerState({ ...state(), ...patch })).toThrow();
    }
  });

  it("rejects nonfinite ratios, invalid samples, duplicate or unrelated statistics", () => {
    const row = insight.stats[0];
    for (const stats of [[{ ...row, samples: 0 }], [{ ...row, samples: 1.5 }], [{ ...row, winRate: NaN }],
      [{ ...row, winRate: 101 }], [{ ...row, keepRate: -1 }], [{ ...row, drawnWinRate: Infinity }],
      [{ ...row, keepSamples: undefined }], [{ ...row, keepSamples: 0 }], [{ ...row, keepSamples: 1.5 }],
      [{ ...row, keepSamples: Infinity }],
      [{ ...row, metric: "unknown" }], [{ ...row, cardId: "SECRET" }], [row, row],
      [{ ...row, opponentDeck: ["SECRET"] }]]) {
      expect(() => parsePublicTrackerState({ ...state(), decisionInsight: { ...insight, stats } })).toThrow();
    }
  });

  it("requires empty statistics until ready and validates metadata", () => {
    for (const status of ["loading", "unavailable"]) {
      expect(() => parsePublicTrackerState({ ...state(), decisionInsight: { ...insight, status, stats: [] } })).not.toThrow();
      expect(() => parsePublicTrackerState({ ...state(), decisionInsight: { ...insight, status } })).toThrow();
    }
    for (const patch of [{ updatedAt: "not-a-date" }, { mode: "bad" }, { source: " " },
      { source: "x".repeat(1000) }, { note: "x".repeat(5000) }, { hiddenCards: [] }]) {
      expect(() => parsePublicTrackerState({ ...state(), decisionInsight: { ...insight, ...patch } })).toThrow();
    }
  });
});
