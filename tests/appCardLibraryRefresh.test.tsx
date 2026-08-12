import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";
import type { CardLibraryResult } from "../src/shared/types";
import { createPublicTrackerState } from "./fixtures/publicTrackerState";
import { openWorkbench } from "./helpers/openWorkbench";

const trackerState = createPublicTrackerState({
  status: "missing-log",
  deck: [],
  events: [],
  summary: { totalCards: 0, remainingCards: 0, drawnCards: 0, opponentPlayedCount: 0 }
});

const libraryResult: CardLibraryResult = {
  status: "ok",
  query: "",
  page: 1,
  pageSize: 48,
  total: 1,
  items: [{
    dbfId: 315,
    name: "火球术",
    manaCost: 4,
    cardType: "法术",
    heroClass: "法师",
    text: "造成 6 点伤害。",
    isSpell: true,
    relatedCards: []
  }],
  heroClasses: ["法师"],
  cardTypes: ["法术"],
  warnings: []
};

afterEach(() => {
  window.history.replaceState({}, "", "/");
  delete window.hearthstoneTracker;
});

describe("card library refresh", () => {
  it("keeps the last successful cards visible when the next request fails", async () => {
    const listCardLibrary = vi.fn()
      .mockResolvedValueOnce(libraryResult)
      .mockRejectedValueOnce(new Error("本地缓存被占用"));
    window.hearthstoneTracker = {
      discoverLogs: vi.fn(async () => []),
      selectLogPath: vi.fn(),
      start: vi.fn(),
      pause: vi.fn(),
      importDeck: vi.fn(),
      ensureLogConfig: vi.fn(),
      inspectLogConfig: vi.fn(),
      toggleOverlay: vi.fn(),
      getState: vi.fn(async () => trackerState),
      onUpdate: vi.fn(() => () => undefined),
      listCardLibrary
    } as unknown as typeof window.hearthstoneTracker;

    render(<App />);
    await openWorkbench();
    fireEvent.click(await screen.findByRole("button", { name: "打开卡牌资料" }));
    expect(await screen.findByRole("button", { name: "查看 火球术 详情" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "职业筛选" }), { target: { value: "法师" } });

    expect(await screen.findByRole("alert")).toHaveTextContent("刷新失败，已保留上次结果：本地缓存被占用");
    expect(screen.getByRole("button", { name: "查看 火球术 详情" })).toBeInTheDocument();
    expect(listCardLibrary).toHaveBeenCalledTimes(2);
  });
});
