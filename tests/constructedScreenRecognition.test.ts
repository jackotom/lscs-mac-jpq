import { describe, expect, it } from "vitest";
import {
  findScreenSelectedCollectionDeck,
  inspectConstructedDeckScreen
} from "../src/main/constructedScreenRecognition";
import type { CollectionDeck } from "../src/shared/types";

const baseDeck: CollectionDeck = {
  id: "base",
  name: "偷取牌库",
  cards: [{ name: "Sample", count: 1 }],
  rawText: "",
  sourcePath: "/tmp/Decks.log",
  updatedAt: "2026-07-11T00:00:00.000Z",
  warnings: []
};

describe("constructed screen recognition", () => {
  it("reports Standard mode while the selected deck name is still missing", () => {
    const inspection = inspectConstructedDeckScreen(
      [{ text: "标准对战", confidence: 0.9, x: 0.32, y: 0.91, width: 0.06, height: 0.02 }],
      [{ ...baseDeck, id: "standard", format: "标准" }]
    );

    expect(inspection).toEqual({
      mode: "standard",
      selectedName: undefined,
      selectedDeck: undefined
    });
  });

  it("reports Wild mode without guessing between duplicate matching decks", () => {
    const inspection = inspectConstructedDeckScreen(
      [
        { text: "狂野对战", confidence: 0.9, x: 0.32, y: 0.91, width: 0.06, height: 0.02 },
        { text: "偷取牌库", confidence: 1, x: 0.72, y: 0.34, width: 0.06, height: 0.02 }
      ],
      [
        { ...baseDeck, id: "wild-a", format: "狂野" },
        { ...baseDeck, id: "wild-b", format: "wild" }
      ]
    );

    expect(inspection).toEqual({
      mode: "wild",
      selectedName: "偷取牌库",
      selectedDeck: undefined
    });
  });

  it("accepts a missing character in the constructed mode title", () => {
    const selectedDeck = { ...baseDeck, id: "wild", format: "狂野" };
    const inspection = inspectConstructedDeckScreen(
      [
        { text: "狂野 战", confidence: 0.3, x: 0.35, y: 0.89, width: 0.06, height: 0.02 },
        { text: "偷取牌库", confidence: 1, x: 0.72, y: 0.34, width: 0.06, height: 0.02 }
      ],
      [selectedDeck]
    );

    expect(inspection).toMatchObject({ mode: "wild", selectedDeck });
  });

  it("accepts an unambiguous one-character OCR error in a deck name", () => {
    const selectedDeck = { ...baseDeck, id: "wild", name: "自定义 牧师", format: "狂野" };
    const inspection = inspectConstructedDeckScreen(
      [
        { text: "狂野对战", confidence: 1, x: 0.35, y: 0.89, width: 0.06, height: 0.02 },
        { text: "自定义牧帅", confidence: 0.3, x: 0.69, y: 0.36, width: 0.07, height: 0.02 }
      ],
      [selectedDeck, { ...baseDeck, id: "other", name: "偷取牌库", format: "狂野" }]
    );

    expect(inspection.selectedDeck).toBe(selectedDeck);
  });

  it("matches Hearthstone's 备阵 display prefix to the logged deck name", () => {
    const standardPriest = { ...baseDeck, id: "standard-priest", name: "牧师", format: "标准" };
    const inspection = inspectConstructedDeckScreen(
      [
        { text: "标准对战", confidence: 1, x: 0.35, y: 0.89, width: 0.06, height: 0.02 },
        { text: "备阵牧师", confidence: 1, x: 0.72, y: 0.34, width: 0.07, height: 0.02 }
      ],
      [standardPriest, { ...baseDeck, id: "wild-priest", name: "牧师", format: "狂野" }]
    );

    expect(inspection.selectedDeck).toBe(standardPriest);
  });

  it("returns the exact deck after filtering matching names by mode", () => {
    const standardDeck = { ...baseDeck, id: "standard", format: "标准" };
    const inspection = inspectConstructedDeckScreen(
      [
        { text: "标准对战", confidence: 0.9, x: 0.32, y: 0.91, width: 0.06, height: 0.02 },
        { text: "偷取牌库", confidence: 1, x: 0.72, y: 0.34, width: 0.06, height: 0.02 }
      ],
      [{ ...baseDeck, id: "wild", format: "狂野" }, standardDeck]
    );

    expect(inspection).toEqual({
      mode: "standard",
      selectedName: "偷取牌库",
      selectedDeck: standardDeck
    });
  });

  it("uses the constructed mode to disambiguate decks with the same name", () => {
    const selected = findScreenSelectedCollectionDeck(
      [
        { text: "标准对战", confidence: 0.9, x: 0.32, y: 0.91, width: 0.06, height: 0.02 },
        { text: "偷取牌库", confidence: 1, x: 0.72, y: 0.34, width: 0.06, height: 0.02 }
      ],
      [
        { ...baseDeck, id: "wild", format: "狂野" },
        { ...baseDeck, id: "standard", format: "标准" }
      ]
    );

    expect(selected?.id).toBe("standard");
  });

  it("selects a uniquely named deck on the Casual screen regardless of format", () => {
    const selectedDeck = { ...baseDeck, id: "casual-demon-hunter", name: "自定义 恶魔猎手", format: "标准" };
    const inspection = inspectConstructedDeckScreen(
      [
        { text: "休闲模式", confidence: 0.9, x: 0.32, y: 0.91, width: 0.06, height: 0.02 },
        { text: "自定义 恶魔猎手", confidence: 1, x: 0.72, y: 0.34, width: 0.08, height: 0.02 }
      ],
      [selectedDeck, { ...baseDeck, id: "other", name: "任务牧", format: "狂野" }]
    );

    expect(inspection).toEqual({
      mode: "casual",
      selectedName: "自定义 恶魔猎手",
      selectedDeck
    });
  });

  it("does not guess between same-name Standard and Wild decks on the Casual screen", () => {
    const inspection = inspectConstructedDeckScreen(
      [
        { text: "休闲模式", confidence: 0.9, x: 0.32, y: 0.91, width: 0.06, height: 0.02 },
        { text: "自定义 恶魔猎手", confidence: 1, x: 0.72, y: 0.34, width: 0.08, height: 0.02 }
      ],
      [
        { ...baseDeck, id: "standard-demon-hunter", name: "自定义 恶魔猎手", format: "标准" },
        { ...baseDeck, id: "wild-demon-hunter", name: "自定义 恶魔猎手", format: "狂野" }
      ]
    );

    expect(inspection).toEqual({
      mode: "casual",
      selectedName: "自定义 恶魔猎手",
      selectedDeck: undefined
    });
  });

  it("accepts a uniquely named Standard deck on the Wild deck screen", () => {
    const taskPriest = { ...baseDeck, id: "task-priest", name: "任务牧", format: "标准" };
    const selected = findScreenSelectedCollectionDeck(
      [
        { text: "狂野对战", confidence: 1, x: 0.32, y: 0.91, width: 0.06, height: 0.02 },
        { text: "任务牧", confidence: 1, x: 0.73, y: 0.34, width: 0.05, height: 0.02 }
      ],
      [taskPriest, { ...baseDeck, id: "other", name: "巨像", format: "狂野" }]
    );

    expect(selected).toBe(taskPriest);
  });

  it("does not guess when the screen text is ambiguous", () => {
    const selected = findScreenSelectedCollectionDeck(
      [
        { text: "偷取牌库", confidence: 1, x: 0.72, y: 0.34, width: 0.06, height: 0.02 }
      ],
      [{ ...baseDeck, id: "standard", format: "标准" }]
    );

    expect(selected).toBeUndefined();
  });
});
