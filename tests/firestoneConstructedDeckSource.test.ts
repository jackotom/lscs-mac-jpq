import { describe, expect, it } from "vitest";
import { parseFirestoneConstructedDecks } from "../src/main/firestoneConstructedDeckSource.js";

const deckCode = "AAECAQcCi6AE0LIHDuPmBqr8Bqv8BuiHB9KXB7etB4+xB+yyB4S9B7XAB5XCB5vCB5zCB/nDBwAA";

describe("Firestone constructed deck source", () => {
  it("converts owner data to a localized and traceable recommendation", () => {
    const result = parseFirestoneConstructedDecks({
      lastUpdated: "2026-08-11T20:59:09.000Z",
      rankBracket: "legend",
      timePeriod: "past-7",
      format: "standard",
      dataPoints: 113389,
      deckStats: [{
        archetypeId: 40968,
        archetypeName: "face-hunter",
        playerClass: "hunter",
        format: "standard",
        totalGames: 1185,
        totalWins: 667,
        decklist: deckCode
      }]
    }, {
      mode: "standard",
      expectedPatch: "36.2",
      sourceUrl: "https://static.zerotoheroes.com/api/constructed/stats/decks/standard/legend/past-7/overview-from-hourly.gz.json"
    });

    expect(result).toEqual([
      expect.objectContaining({
        name: "打脸猎人",
        className: "猎人",
        region: "GLOBAL",
        patch: "36.2",
        games: 1185,
        winRate: 56.29,
        updatedAt: "2026-08-11T20:59:09.000Z",
        source: { name: "Firestone 天梯统计（传说分段·近7天）", url: expect.stringContaining("static.zerotoheroes.com") }
      })
    ]);
  });

  it("drops malformed or undecodable deck rows", () => {
    expect(() => parseFirestoneConstructedDecks({
      lastUpdated: "2026-08-11T20:59:09.000Z",
      format: "standard",
      deckStats: [{ playerClass: "mage", format: "standard", totalGames: 900, totalWins: 500, decklist: "not-a-deck" }]
    }, {
      mode: "standard",
      expectedPatch: "36.2",
      sourceUrl: "https://static.zerotoheroes.com/source.json"
    })).toThrow("没有可用卡组");
  });
});
