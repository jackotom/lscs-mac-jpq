import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { analyzeMatches, filterMatches, localMatchDay, parseMatchDetails } from "../src/shared/matchAnalytics";
import { MatchHistoryStore } from "../src/main/matchHistoryStore";
import type { MatchRecord } from "../src/shared/types";

vi.mock("electron", () => ({ app: { getPath: () => os.tmpdir() } }));

const matches: MatchRecord[] = [
  { id: "a", mode: "standard", deckName: "同名套牌", result: "win", endedAt: new Date(2026, 9, 4, 23, 59).toISOString(), details: { deckKey: "v1", opponentClass: "MAGE", initiative: "first", durationSeconds: 120, turns: 8 } },
  { id: "b", mode: "standard", deckName: "同名套牌", result: "tie", endedAt: new Date(2026, 9, 5, 0, 1).toISOString(), details: { deckKey: "v2", opponentClass: "MAGE", initiative: "second", durationSeconds: 180, turns: 10 } },
  { id: "legacy", mode: "wild", result: "loss", endedAt: new Date(2026, 9, 5, 12).toISOString() }
];

describe("match insights", () => {
  it("preserves old records and round-trips observed details", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "match-insights-"));
    try {
      const file = path.join(root, "history.json");
      await fs.writeFile(file, JSON.stringify({ matches: [matches[2]] }));
      const store = new MatchHistoryStore(file);
      await store.add(matches[0]);
      const result = await new MatchHistoryStore(file).getHistory();
      expect(result).toMatchObject({ status: "ok", matches: expect.arrayContaining([matches[0], matches[2]]) });
      await expect(store.add({ ...matches[1], details: { turns: NaN } })).rejects.toThrow();
      expect(JSON.parse(await fs.readFile(file, "utf8")).matches).toHaveLength(2);
      await fs.writeFile(file, JSON.stringify({ matches: [{ ...matches[1], details: { initiative: "invalid" } }] }));
      await expect(new MatchHistoryStore(file).getHistory()).resolves.toMatchObject({ status: "error", error: expect.stringContaining("initiative") });
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });

  it("rejects malformed new fields rather than inventing zero or blank classes", () => {
    for (const value of [null, [], { friendlyClass: " " }, { opponentClass: 3 }, { opponentClass: "NOT_A_CLASS" }, { initiative: "unknown" }, { durationSeconds: Infinity }, { durationSeconds: -1 }, { turns: 1.5 }, { deckKey: "" }, { mulligan: [{ cardId: "A", cardName: "A", drawnBeforeMulligan: true }] }]) {
      expect(() => parseMatchDetails(value)).toThrow();
    }
    expect(parseMatchDetails({})).toEqual({});
    expect(parseMatchDetails({ turns: 0, durationSeconds: 0 })).toEqual({ turns: 0, durationSeconds: 0 });
  });

  it("uses all outcomes as denominator, known-only averages, unknown buckets and local days", () => {
    const analysis = analyzeMatches(matches);
    expect(analysis.summary).toEqual({ total: 3, wins: 1, losses: 1, ties: 1, winRate: 1 / 3 });
    expect(analysis.duration).toEqual({ value: 150, samples: 2 });
    expect(analysis.turns).toEqual({ value: 9, samples: 2 });
    expect(analysis.initiative.find((group) => group.key === null)?.total).toBe(1);
    expect(analysis.decks).toHaveLength(3);
    expect(analysis.days.map((day) => [day.key, day.total])).toEqual([["2026-10-04", 1], ["2026-10-05", 2]]);
    expect(localMatchDay(matches[0].endedAt)).toBe("2026-10-04");
    expect(analyzeMatches([])).toMatchObject({ summary: { total: 0, winRate: undefined }, duration: { samples: 0, value: undefined } });
    expect(analyzeMatches([matches[2]]).turns.value).toBeUndefined();
  });

  it("combines filters inclusively and keeps identically named deck versions separate", () => {
    expect(filterMatches(matches, { mode: "standard", from: "2026-10-04", to: "2026-10-05", deckKey: "v1", opponentClass: "MAGE", initiative: "first" }).map((match) => match.id)).toEqual(["a"]);
    expect(filterMatches(matches, { from: "2026-10-05", to: "2026-10-05" })).toHaveLength(2);
    expect(filterMatches(matches, { initiative: null }).map((match) => match.id)).toEqual(["legacy"]);
    expect(filterMatches(matches, { from: "2026-10-06", to: "2026-10-04" })).toEqual([]);
  });
});
