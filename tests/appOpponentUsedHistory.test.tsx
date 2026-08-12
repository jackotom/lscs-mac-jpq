import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";
import { createEmptyCardTracking, createPublicTrackerState } from "./fixtures/publicTrackerState";
import { openWorkbench } from "./helpers/openWorkbench";

const cardTracking = createEmptyCardTracking("app-opponent-history");
(cardTracking.opponent as unknown as Record<string, unknown>).used = {
  totalCount: 3,
  truncated: false,
  items: [
    {
      id: "hidden-use",
      sequence: 3,
      entityId: "hidden-entity",
      confidence: "confirmed"
    },
    {
      id: "use-b",
      sequence: 2,
      entityId: "entity-b",
      card: { cardKey: "id:toy_372", cardId: "TOY_372", name: "匣中古神" },
      confidence: "confirmed",
      outcomeSections: actualOutcome("结果 B", 202)
    },
    {
      id: "use-a",
      sequence: 1,
      entityId: "entity-a",
      card: { cardKey: "id:toy_372", cardId: "TOY_372", name: "匣中古神" },
      confidence: "confirmed",
      outcomeSections: actualOutcome("结果 A", 101)
    }
  ]
};
(cardTracking as unknown as Record<string, unknown>).detailsByCardKey = {
  "id:toy_372": {
    dbfId: 103_270,
    cardId: "TOY_372",
    name: "匣中古神",
    manaCost: 7,
    cardType: "法术",
    isSpell: true,
    relatedCards: [],
    cardPoolSections: [{
      key: "theoretical",
      title: "理论候选池",
      emptyText: "无候选",
      cards: [{ dbfId: 1, name: "理论法术" }]
    }]
  }
};

const state = createPublicTrackerState({
  status: "watching",
  gameActive: true,
  cardTracking
});

afterEach(() => {
  delete window.hearthstoneTracker;
});

function installApi() {
  window.hearthstoneTracker = {
    discoverLogs: vi.fn(async () => []),
    getState: vi.fn(async () => state),
    onUpdate: vi.fn(() => () => undefined)
  } as unknown as typeof window.hearthstoneTracker;
}

async function openTracker() {
  installApi();
  render(<App />);
  await waitFor(() => expect(window.hearthstoneTracker?.getState).toHaveBeenCalled());
  await openWorkbench();
  return screen.getByLabelText("对手已出牌");
}

describe("main-window opponent used history", () => {
  it("shows a hidden use as identity undisclosed without creating an unknown card", async () => {
    const panel = await openTracker();

    expect(within(panel).getByText("身份未公开")).toBeInTheDocument();
    expect(within(panel).queryByText("未知卡牌")).not.toBeInTheDocument();
  });

  it("shows only each same-card use outcome while retaining its theoretical pool", async () => {
    const panel = await openTracker();
    const rows = [...panel.querySelectorAll<HTMLElement>("summary.played-card-row")]
      .filter((row) => row.textContent?.includes("匣中古神"));
    expect(rows).toHaveLength(2);

    fireEvent.click(rows[0]!);
    const secondUse = rows[0]!.closest("li")!;
    expect(within(secondUse).getByText("结果 B")).toBeInTheDocument();
    expect(within(secondUse).queryByText("结果 A")).not.toBeInTheDocument();
    expect(within(secondUse).getByText("理论法术")).toBeInTheDocument();

    fireEvent.click(rows[1]!);
    const firstUse = rows[1]!.closest("li")!;
    expect(within(firstUse).getByText("结果 A")).toBeInTheDocument();
    expect(within(firstUse).queryByText("结果 B")).not.toBeInTheDocument();
    expect(within(firstUse).getByText("理论法术")).toBeInTheDocument();
  });
});

function actualOutcome(name: string, dbfId: number) {
  return [{
    key: "actual",
    title: "本次实际施放",
    emptyText: "无结果",
    cards: [{
      key: `actual-${dbfId}`,
      card: { dbfId, name }
    }]
  }];
}
