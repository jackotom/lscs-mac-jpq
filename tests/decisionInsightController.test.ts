import { describe, expect, it, vi } from "vitest";
import { DecisionInsightController } from "../src/main/decisionInsightController";
import { createPublicTrackerState } from "./fixtures/publicTrackerState";
import type { DecisionStatsService } from "../src/main/decisionStatsService";

const offer = { id: "1", kind: "discover" as const, cards: [{ entityId: "20", cardId: "CARD_A", name: "候选牌" }] };
const state = () => createPublicTrackerState({ status: "watching", gameActive: true, deckCode: "valid-deck", decisionOffer: offer });
const result = { status: "ready" as const, source: "Firestone 当前套牌", stats: [{ cardId: "CARD_A", samples: 250, winRate: 52, metric: "discovered" as const }, { cardId: "OTHER", samples: 300, winRate: 70, metric: "discovered" as const }] };

describe("decision insight request lifecycle", () => {
  it("deduplicates state broadcasts and only publishes statistics for current choices", async () => {
    const getStats = vi.fn(async () => result);
    const changed = vi.fn();
    const controller = new DecisionInsightController(changed, { getStats } as unknown as DecisionStatsService);
    expect(controller.update(state(), "standard")?.status).toBe("loading");
    controller.update(state(), "standard");
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(getStats).toHaveBeenCalledOnce();
    expect(controller.update(state(), "standard")?.stats).toEqual([result.stats[0]]);
  });

  it("ignores a delayed response after a choice ends or a new game starts", async () => {
    let resolve!: (value: typeof result) => void;
    const changed = vi.fn();
    const getStats = vi.fn(() => new Promise<typeof result>((done) => { resolve = done; }));
    const controller = new DecisionInsightController(changed, { getStats } as unknown as DecisionStatsService);
    controller.update(state(), "standard");
    expect(controller.update(createPublicTrackerState(), "standard")).toBeUndefined();
    resolve(result);
    await Promise.resolve();
    expect(changed).not.toHaveBeenCalled();
    expect(controller.update(createPublicTrackerState(), "standard")).toBeUndefined();
  });

  it("returns an explicit unavailable state without an enabled data provider", () => {
    const controller = new DecisionInsightController(vi.fn());
    expect(controller.update(state(), "standard")).toMatchObject({ status: "unavailable", stats: [] });
  });
});
