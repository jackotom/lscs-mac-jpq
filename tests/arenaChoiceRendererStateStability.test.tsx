import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicTrackerState } from "../src/shared/types";
import { createPublicTrackerState } from "./fixtures/publicTrackerState";
import { openWorkbench } from "./helpers/openWorkbench";

const ratedState = createPublicTrackerState({
  status: "watching",
  deck: [],
  events: [],
  summary: { totalCards: 0, remainingCards: 0, drawnCards: 0, opponentPlayedCount: 0 },
  arena: {
    status: "drafting",
    hero: { name: "法师", className: "Mage" },
    draftCount: 0,
    unresolvedCount: 30,
    currentChoices: [
      {
        name: "候选一",
        cardId: "TEST_001",
        count: 1,
        rating: { drawnImpact: -1.85, deckImpact: -1.75, pickRate: 41.2, highWinPickRate: 56.8, highWinThreshold: 6 }
      },
      {
        name: "候选二",
        cardId: "TEST_002",
        count: 1,
        rating: { drawnImpact: -1.25, deckImpact: -1.1, pickRate: 37.5, highWinPickRate: 54.1, highWinThreshold: 6 }
      },
      {
        name: "候选三",
        cardId: "TEST_003",
        count: 1,
        rating: { drawnImpact: 0.25, deckImpact: 0.5, pickRate: 29.8, highWinPickRate: 51.6, highWinThreshold: 6 }
      }
    ],
    picks: [],
    deck: []
  }
});

function installTrackerApi() {
  let emit!: (state: PublicTrackerState) => void;
  window.hearthstoneTracker = {
    discoverLogs: vi.fn(async () => []),
    getState: vi.fn(async () => ratedState),
    onUpdate: vi.fn((callback: (state: PublicTrackerState) => void) => {
      emit = callback;
      return () => undefined;
    })
  } as unknown as typeof window.hearthstoneTracker;
  return (state: PublicTrackerState) => emit(state);
}

function withoutChoiceStatistics(state: PublicTrackerState): PublicTrackerState {
  return {
    ...state,
    arena: state.arena
      ? {
          ...state.arena,
          lastUpdated: "2026-07-26T10:00:01.000Z",
          currentChoices: state.arena.currentChoices.map(({ name, cardId, count }) => ({ name, cardId, count }))
        }
      : undefined
  };
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  delete window.hearthstoneTracker;
});

describe("arena choice renderer state stability", () => {
  it("keeps same-card four metrics in the dedicated overlay during a transient refresh", async () => {
    window.history.replaceState({}, "", "/?arena-choice-overlay=1");
    const emit = installTrackerApi();
    const { default: App } = await import("../src/renderer/App.js");

    render(<App />);

    const overlay = await screen.findByLabelText("竞技场选牌数据条");
    await waitFor(() => expect(within(overlay).getByText("41.2%")).toBeInTheDocument());

    act(() => emit(withoutChoiceStatistics(ratedState)));

    expect(within(overlay).getByText("41.2%")).toBeInTheDocument();
    expect(within(overlay).getByText("56.8%")).toBeInTheDocument();
    expect(within(overlay).getByText("-1.85")).toBeInTheDocument();
    expect(within(overlay).getByText("-1.75")).toBeInTheDocument();
  });

  it("keeps same-card pick and win statistics in ArenaPanel during a transient refresh", async () => {
    const emit = installTrackerApi();
    const { default: App } = await import("../src/renderer/App.js");

    render(<App />);
    await openWorkbench();

    const candidate = await screen.findByLabelText("候选一");
    const candidateRow = candidate.closest("li");
    expect(candidateRow).not.toBeNull();
    await waitFor(() => expect(within(candidateRow!).getByText("41.2%")).toBeInTheDocument());

    act(() => emit(withoutChoiceStatistics(ratedState)));

    expect(within(candidateRow!).getByText("41.2%")).toBeInTheDocument();
    expect(candidateRow).toHaveTextContent("6+胜选取 56.8%");
  });
});
