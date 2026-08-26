import { describe, expect, it } from "vitest";
import sampleCardDb from "../fixtures/cards.sample.json";
import { createCardDatabase, type CardDatabase } from "../src/shared/cardDatabase";
import { ArenaDraftEngine } from "../src/shared/arenaDraftEngine";
import type { ArenaRatingTable } from "../src/shared/arenaRatings";
import { parseArenaLogLine, selectCurrentArenaLogText } from "../src/shared/arenaLogParser";

const cardDb = sampleCardDb as CardDatabase;
const teamDraftCardDb = createCardDatabase([
  { dbfId: 2001, name: "传说预览甲", cardId: "JAIL_851", rarity: "LEGENDARY" },
  { dbfId: 2002, name: "传说预览乙", cardId: "TIME_064", rarity: "LEGENDARY" },
  { dbfId: 2003, name: "传说预览丙", cardId: "TIME_EVENT_998", rarity: "LEGENDARY" },
  { dbfId: 3001, name: "普通选牌", cardId: "TEST_001", rarity: "COMMON" }
]);
const realOcrCardDb = createCardDatabase([
  { dbfId: 5001, name: "鱼人吸血鬼", cardId: "TEST_MURLOC", collectible: true },
  { dbfId: 5002, name: "寒冰护体", cardId: "TEST_BARRIER", collectible: true },
  { dbfId: 5003, name: "P1CK-P0K3T扒窃机", cardId: "JAIL_456", collectible: true },
  { dbfId: 5004, name: "摩拉格", cardId: "TEST_MALAG", collectible: true },
  { dbfId: 5005, name: "背叛者高弗雷", cardId: "TEST_GODFREY", collectible: true },
  { dbfId: 5006, name: "探员摩洛克·福尔摩斯", cardId: "TEST_HOLMES", collectible: true },
  { dbfId: 5007, name: "摩洛克·福尔摩斯", cardId: "TEST_HOLMES_DECOY", collectible: true },
  { dbfId: 5008, name: "时光之主诺兹多姆", cardId: "TIME_063", collectible: true },
  { dbfId: 5009, name: "克罗米", cardId: "TIME_103", collectible: true }
]);
const ratings: ArenaRatingTable = {
  source: "test ratings",
  version: 7,
  fetchedAt: "2026-07-10T00:00:00.000Z",
  ratings: {
    Hunter: { TEST_001: 88 },
    Neutral: { TEST_002: 61 }
  },
  firestone: {
    source: "Firestone",
    version: "firestone-v1",
    lastUpdated: "2026-07-10T00:00:00.000Z",
    ratings: {
      TEST_001: {
        includedWinrate: 55.25,
        playedWinrate: 58.5,
        sampleSize: 5000,
        pickRate: 42,
        highWinPickRate: 51,
        highWinThreshold: 6,
        highWinPickRateImpact: 9
      }
    }
  },
  firestoneClasses: {
    hunter: {
      source: "Firestone",
      playerClass: "hunter",
      version: "hunter-v1",
      lastUpdated: "2026-07-10T00:00:00.000Z",
      overallWinrate: 50,
      ratings: {
        TEST_001: {
          includedWinrate: 56.3,
          sampleSize: 5000,
          deckImpact: 6.3
        }
      }
    }
  }
};

describe("arena log parsing", () => {
  it("parses draft mode, hero and selected card lines", () => {
    expect(parseArenaLogLine("D 12:00:00.000 Arena.SetDraftMode - DRAFTING")).toEqual([
      expect.objectContaining({ type: "mode", mode: "drafting" })
    ]);
    expect(parseArenaLogLine("D 12:00:01.000 DraftManager.OnChosen(): hero=HERO_05")).toEqual([
      expect.objectContaining({ type: "hero-selected", cardId: "HERO_05" })
    ]);
    expect(parseArenaLogLine("D 12:00:02.000 Client chooses: [TEST_001]")).toEqual([
      expect.objectContaining({ type: "card-picked", cardId: "TEST_001" })
    ]);
    expect(parseArenaLogLine("D 12:00:03.000 Client chooses: [TIME_009t1]")).toEqual([
      expect.objectContaining({ type: "card-picked", cardId: "TIME_009t1" })
    ]);
  });

  it("does not turn lowercase underscored text into a card id", () => {
    expect(parseArenaLogLine("D 12:00:02.000 Client chooses: [foo_bar]")).toEqual([
      expect.objectContaining({ type: "card-picked", cardName: "foo_bar" })
    ]);
    expect(parseArenaLogLine("D 12:00:02.000 Client chooses: [foo_bar]")[0]).not.toHaveProperty("cardId");
  });

  it("does not count repeated hero selections as drafted cards", () => {
    const engine = new ArenaDraftEngine({ cardDatabase: cardDb, ratings, preferArenaLogPicks: true });

    engine.applyArenaText([
      "D 08:02:58.1840550 SetDraftMode - DRAFTING",
      "D 08:03:12.6175030 Client chooses: 安度因·乌瑞恩 (HERO_09)",
      "D 08:03:15.6153630 Client chooses: 安度因·乌瑞恩 (HERO_09)",
      "D 08:03:16.7659410 Client chooses: 古尔丹 (HERO_07)",
      "D 08:03:18.1847730 DraftManager.OnChosen(): hero=HERO_07",
      "D 08:03:25.9661450 Client chooses: Sample Singleton (TEST_001)"
    ].join("\n"));

    expect(engine.getState()).toMatchObject({
      status: "drafting",
      hero: { cardId: "HERO_07", className: "Warlock" },
      draftCount: 1,
      unresolvedCount: 29,
      deck: [expect.objectContaining({ cardId: "TEST_001", count: 1 })]
    });
  });

  it("recognizes an Arena redraft transition as an active choice state", () => {
    expect(parseArenaLogLine("D 12:00:00.000 Arena.SetDraftMode - REDRAFTING")).toEqual([
      expect.objectContaining({ type: "mode", mode: "redrafting" })
    ]);
  });

  it("parses the new authoritative deck id announced by a redraft", () => {
    expect(parseArenaLogLine("D 16:53:24.100 DraftManager.OnRedraftBegin - Got new redraft deck with ID: 9466340633")).toEqual([
      expect.objectContaining({ type: "deck-id", deckId: "9466340633", source: "redraft" })
    ]);
  });

  it("tracks the main deck id separately from the redraft generation id", () => {
    const engine = new ArenaDraftEngine({ cardDatabase: cardDb, ratings, preferArenaLogPicks: true });
    engine.applyArenaText([
      "D 16:53:24.000 Arena.SetDraftMode - REDRAFTING",
      "D 16:53:24.100 DraftManager.OnRedraftBegin - Got new redraft deck with ID: 9466340633",
      "D 16:53:25.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 9466340632, Hero Card = HERO_05",
      "D 16:53:25.001 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001",
      "D 16:53:26.000 Client chooses: [TEST_002]"
    ].join("\n"));

    expect(engine.getState()).toMatchObject({
      deckId: "9466340632",
      redraftGenerationId: "9466340633"
    });
  });

  it("accepts an exact deck only for the current main Arena deck id", () => {
    const engine = new ArenaDraftEngine({ cardDatabase: cardDb, ratings, preferArenaLogPicks: true });
    engine.applyArenaText([
      "D 16:53:25.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 9466340632, Hero Card = HERO_05",
      "D 16:53:25.001 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001",
      "D 16:53:27.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n"));
    const unknownCards = [
      { name: "Sample Multi", count: 29 },
      { name: "Unknown card 123456", count: 1 }
    ];
    const unresolvedCards = [{ name: "Unresolved Arena cards", count: 30, unresolved: true as const }];
    const exactCards = [{ name: "Sample Multi", count: 30 }];

    expect(engine.applyExactDeck(exactCards, "9466340000")).toBe(false);
    expect(engine.getState()).toMatchObject({ deckId: "9466340632", unresolvedCount: 29 });
    expect(engine.applyExactDeck(unknownCards, "9466340632")).toBe(false);
    expect(engine.getState()).toMatchObject({ deckId: "9466340632", draftCount: 1, unresolvedCount: 29 });
    expect(engine.applyExactDeck(unresolvedCards, "9466340632")).toBe(false);
    expect(engine.getState()).toMatchObject({ deckId: "9466340632", draftCount: 1, unresolvedCount: 29 });
    expect(engine.applyExactDeck(exactCards, "9466340632")).toBe(true);
    expect(engine.getState()).toMatchObject({ deckId: "9466340632", draftCount: 30, unresolvedCount: 0 });
  });

  it("publishes an oversized active snapshot as candidates before matchmaking", () => {
    const engine = new ArenaDraftEngine({ cardDatabase: cardDb, ratings, preferArenaLogPicks: true });
    engine.applyArenaText([
      "D 12:09:34.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 9485426193, Hero Card = HERO_09",
      ...Array.from(
        { length: 31 },
        () => "D 12:09:34.001 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001"
      ),
      "D 12:09:34.999 SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n"));

    const state = engine.getState();
    expect(state).toMatchObject({
      status: "complete",
      deckId: "9485426193",
      deck: [],
      awaitingExactDeck: true
    });
    expect(state.redraftPool?.reduce((total, card) => total + card.count, 0)).toBe(31);
  });

  it("keeps restored Arena cards and accepts screen choices during redrafting", () => {
    const engine = new ArenaDraftEngine({ cardDatabase: cardDb, ratings });

    engine.applyArenaText(`
D 12:00:00.000 DraftManager.OnChoicesAndContents - Draft Deck ID: arena, Hero Card = HERO_06
D 12:00:00.000 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001
D 12:00:00.000 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_002
D 12:00:01.000 Arena.SetDraftMode - REDRAFTING
`);

    expect(engine.getState()).toMatchObject({
      status: "redrafting",
      draftCount: 2,
      unresolvedCount: 30,
      deck: [],
      awaitingExactDeck: true
    });
    expect(engine.getState().redraftPool?.reduce((total, card) => total + card.count, 0)).toBe(2);
    expect(engine.applyScreenChoices(["Sample Singleton", "Sample Pair", "Sample Multi"])).toBe(true);
    expect(engine.getState().currentChoices).toHaveLength(3);
  });

  it("selects only the current draft from a cumulative Arena.log", () => {
    const text = selectCurrentArenaLogText(`
D 11:00:00.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK
D 11:00:01.000 Client chooses: [TEST_001]
D 12:00:00.000 Arena.SetDraftMode - DRAFTING
D 12:00:01.000 Client chooses: [TEST_002]
`);

    expect(text).not.toContain("TEST_001");
    expect(text).toContain("DRAFTING");
    expect(text).toContain("TEST_002");
  });

  it("keeps the current draft contents written before the mode marker", () => {
    const text = selectCurrentArenaLogText(`
D 11:00:00.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 1, Hero Card = HERO_05
D 11:00:00.000 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001
D 11:00:00.000 SetDraftMode - DRAFTING
D 12:00:00.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 2, Hero Card = HERO_05
D 12:00:00.000 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_002
D 12:00:00.000 SetDraftMode - DRAFTING
`);

    expect(text).not.toContain("TEST_001");
    expect(text).toContain("Hero Card = HERO_05");
    expect(text).toContain("TEST_002");
  });

  it("keeps restored deck contents when the latest Arena mode is complete", () => {
    const text = selectCurrentArenaLogText(`
D 17:39:59.6202750 DraftManager.OnChoicesAndContents - Draft Deck ID: 9455810772, Hero Card = HERO_06
D 17:39:59.6202750 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001
D 17:39:59.6202750 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_002
D 17:39:59.6202750 SetDraftMode - DRAFTING
D 17:40:01.0000000 Client chooses: [TEST_003]
D 17:40:02.0000000 SetDraftMode - ACTIVE_DRAFT_DECK
`);

    expect(text).toContain("Hero Card = HERO_06");
    expect(text).toContain("TEST_001");
    expect(text).toContain("TEST_002");
    expect(text).toContain("TEST_003");
    expect(text).toContain("ACTIVE_DRAFT_DECK");
  });

  it("replays a completed redraft with every pick made after the retained snapshot", () => {
    const retainedCards = Array.from(
      { length: 24 },
      (_value, index) => `D 16:53:25.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
    );
    const content = [
      "D 16:53:24.000 Arena.SetDraftMode - REDRAFTING",
      "D 16:53:25.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 2, Hero Card = HERO_05",
      ...retainedCards,
      "D 16:54:01.000 Client chooses: [TEST_002]",
      "D 16:54:02.000 Client chooses: [TEST_002]",
      "D 16:54:03.000 Client chooses: [TEST_003]",
      "D 16:54:04.000 Client chooses: [TEST_001]",
      "D 16:54:05.000 Client chooses: [TEST_003]",
      "D 16:54:06.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n");

    const selected = selectCurrentArenaLogText(content);
    const engine = new ArenaDraftEngine({ cardDatabase: cardDb, ratings, preferArenaLogPicks: true });
    engine.applyArenaText(selected);

    expect(selected).toContain("REDRAFTING");
    expect(engine.getState()).toMatchObject({
      status: "complete",
      draftCount: 29,
      unresolvedCount: 30,
      deck: [],
      awaitingExactDeck: true,
      pendingRedraftChoices: expect.arrayContaining([
        expect.objectContaining({ cardId: "TEST_002" }),
        expect.objectContaining({ cardId: "TEST_003" })
      ])
    });
    expect(engine.getState().picks).toHaveLength(0);
    expect(engine.getState().pendingRedraftChoices).toHaveLength(5);
  });
});

describe("ArenaDraftEngine", () => {
  it("keeps redraft picks when Arena.log arrives one line at a time", () => {
    const engine = new ArenaDraftEngine({ cardDatabase: cardDb, ratings, preferArenaLogPicks: true });
    const lines = [
      "D 16:53:24.000 Arena.SetDraftMode - REDRAFTING",
      "D 16:53:25.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 2, Hero Card = HERO_05",
      ...Array.from(
        { length: 24 },
        (_value, index) => `D 16:53:25.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`
      ),
      "D 16:54:01.000 Client chooses: [TEST_002]",
      "D 16:54:02.000 Client chooses: [TEST_002]",
      "D 16:54:03.000 Client chooses: [TEST_003]",
      "D 16:54:04.000 Client chooses: [TEST_001]",
      "D 16:54:05.000 Client chooses: [TEST_003]",
      "D 16:54:06.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK"
    ];

    for (const line of lines) {
      engine.applyArenaLine(line);
    }

    expect(engine.getState()).toMatchObject({
      status: "complete",
      draftCount: 29,
      unresolvedCount: 30,
      awaitingExactDeck: true
    });
    expect(engine.getState().picks).toHaveLength(0);
    expect(engine.getState().pendingRedraftChoices).toHaveLength(5);
  });

  it("keeps all redraft candidates above thirty until an exact deck resolves the ambiguity", () => {
    const engine = new ArenaDraftEngine({ cardDatabase: cardDb, ratings, preferArenaLogPicks: true });
    engine.applyArenaLine("D 17:15:00.000 Arena.SetDraftMode - REDRAFTING");
    engine.applyArenaLine("D 17:15:01.000 DraftManager.OnChoicesAndContents - Draft Deck ID: 3, Hero Card = HERO_05");
    for (let index = 0; index < 26; index += 1) {
      engine.applyArenaLine(`D 17:15:01.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`);
    }
    for (const [index, cardId] of ["TEST_002", "TEST_002", "TEST_003", "TEST_003", "TEST_002"].entries()) {
      engine.applyArenaLine(`D 17:15:${String(index + 2).padStart(2, "0")}.000 Client chooses: [${cardId}]`);
    }

    expect(engine.getState()).toMatchObject({
      status: "redrafting",
      picks: [],
      awaitingExactDeck: true
    });
    expect(engine.getState().pendingRedraftChoices).toHaveLength(5);
    expect(engine.getState().redraftPool?.reduce((total, card) => total + card.count, 0)).toBe(31);

    engine.applyArenaLine("D 17:16:00.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK");

    expect(engine.getState()).toMatchObject({
      status: "complete",
      draftCount: 30,
      unresolvedCount: 30,
      deck: [],
      awaitingExactDeck: true
    });
    expect(engine.getState().picks).toHaveLength(0);
  });

  it("hydrates the confirmed deck before the first redraft choice when data arrives late", () => {
    const engine = new ArenaDraftEngine({ preferArenaLogPicks: true });
    engine.applyArenaLine("D 17:14:00.000 Arena.SetDraftMode - DRAFTING");
    engine.applyArenaLine("D 17:14:01.000 DraftManager.OnChosen(): hero=HERO_05");
    expect(engine.applyExactDeck([
      { name: "Fallback card name", cardId: "TEST_001", count: 30 }
    ], "arena-main")).toBe(true);

    engine.applyArenaLine("D 17:15:00.000 Arena.SetDraftMode - REDRAFTING");
    engine.setCardDatabase(cardDb);
    engine.setRatings(ratings);

    expect(engine.getState().redraftPool).toEqual([
      expect.objectContaining({
        name: "Sample Singleton",
        cardId: "TEST_001",
        count: 30,
        details: expect.objectContaining({ dbfId: 1001 }),
        pickRate: 42,
        deckImpact: 6.3
      })
    ]);
  });

  it("keeps ratings on the confirmed thirty cards while three redraft choices are pending", () => {
    const engine = new ArenaDraftEngine({ cardDatabase: cardDb, ratings, preferArenaLogPicks: true });
    engine.applyArenaLine("D 17:14:00.000 Arena.SetDraftMode - DRAFTING");
    engine.applyArenaLine("D 17:14:01.000 DraftManager.OnChosen(): hero=HERO_05");
    expect(engine.applyExactDeck([
      { name: "Sample Singleton", cardId: "TEST_001", count: 30 }
    ])).toBe(true);

    engine.applyArenaLine("D 17:15:00.000 Arena.SetDraftMode - REDRAFTING");
    for (let index = 0; index < 3; index += 1) {
      engine.applyArenaLine(`D 17:15:0${index + 1}.000 Client chooses: [TEST_002]`);
    }

    const state = engine.getState();
    expect(state).toMatchObject({
      status: "redrafting",
      awaitingExactDeck: true,
      deck: [expect.objectContaining({ cardId: "TEST_001", count: 30 })]
    });
    expect(state.redraftPool?.reduce((total, card) => total + card.count, 0)).toBe(33);
    expect(state.redraftPool).toEqual(expect.arrayContaining([
      expect.objectContaining({
        cardId: "TEST_001",
        count: 30,
        pickRate: 42,
        deckImpact: 6.3
      })
    ]));
  });

  it("hydrates confirmed redraft cards when the card database and ratings arrive later", () => {
    const engine = new ArenaDraftEngine({ preferArenaLogPicks: true });
    engine.applyArenaLine("D 17:14:00.000 Arena.SetDraftMode - DRAFTING");
    engine.applyArenaLine("D 17:14:01.000 DraftManager.OnChosen(): hero=HERO_05");
    expect(engine.applyExactDeck([
      { name: "Fallback card name", cardId: "TEST_001", count: 30 }
    ])).toBe(true);

    engine.applyArenaLine("D 17:15:00.000 Arena.SetDraftMode - REDRAFTING");
    for (let index = 0; index < 3; index += 1) {
      engine.applyArenaLine(`D 17:15:0${index + 1}.000 Client chooses: [TEST_002]`);
    }
    engine.setCardDatabase(cardDb);
    expect(engine.getState().redraftPool).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "Sample Singleton",
        cardId: "TEST_001",
        count: 30,
        details: expect.objectContaining({ dbfId: 1001 })
      })
    ]));

    engine.setRatings(ratings);

    const state = engine.getState();
    expect(state.redraftPool?.reduce((total, card) => total + card.count, 0)).toBe(33);
    expect(state.redraftPool).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "Sample Singleton",
        cardId: "TEST_001",
        count: 30,
        details: expect.objectContaining({ dbfId: 1001 }),
        pickRate: 42,
        deckImpact: 6.3
      })
    ]));
  });

  it("preserves the last exact deck and keeps redraft choices pending until the next exact deck arrives", () => {
    const engine = new ArenaDraftEngine({ cardDatabase: cardDb, ratings, preferArenaLogPicks: true });
    const previousExactDeck = [
      { name: "Sample Singleton", cardId: "TEST_001", count: 28 },
      { name: "Sample Pair", cardId: "TEST_002", count: 2 }
    ];
    const nextExactDeck = [
      { name: "Sample Singleton", cardId: "TEST_001", count: 25 },
      { name: "Sample Pair", cardId: "TEST_002", count: 2 },
      { name: "Sample Multi", cardId: "TEST_003", count: 3 }
    ];

    expect(engine.applyExactDeck(previousExactDeck, "arena-main")).toBe(true);
    engine.applyArenaLine("D 17:14:59.000 DraftManager.OnChoicesAndContents - Draft Deck ID: arena-main, Hero Card = HERO_05");
    for (let index = 0; index < 25; index += 1) {
      engine.applyArenaLine(`D 17:14:59.${String(index).padStart(3, "0")} DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001`);
    }
    engine.applyArenaLine("D 17:15:00.000 Arena.SetDraftMode - REDRAFTING");
    for (const [index, cardId] of ["TEST_002", "TEST_003", "TEST_003", "TEST_002", "TEST_003"].entries()) {
      engine.applyArenaLine(`D 17:15:${String(index + 2).padStart(2, "0")}.000 Client chooses: [${cardId}]`);
    }

    expect(engine.getState()).toMatchObject({
      status: "redrafting",
      awaitingExactDeck: true,
      deck: expect.arrayContaining(previousExactDeck.map((card) => expect.objectContaining(card))),
      pendingRedraftChoices: [
        expect.objectContaining({ cardId: "TEST_002" }),
        expect.objectContaining({ cardId: "TEST_003" }),
        expect.objectContaining({ cardId: "TEST_003" }),
        expect.objectContaining({ cardId: "TEST_002" }),
        expect.objectContaining({ cardId: "TEST_003" })
      ]
    });
    expect(engine.getState().redraftPool?.reduce((total, card) => total + card.count, 0)).toBe(35);
    expect(engine.getState().picks).toHaveLength(30);

    engine.applyArenaLine("D 17:16:00.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK");

    expect(engine.getState()).toMatchObject({
      status: "complete",
      awaitingExactDeck: true,
      deck: expect.arrayContaining(previousExactDeck.map((card) => expect.objectContaining(card)))
    });
    expect(engine.getState().redraftPool?.reduce((total, card) => total + card.count, 0)).toBe(35);

    expect(engine.applyExactDeck(nextExactDeck, "arena-main")).toBe(true);
    expect(engine.getState()).toMatchObject({
      status: "complete",
      awaitingExactDeck: false,
      deck: expect.arrayContaining(nextExactDeck.map((card) => expect.objectContaining(card))),
      pendingRedraftChoices: [],
      redraftPool: undefined
    });
    expect(engine.getState().picks).toHaveLength(30);
  });

  it("keeps an exact Arena deck when the same run repeats a partial lobby snapshot", () => {
    const engine = new ArenaDraftEngine({ cardDatabase: cardDb, ratings, preferArenaLogPicks: true });
    const exactDeck = [
      { name: "Sample Singleton", cardId: "TEST_001", count: 28 },
      { name: "Sample Pair", cardId: "TEST_002", count: 2 }
    ];

    expect(engine.applyExactDeck(exactDeck, "same-run")).toBe(true);
    engine.applyArenaText([
      "D 15:59:27.000 DraftManager.OnChoicesAndContents - Draft Deck ID: same-run, Hero Card = HERO_05",
      "D 15:59:27.001 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001",
      "D 15:59:27.002 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_002",
      "D 15:59:27.003 SetDraftMode - ACTIVE_DRAFT_DECK"
    ].join("\n"));

    expect(engine.getState()).toMatchObject({ status: "complete", unresolvedCount: 0 });
    expect(engine.getState().deck).toEqual(expect.arrayContaining(
      exactDeck.map((card) => expect.objectContaining(card))
    ));
  });

  it("replays the real 35-card Underground Arena boundary without trusting repeated Arena snapshots", () => {
    const engine = new ArenaDraftEngine({ preferArenaLogPicks: true });
    const retainedCardIds = [
      "END_006", "BT_354", "EDR_842", "DMF_226", "JAIL_891", "REV_834",
      "ETC_420", "CORE_EX1_096", "REV_943", "END_008", "TIME_441", "ETC_540",
      "CORE_BT_035", "CORE_BT_321", "ETC_394", "END_005", "TOY_642", "TIME_444",
      "TOY_028", "CORE_BT_480", "CORE_BT_416", "TOY_643", "JAIL_730", "ETC_411",
      "CORE_EX1_005", "JAM_018", "JAIL_732"
    ];
    const previousExactDeck = retainedCardIds.map((cardId) => ({
      name: cardId,
      cardId,
      count: ["CORE_EX1_096", "ETC_411", "JAM_018"].includes(cardId) ? 2 : 1
    }));
    const redraftChoices = [
      "CORE_BT_321",
      "CORE_YOP_001",
      "TOY_642",
      "REV_957",
      "END_007"
    ];

    expect(previousExactDeck.reduce((total, card) => total + card.count, 0)).toBe(30);
    expect(engine.applyExactDeck(previousExactDeck, "9476239109")).toBe(true);
    engine.applyArenaLine("D 16:01:39.7205580 SetDraftMode - REDRAFTING");
    engine.applyArenaLine("D 16:01:44.0122450 DraftManager.OnRedraftBegin - Got new redraft deck with ID: 9476239110");
    engine.applyArenaLine("D 16:01:44.2384040 DraftManager.OnChoicesAndContents - Draft Deck ID: 9476239109, Hero Card = HERO_10");
    for (const cardId of retainedCardIds) {
      engine.applyArenaLine(`D 16:01:44.2384040 DraftManager.OnChoicesAndContents - Draft deck contains card ${cardId}`);
    }
    for (const [index, cardId] of redraftChoices.entries()) {
      const line = `D 16:02:0${index}.0000000 Client chooses: ${cardId} (${cardId})`;
      engine.applyArenaLine(line);
      if (index === redraftChoices.length - 1) {
        engine.applyArenaLine(line);
      }
    }

    expect(engine.getState()).toMatchObject({
      status: "redrafting",
      awaitingExactDeck: true,
      pendingRedraftChoices: redraftChoices.map((cardId) => expect.objectContaining({ cardId }))
    });
    expect(engine.getState().deck.reduce((total, card) => total + card.count, 0)).toBe(30);
    expect(engine.getState().redraftPool?.reduce((total, card) => total + card.count, 0)).toBe(35);

    engine.applyArenaLine("D 16:02:08.2926720 SetDraftMode - ACTIVE_DRAFT_DECK");
    engine.applyArenaLine("D 16:10:52.7995410 DraftManager.OnChoicesAndContents - Draft Deck ID: 9476239109, Hero Card = HERO_10");
    for (const cardId of [...retainedCardIds.slice(0, 25), ...redraftChoices]) {
      engine.applyArenaLine(`D 16:10:52.7995410 DraftManager.OnChoicesAndContents - Draft deck contains card ${cardId}`);
    }
    engine.applyArenaLine("D 16:10:52.7995410 SetDraftMode - ACTIVE_DRAFT_DECK");

    expect(engine.getState()).toMatchObject({
      status: "complete",
      awaitingExactDeck: true,
      pendingRedraftChoices: redraftChoices.map((cardId) => expect.objectContaining({ cardId }))
    });
    expect(engine.getState().deck.reduce((total, card) => total + card.count, 0)).toBe(30);
    expect(engine.getState().redraftPool?.reduce((total, card) => total + card.count, 0)).toBe(35);

    const nextExactDeck = [
      ...previousExactDeck.slice(3),
      ...redraftChoices.slice(0, 3).map((cardId) => ({ name: cardId, cardId, count: 1 }))
    ];
    expect(nextExactDeck.reduce((total, card) => total + card.count, 0)).toBe(30);
    expect(engine.applyExactDeck(nextExactDeck, "9476239109")).toBe(true);
    expect(engine.getState()).toMatchObject({
      awaitingExactDeck: false,
      pendingRedraftChoices: [],
      redraftPool: undefined
    });
    expect(engine.getState().deck.some((card) => card.cardId === "REV_957")).toBe(false);
    expect(engine.getState().deck.some((card) => card.cardId === "END_007")).toBe(false);
  });

  it("counts only the final legendary preview as a three-card team before normal picks", () => {
    const engine = new ArenaDraftEngine({ cardDatabase: teamDraftCardDb, preferArenaLogPicks: true });
    engine.applyArenaLine("D 12:00:00.000 SetDraftMode - DRAFTING");
    expect(engine.applyScreenChoices(["传说预览甲", "传说预览乙", "传说预览丙"])).toBe(true);

    engine.applyArenaLine("D 12:00:01.000 Client chooses: 传说预览甲 (JAIL_851)");
    engine.applyArenaLine("D 12:00:02.000 Client chooses: 传说预览乙 (TIME_064)");
    engine.applyArenaLine("D 12:00:03.000 Client chooses: 传说预览甲 (JAIL_851)");

    expect(engine.getState().draftCount).toBe(0);
    expect(engine.getState().currentChoices).toHaveLength(3);

    engine.applyArenaLine("D 12:00:04.000 Client chooses: 普通选牌 (TEST_001)");
    expect(engine.getState().draftCount).toBe(4);
    expect(engine.getState().deck).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: "JAIL_851", count: 1 }),
      expect.objectContaining({ cardId: "TEST_001", count: 1 })
    ]));
    expect(engine.getState()).toMatchObject({ unresolvedCount: 28 });

    for (let slot = 0; slot < 25; slot += 1) {
      engine.applyArenaLine(`D 12:01:${String(slot).padStart(2, "0")}.000 Client chooses: 普通选牌 (TEST_001)`);
    }
    expect(engine.getState()).toMatchObject({ status: "drafting", draftCount: 29 });
    expect(engine.getState().deck.reduce((total, card) => total + card.count, 0)).toBe(27);
    expect(engine.getState().unresolvedCount).toBe(3);

    engine.applyArenaLine("D 12:02:00.000 Client chooses: 普通选牌 (TEST_001)");
    expect(engine.getState()).toMatchObject({ status: "complete", draftCount: 30 });
    expect(engine.getState().deck.reduce((total, card) => total + card.count, 0)).toBe(28);
    expect(engine.getState().unresolvedCount).toBe(2);
  });

  it("scores the live choices and builds the arena deck from selected cards", () => {
    const engine = new ArenaDraftEngine({ cardDatabase: cardDb, ratings, preferArenaLogPicks: true });

    engine.applyArenaText(`
D 12:00:00.000 Arena.SetDraftMode - DRAFTING
D 12:00:01.000 DraftManager.OnChosen(): hero=HERO_05
`);
    engine.applyPowerText(`
D 12:00:02.000 GameState.DebugPrintEntityChoices() - id=1 Player=Local TaskList=4 ChoiceType=GENERAL CountMin=1 CountMax=1
D 12:00:02.000 GameState.DebugPrintEntityChoices() -   Entities[0]=[entityName=Sample Singleton id=101 zone=SETASIDE zonePos=0 cardId=TEST_001 player=1]
D 12:00:02.000 GameState.DebugPrintEntityChoices() -   Entities[1]=[entityName=Sample Pair id=102 zone=SETASIDE zonePos=0 cardId=TEST_002 player=1]
D 12:00:02.000 GameState.DebugPrintEntityChoices() -   Entities[2]=[entityName=Sample Multi id=103 zone=SETASIDE zonePos=0 cardId=TEST_003 player=1]
D 12:00:02.000 ChoiceCardMgr.WaitThenShowChoices() - id=1 BEGIN
`);

    expect(engine.getState().currentChoices).toEqual([
      expect.objectContaining({
        cardId: "TEST_001",
        score: 88,
        quality: { tier: "c", label: "一般" },
        rating: {
          hearthArena: 88,
          pickRate: 42,
          highWinPickRate: 51,
          highWinThreshold: 6,
          highWinPickRateImpact: 9,
          deckImpact: 6.3,
          firestone: {
            includedWinrate: 55.25,
            playedWinrate: 58.5,
            sampleSize: 5000,
            pickRate: 42,
            highWinPickRate: 51,
            highWinThreshold: 6,
            highWinPickRateImpact: 9
          }
        },
        name: "Sample Singleton"
      }),
      expect.objectContaining({ cardId: "TEST_002", score: 61, quality: { tier: "d", label: "偏弱" }, name: "Sample Pair" }),
      expect.objectContaining({ cardId: "TEST_003", quality: { tier: "unknown", label: "暂无评分" }, name: "Sample Multi" })
    ]);

    expect(engine.applyScreenChoices(["Sample Multi", "Sample Pair", "Sample Singleton"])).toBe(false);
    expect(engine.getState().currentChoices.map((choice) => choice.cardId)).toEqual([
      "TEST_001",
      "TEST_002",
      "TEST_003"
    ]);

    engine.applyArenaLine("D 12:00:03.000 Client chooses: [TEST_001]");
    engine.applyArenaLine("D 12:00:04.000 Client chooses: [TEST_002]");

    const state = engine.getState();
    expect(state.status).toBe("drafting");
    expect(state.draftCount).toBe(2);
    expect(state.deck).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: "TEST_001", name: "Sample Singleton", count: 1, pickRate: 42, deckImpact: 6.3 }),
      expect.objectContaining({ cardId: "TEST_002", name: "Sample Pair", count: 1 })
    ]));
    expect(state.picks[0]).toMatchObject({ slot: 1, chosen: { score: 88 } });

    engine.applyArenaLine("D 12:00:05.000 Arena.SetDraftMode - ACTIVE_DRAFT_DECK");
    engine.markPlaying();
    expect(engine.getState().deck.find((card) => card.cardId === "TEST_001")).toMatchObject({
      pickRate: 42,
      deckImpact: 6.3
    });
  });

  it("maps the HERO_04bh Arena hero to Paladin and scores its live choices", () => {
    const paladinCardDb = createCardDatabase([
      { dbfId: 700, name: "候选一", cardId: "MIS_700", collectible: true },
      { dbfId: 918, name: "候选二", cardId: "MIS_918", collectible: true },
      { dbfId: 848, name: "候选三", cardId: "UNG_848", collectible: true }
    ]);
    const paladinRatings: ArenaRatingTable = {
      source: "test ratings",
      version: 1,
      fetchedAt: "2026-07-24T00:00:00.000Z",
      ratings: {
        Paladin: {
          MIS_700: 70,
          MIS_918: 80,
          UNG_848: 90
        }
      },
      firestoneClasses: {
        paladin: {
          source: "Firestone",
          playerClass: "paladin",
          version: "paladin-test",
          lastUpdated: "2026-07-24T00:00:00.000Z",
          overallWinrate: 50,
          ratings: {
            MIS_700: { includedWinrate: 51, sampleSize: 100, deckImpact: 1 },
            MIS_918: { includedWinrate: 52, sampleSize: 100, deckImpact: 2 },
            UNG_848: { includedWinrate: 53, sampleSize: 100, deckImpact: 3 }
          }
        }
      }
    };
    const engine = new ArenaDraftEngine({
      cardDatabase: paladinCardDb,
      ratings: paladinRatings,
      preferArenaLogPicks: true
    });

    engine.applyArenaText([
      "D 12:00:00.000 Arena.SetDraftMode - DRAFTING",
      "D 12:00:01.000 DraftManager.OnChosen(): hero=HERO_04bh"
    ].join("\n"));
    engine.applyPowerText([
      "D 12:00:02.000 GameState.DebugPrintEntityChoices() - id=1 Player=Local TaskList=4 ChoiceType=GENERAL CountMin=1 CountMax=1",
      "D 12:00:02.000 GameState.DebugPrintEntityChoices() -   Entities[0]=[entityName=候选一 id=101 zone=SETASIDE zonePos=0 cardId=MIS_700 player=1]",
      "D 12:00:02.000 GameState.DebugPrintEntityChoices() -   Entities[1]=[entityName=候选二 id=102 zone=SETASIDE zonePos=0 cardId=MIS_918 player=1]",
      "D 12:00:02.000 GameState.DebugPrintEntityChoices() -   Entities[2]=[entityName=候选三 id=103 zone=SETASIDE zonePos=0 cardId=UNG_848 player=1]",
      "D 12:00:02.000 ChoiceCardMgr.WaitThenShowChoices() - id=1 BEGIN"
    ].join("\n"));

    expect(engine.getState()).toMatchObject({
      hero: { cardId: "HERO_04bh", className: "Paladin" },
      currentChoices: [
        { cardId: "MIS_700", score: 70, rating: { hearthArena: 70, deckImpact: 1 } },
        { cardId: "MIS_918", score: 80, rating: { hearthArena: 80, deckImpact: 2 } },
        { cardId: "UNG_848", score: 90, rating: { hearthArena: 90, deckImpact: 3 } }
      ]
    });
  });

  it("restores draft contents that Hearthstone writes before the drafting mode marker", () => {
    const engine = new ArenaDraftEngine({ cardDatabase: cardDb, ratings, preferArenaLogPicks: true });

    engine.applyArenaText(`
D 15:58:16.7116490 DraftManager.OnChoicesAndContents - Draft Deck ID: 9455810772, Hero Card = HERO_05
D 15:58:16.7116490 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001
D 15:58:16.7116490 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_002
D 15:58:16.7116490 SetDraftMode - DRAFTING
D 16:51:38.4065880 Client chooses: [TEST_003]
`);

    const state = engine.getState();
    expect(state.status).toBe("drafting");
    expect(state.draftCount).toBe(3);
    expect(state.deck).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: "TEST_001", name: "Sample Singleton", count: 1 }),
      expect.objectContaining({ cardId: "TEST_002", name: "Sample Pair", count: 1 }),
      expect.objectContaining({ cardId: "TEST_003", name: "Sample Multi", count: 1 })
    ]));
  });

  it("restores completed Arena contents without a drafting marker", () => {
    const engine = new ArenaDraftEngine({ cardDatabase: cardDb, ratings, preferArenaLogPicks: true });

    engine.applyArenaText(`
D 17:39:59.6202750 DraftManager.OnChoicesAndContents - Draft Deck ID: 9455810772, Hero Card = HERO_06
D 17:39:59.6202750 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_001
D 17:39:59.6202750 DraftManager.OnChoicesAndContents - Draft deck contains card TEST_002
D 17:39:59.6202750 SetDraftMode - ACTIVE_DRAFT_DECK
`);

    const state = engine.getState();
    expect(state.status).toBe("complete");
    expect(state.hero).toEqual(expect.objectContaining({ cardId: "HERO_06", className: "Druid" }));
    expect(state.draftCount).toBe(2);
    expect(state.unresolvedCount).toBe(28);
    expect(state.deck).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: "TEST_001", name: "Sample Singleton", count: 1 }),
      expect.objectContaining({ cardId: "TEST_002", name: "Sample Pair", count: 1 })
    ]));
  });

  it("accepts Power.log choices as the fallback when Arena.log picks are unavailable", () => {
    const engine = new ArenaDraftEngine({ cardDatabase: cardDb, ratings });
    engine.applyArenaLine("D 12:00:00.000 Arena.SetDraftMode - DRAFTING");
    engine.applyPowerText(`
D 12:00:01.000 GameState.DebugPrintEntityChoices() - id=2 Player=Local TaskList=5 ChoiceType=GENERAL CountMin=1 CountMax=1
D 12:00:01.000 GameState.DebugPrintEntityChoices() -   Entities[0]=[entityName=Sample Pair id=201 zone=SETASIDE zonePos=0 cardId=TEST_002 player=1]
D 12:00:01.000 GameState.DebugPrintEntityChoices() -   Entities[1]=[entityName=Sample Multi id=202 zone=SETASIDE zonePos=0 cardId=TEST_003 player=1]
D 12:00:01.000 ChoiceCardMgr.WaitThenShowChoices() - id=2 BEGIN
D 12:00:02.000 GameState.SendChoices() - id=2 ChoiceType=GENERAL
D 12:00:02.000 GameState.SendChoices() -   m_chosenEntities[0]=[entityName=Sample Pair id=201 zone=SETASIDE zonePos=0 cardId=TEST_002 player=1]
`);

    expect(engine.getState().deck).toEqual([
      expect.objectContaining({ cardId: "TEST_002", name: "Sample Pair", count: 1 })
    ]);
  });

  it("scores exactly three recognized arena cards from the current game window", () => {
    const engine = new ArenaDraftEngine({ cardDatabase: cardDb, ratings });
    engine.applyArenaText(`
D 12:00:00.000 Arena.SetDraftMode - DRAFTING
D 12:00:00.001 DraftManager.OnChosen(): hero=HERO_05
`);

    expect(engine.applyScreenChoices(["Sample Multi", "Sample Singleton", "Sample Pair"])).toBe(true);
    expect(engine.getState().currentChoices).toEqual([
      expect.objectContaining({ cardId: "TEST_003", name: "Sample Multi" }),
      expect.objectContaining({ cardId: "TEST_001", name: "Sample Singleton", score: 88 }),
      expect.objectContaining({ cardId: "TEST_002", name: "Sample Pair", score: 61 })
    ]);
    expect(engine.applyScreenChoices(["Sample Pair", "Sample Pair", "Sample Multi"])).toBe(false);
  });

  it("uses the rated card when OCR matches duplicate card names", () => {
    const duplicateNameCardDb = createCardDatabase([
      { dbfId: 4001, name: "恐狼前锋", cardId: "EX1_162", collectible: true },
      { dbfId: 4002, name: "恐狼前锋", cardId: "Story_09_DireWolfAlphaPuzzle" },
      { dbfId: 4003, name: "频率振荡机", cardId: "ETC_106", collectible: true },
      { dbfId: 4004, name: "宝藏经销商", cardId: "TOY_518", collectible: true },
      { dbfId: 4005, name: "审判", cardId: "LOE_027", collectible: true },
      { dbfId: 4006, name: "审判", cardId: "JAIL_326", collectible: true }
    ]);
    const duplicateNameRatings: ArenaRatingTable = {
      source: "test ratings",
      version: 1,
      fetchedAt: "2026-07-23T00:00:00.000Z",
      ratings: { Warlock: { EX1_162: 56, ETC_106: 61, TOY_518: 44, JAIL_326: 70 } },
      firestone: {
        source: "Firestone",
        version: "test",
        lastUpdated: "2026-07-23T00:00:00.000Z",
        ratings: { EX1_162: { pickRate: 11.08 }, JAIL_326: { pickRate: 28.5 } }
      }
    };
    const engine = new ArenaDraftEngine({ cardDatabase: duplicateNameCardDb, ratings: duplicateNameRatings });
    engine.applyArenaText([
      "D 08:02:58.1840550 SetDraftMode - DRAFTING",
      "D 08:03:18.1847730 DraftManager.OnChosen(): hero=HERO_07"
    ].join("\n"));

    expect(engine.applyScreenChoices(["恐狼前锋", "审判", "频率振荡机"])).toBe(true);
    expect(engine.getState().currentChoices[0]).toMatchObject({
      cardId: "EX1_162",
      score: 56,
      rating: { pickRate: 11.08 }
    });
    expect(engine.getState().currentChoices[1]).toMatchObject({
      cardId: "JAIL_326",
      score: 70,
      rating: { pickRate: 28.5 }
    });
  });

  it("accepts one-character OCR mistakes when the card name match is unambiguous", () => {
    const engine = new ArenaDraftEngine({ cardDatabase: cardDb, ratings });
    engine.applyArenaText(`
D 12:00:00.000 Arena.SetDraftMode - DRAFTING
D 12:00:00.001 DraftManager.OnChosen(): hero=HERO_05
`);

    expect(engine.applyScreenChoices(["Sample Multi", "Sample Singletom", "Sample Pair"])).toBe(true);
    expect(engine.getState().currentChoices).toEqual([
      expect.objectContaining({ cardId: "TEST_003", name: "Sample Multi", screenSlot: 0 }),
      expect.objectContaining({ cardId: "TEST_002", name: "Sample Pair", screenSlot: 2 })
    ]);

    expect(engine.applyScreenChoices(["Sample Multi", "Sample Singletom", "Sample Pair"])).toBe(true);
    expect(engine.getState().currentChoices).toEqual([
      expect.objectContaining({ cardId: "TEST_003", name: "Sample Multi" }),
      expect.objectContaining({ cardId: "TEST_001", name: "Sample Singleton" }),
      expect.objectContaining({ cardId: "TEST_002", name: "Sample Pair" })
    ]);
  });

  it("recovers the noisy long card names observed in real Arena screenshots", () => {
    for (const noisyName of ["PICK-POK3T改意瓶", "PICK-POKST改意瓶"]) {
      const normalDraft = new ArenaDraftEngine({ cardDatabase: realOcrCardDb });
      normalDraft.applyArenaLine("D 12:00:00.000 Arena.SetDraftMode - DRAFTING");

      expect(normalDraft.applyScreenChoices(["鱼人吸血鬼", "寒冰护体", noisyName])).toBe(true);
      expect(normalDraft.getState().currentChoices).toEqual([
        expect.objectContaining({ cardId: "TEST_MURLOC", screenSlot: 0 }),
        expect.objectContaining({ cardId: "TEST_BARRIER", screenSlot: 1 })
      ]);
      expect(normalDraft.applyScreenChoices(["鱼人吸血鬼", "寒冰护体", noisyName])).toBe(true);
      expect(normalDraft.getState().currentChoices).toEqual([
        expect.objectContaining({ cardId: "TEST_MURLOC", name: "鱼人吸血鬼" }),
        expect.objectContaining({ cardId: "TEST_BARRIER", name: "寒冰护体" }),
        expect.objectContaining({ cardId: "JAIL_456", name: "P1CK-P0K3T扒窃机" })
      ]);
    }

    const legendaryDraft = new ArenaDraftEngine({ cardDatabase: realOcrCardDb });
    legendaryDraft.applyArenaLine("D 12:00:00.000 Arena.SetDraftMode - DRAFTING");

    expect(legendaryDraft.applyScreenChoices(["摩拉格", "背叛者高弗雷", "潔员摩洛免。福尔李斯"])).toBe(true);
    expect(legendaryDraft.getState().currentChoices).toHaveLength(2);
    expect(legendaryDraft.applyScreenChoices(["摩拉格", "背叛者高弗雷", "潔员摩洛免。福尔李斯"])).toBe(true);
    expect(legendaryDraft.getState().currentChoices[2]).toMatchObject({
      cardId: "TEST_HOLMES",
      name: "探员摩洛克·福尔摩斯"
    });
  });

  it("matches all three legendary-team titles from the reported screenshot and attaches statistics", () => {
    const screenshotRatings: ArenaRatingTable = {
      source: "test ratings",
      version: 1,
      fetchedAt: "2026-07-28T00:00:00.000Z",
      ratings: { Neutral: {} },
      firestone: {
        source: "Firestone",
        version: "screenshot",
        lastUpdated: "2026-07-28T00:00:00.000Z",
        ratings: {
          TIME_063: { pickRate: 1.14, includedWinrate: 41.97 },
          TEST_MALAG: { pickRate: 78.91, includedWinrate: 51.35 },
          TIME_103: { pickRate: 0.91, includedWinrate: 46.76 }
        }
      }
    };
    const engine = new ArenaDraftEngine({ cardDatabase: realOcrCardDb, ratings: screenshotRatings });
    engine.applyArenaLine("D 12:00:00.000 Arena.SetDraftMode - DRAFTING");

    expect(engine.applyScreenChoices(["时光之主诺的墜總", "摩拉格", "克罗米"])).toBe(true);
    expect(engine.getState().currentChoices).toHaveLength(2);
    expect(engine.applyScreenChoices(["时光之主诺的墜總", "摩拉格", "克罗米"])).toBe(true);
    expect(engine.getState().currentChoices).toEqual([
      expect.objectContaining({
        cardId: "TIME_063",
        name: "时光之主诺兹多姆",
        rating: expect.objectContaining({ pickRate: 1.14, firestone: expect.objectContaining({ includedWinrate: 41.97 }) })
      }),
      expect.objectContaining({
        cardId: "TEST_MALAG",
        name: "摩拉格",
        rating: expect.objectContaining({ pickRate: 78.91, firestone: expect.objectContaining({ includedWinrate: 51.35 }) })
      }),
      expect.objectContaining({
        cardId: "TIME_103",
        name: "克罗米",
        rating: expect.objectContaining({ pickRate: 0.91, firestone: expect.objectContaining({ includedWinrate: 46.76 }) })
      })
    ]);
  });

  it("repairs legendary-team card ids when Firestone ratings arrive after the first OCR frame", () => {
    const legendaryTeamCardDb = createCardDatabase([
      { dbfId: 6101, name: "万能钥匙", cardId: "LEGACY_JAIL_319", collectible: true, type: "SPELL" },
      { dbfId: 6102, name: "万能钥匙", cardId: "JAIL_319", collectible: true, type: "SPELL" },
      { dbfId: 6103, name: "融合独奏团", cardId: "LEGACY_ETC_409", collectible: true, type: "MINION" },
      { dbfId: 6104, name: "融合独奏团", cardId: "ETC_409", collectible: true, type: "MINION" },
      { dbfId: 6105, name: "巅峰无限", cardId: "LEGACY_ETC_206", collectible: true, type: "SPELL" },
      { dbfId: 6106, name: "巅峰无限", cardId: "ETC_206", collectible: true, type: "SPELL" }
    ]);
    const delayedRatings: ArenaRatingTable = {
      source: "test ratings",
      version: 1,
      fetchedAt: "2026-08-09T16:54:00.000Z",
      ratings: { Mage: {} },
      firestone: {
        source: "Firestone",
        version: "reported-screenshot",
        lastUpdated: "2026-08-09T16:54:00.000Z",
        ratings: {
          JAIL_319: { pickRate: 25.8 },
          ETC_409: { pickRate: 6.3 },
          ETC_206: { pickRate: 78.68 }
        }
      }
    };
    const engine = new ArenaDraftEngine({ cardDatabase: legendaryTeamCardDb });
    engine.applyArenaText([
      "D 16:54:07.000 SetDraftMode - DRAFTING",
      "D 16:54:10.000 DraftManager.OnChosen(): hero=HERO_08"
    ].join("\n"));

    expect(engine.applyScreenChoices(["万能钥匙", "融合独奏团", "巅峄无限"])).toBe(true);
    engine.setRatings(delayedRatings);
    expect(engine.applyScreenChoices(["万能钥匙", "融合独奏团", "巅峄无限"])).toBe(true);

    expect(engine.getState().currentChoices).toEqual([
      expect.objectContaining({ cardId: "JAIL_319", rating: expect.objectContaining({ pickRate: 25.8 }) }),
      expect.objectContaining({ cardId: "ETC_409", rating: expect.objectContaining({ pickRate: 6.3 }) }),
      expect.objectContaining({ cardId: "ETC_206", rating: expect.objectContaining({ pickRate: 78.68 }) })
    ]);
  });

  it("keeps the original card id unrated when delayed ratings contain multiple same-name candidates", () => {
    const duplicateVersionCardDb = createCardDatabase([
      { dbfId: 6201, name: "同名版本牌", cardId: "VERSION_ORIGINAL", collectible: true },
      { dbfId: 6202, name: "同名版本牌", cardId: "VERSION_RATED_A", collectible: true },
      { dbfId: 6203, name: "同名版本牌", cardId: "VERSION_RATED_B", collectible: true },
      { dbfId: 6204, name: "测试辅牌甲", cardId: "VERSION_FILLER_A", collectible: true },
      { dbfId: 6205, name: "测试辅牌乙", cardId: "VERSION_FILLER_B", collectible: true }
    ]);
    const delayedRatings: ArenaRatingTable = {
      source: "test ratings",
      version: 1,
      fetchedAt: "2026-08-11T00:00:00.000Z",
      ratings: {},
      firestone: {
        source: "Firestone",
        version: "multiple-same-name-candidates",
        lastUpdated: "2026-08-11T00:00:00.000Z",
        ratings: {
          VERSION_RATED_A: { pickRate: 30 },
          VERSION_RATED_B: { pickRate: 70 }
        }
      }
    };
    const engine = new ArenaDraftEngine({ cardDatabase: duplicateVersionCardDb });
    engine.applyArenaLine("D 12:00:00.000 Arena.SetDraftMode - DRAFTING");

    expect(engine.applyScreenChoices(["同名版本牌", "测试辅牌甲", "测试辅牌乙"])).toBe(true);
    expect(engine.getState().currentChoices[0]?.cardId).toBe("VERSION_ORIGINAL");

    engine.setRatings(delayedRatings);

    expect(engine.getState().currentChoices[0]?.cardId).toBe("VERSION_ORIGINAL");
    expect(engine.getState().currentChoices[0]?.rating).toBeUndefined();
  });

  it("replaces an unrated card id when delayed ratings contain one same-name candidate", () => {
    const duplicateVersionCardDb = createCardDatabase([
      { dbfId: 6301, name: "唯一版本牌", cardId: "UNIQUE_ORIGINAL", collectible: true },
      { dbfId: 6302, name: "唯一版本牌", cardId: "UNIQUE_RATED", collectible: true },
      { dbfId: 6303, name: "测试辅牌甲", cardId: "UNIQUE_FILLER_A", collectible: true },
      { dbfId: 6304, name: "测试辅牌乙", cardId: "UNIQUE_FILLER_B", collectible: true }
    ]);
    const delayedRatings: ArenaRatingTable = {
      source: "test ratings",
      version: 1,
      fetchedAt: "2026-08-11T00:00:00.000Z",
      ratings: {},
      firestone: {
        source: "Firestone",
        version: "one-same-name-candidate",
        lastUpdated: "2026-08-11T00:00:00.000Z",
        ratings: { UNIQUE_RATED: { pickRate: 64 } }
      }
    };
    const engine = new ArenaDraftEngine({ cardDatabase: duplicateVersionCardDb });
    engine.applyArenaLine("D 12:00:00.000 Arena.SetDraftMode - DRAFTING");

    expect(engine.applyScreenChoices(["唯一版本牌", "测试辅牌甲", "测试辅牌乙"])).toBe(true);
    expect(engine.getState().currentChoices[0]?.cardId).toBe("UNIQUE_ORIGINAL");

    engine.setRatings(delayedRatings);

    expect(engine.getState().currentChoices[0]).toMatchObject({
      cardId: "UNIQUE_RATED",
      rating: { pickRate: 64 }
    });
  });

  it("keeps the original card id when its own delayed rating becomes available", () => {
    const duplicateVersionCardDb = createCardDatabase([
      { dbfId: 6401, name: "正确版本牌", cardId: "CORRECT_ORIGINAL", collectible: true },
      { dbfId: 6402, name: "正确版本牌", cardId: "CORRECT_ALTERNATE", collectible: true },
      { dbfId: 6403, name: "测试辅牌甲", cardId: "CORRECT_FILLER_A", collectible: true },
      { dbfId: 6404, name: "测试辅牌乙", cardId: "CORRECT_FILLER_B", collectible: true }
    ]);
    const delayedRatings: ArenaRatingTable = {
      source: "test ratings",
      version: 1,
      fetchedAt: "2026-08-11T00:00:00.000Z",
      ratings: {},
      firestone: {
        source: "Firestone",
        version: "original-id-rated",
        lastUpdated: "2026-08-11T00:00:00.000Z",
        ratings: {
          CORRECT_ORIGINAL: { pickRate: 52 },
          CORRECT_ALTERNATE: { pickRate: 91 }
        }
      }
    };
    const engine = new ArenaDraftEngine({ cardDatabase: duplicateVersionCardDb });
    engine.applyArenaLine("D 12:00:00.000 Arena.SetDraftMode - DRAFTING");

    expect(engine.applyScreenChoices(["正确版本牌", "测试辅牌甲", "测试辅牌乙"])).toBe(true);
    expect(engine.getState().currentChoices[0]).toMatchObject({
      cardId: "CORRECT_ORIGINAL",
      rating: undefined
    });

    engine.setRatings(delayedRatings);

    expect(engine.getState().currentChoices[0]).toMatchObject({
      cardId: "CORRECT_ORIGINAL",
      rating: { pickRate: 52 }
    });
  });

  it("matches the three legendary-team titles from the 12:42 OCR capture and attaches statistics", () => {
    const legendaryTeamCardDb = createCardDatabase([
      { dbfId: 6001, name: "奇利亚斯豪华版3000型", cardId: "TOY_330t12", collectible: false },
      { dbfId: 6002, name: "奇利亚斯豪华版3000型", cardId: "TOY_330", collectible: true },
      { dbfId: 6003, name: "末世的姆诺兹多", cardId: "END_037", collectible: true },
      { dbfId: 6004, name: "瓦丝琪女男爵", cardId: "REV_925", collectible: true }
    ]);
    const legendaryTeamRatings: ArenaRatingTable = {
      source: "test ratings",
      version: 1,
      fetchedAt: "2026-07-29T00:00:00.000Z",
      ratings: {
        Shaman: {
          TOY_330: 82,
          END_037: 76,
          REV_925: 71
        }
      },
      firestone: {
        source: "Firestone",
        version: "12:42",
        lastUpdated: "2026-07-29T00:00:00.000Z",
        ratings: {
          TOY_330: { pickRate: 20.1 },
          END_037: { pickRate: 18.2 },
          REV_925: { pickRate: 16.3 }
        }
      }
    };
    const engine = new ArenaDraftEngine({
      cardDatabase: legendaryTeamCardDb,
      ratings: legendaryTeamRatings
    });
    engine.applyArenaText([
      "D 12:42:39.000 Arena.SetDraftMode - DRAFTING",
      "D 12:42:44.000 DraftManager.OnChosen(): hero=HERO_02"
    ].join("\n"));

    expect(engine.applyScreenChoices([
      "奇制亚斯受华版$000g",
      "末世的姆诺药岊",
      "瓦丝琪女男露"
    ])).toBe(false);
    expect(engine.getState().currentChoices).toEqual([]);
    expect(engine.applyScreenChoices([
      "奇制亚斯受华版$000g",
      "末世的姆诺药岊",
      "瓦丝琪女男露"
    ])).toBe(true);
    expect(engine.getState().currentChoices).toEqual([
      expect.objectContaining({
        cardId: "TOY_330",
        name: "奇利亚斯豪华版3000型",
        score: 82,
        rating: expect.objectContaining({ pickRate: 20.1 })
      }),
      expect.objectContaining({
        cardId: "END_037",
        name: "末世的姆诺兹多",
        score: 76,
        rating: expect.objectContaining({ pickRate: 18.2 })
      }),
      expect.objectContaining({
        cardId: "REV_925",
        name: "瓦丝琪女男爵",
        score: 71,
        rating: expect.objectContaining({ pickRate: 16.3 })
      })
    ]);
  });

  it("matches the legendary-team titles from the Hunter screenshot and attaches statistics", () => {
    const legendaryTeamCardDb = createCardDatabase([
      { dbfId: 97363, name: "荆棘谷之心", cardId: "ETC_208", collectible: true, rarity: "LEGENDARY" },
      { dbfId: 105260, name: "量产品9号", cardId: "MIS_914", collectible: true, rarity: "LEGENDARY" },
      { dbfId: 126425, name: "R4T-C4TCH3R捕鼠机", cardId: "JAIL_882", collectible: true, rarity: "LEGENDARY" }
    ]);
    const legendaryTeamRatings: ArenaRatingTable = {
      source: "test ratings",
      version: 1,
      fetchedAt: "2026-07-30T00:00:00.000Z",
      ratings: {
        Hunter: {
          ETC_208: 43,
          MIS_914: 52,
          JAIL_882: 86
        }
      },
      firestone: {
        source: "Firestone",
        version: "18:50",
        lastUpdated: "2026-07-30T00:00:00.000Z",
        ratings: {
          ETC_208: { pickRate: 20.87, includedWinrate: 52.25 },
          MIS_914: { pickRate: 8.33, includedWinrate: 50.17 },
          JAIL_882: { pickRate: 61.3, includedWinrate: 52.86 }
        }
      }
    };
    const engine = new ArenaDraftEngine({
      cardDatabase: legendaryTeamCardDb,
      ratings: legendaryTeamRatings
    });
    engine.applyArenaText([
      "D 18:49:59.000 Arena.SetDraftMode - DRAFTING",
      "D 18:50:00.000 DraftManager.OnChosen(): hero=HERO_05"
    ].join("\n"));

    expect(engine.applyScreenChoices([
      "荆棘谷之心",
      "量产品9号",
      "RAT-CAICHSR捕園"
    ])).toBe(true);
    expect(engine.getState().currentChoices).toEqual([
      expect.objectContaining({ cardId: "ETC_208", screenSlot: 0 }),
      expect.objectContaining({ cardId: "MIS_914", screenSlot: 1 })
    ]);
    expect(engine.applyScreenChoices([
      "荆棘谷之心",
      "量产品9号",
      "RAT-CAICHSR捕園"
    ])).toBe(true);
    expect(engine.getState().currentChoices).toEqual([
      expect.objectContaining({
        cardId: "ETC_208",
        name: "荆棘谷之心",
        score: 43,
        rating: expect.objectContaining({ pickRate: 20.87, firestone: expect.objectContaining({ includedWinrate: 52.25 }) })
      }),
      expect.objectContaining({
        cardId: "MIS_914",
        name: "量产品9号",
        score: 52,
        rating: expect.objectContaining({ pickRate: 8.33, firestone: expect.objectContaining({ includedWinrate: 50.17 }) })
      }),
      expect.objectContaining({
        cardId: "JAIL_882",
        name: "R4T-C4TCH3R捕鼠机",
        score: 86,
        rating: expect.objectContaining({ pickRate: 61.3, firestone: expect.objectContaining({ includedWinrate: 52.86 }) })
      })
    ]);
  });

  it("matches a long legendary minion name with the real OCR errors from the Hunter screenshot", () => {
    const legendaryTeamCardDb = createCardDatabase([
      { dbfId: 97862, name: "游侠将军希尔瓦娜斯", cardId: "HERO_05z", collectible: false, cardType: "HERO" },
      { dbfId: 119707, name: "游侠将军希尔瓦娜斯", cardId: "TIME_609", collectible: true, rarity: "LEGENDARY", cardType: "MINION" },
      { dbfId: 97363, name: "荆棘谷之心", cardId: "ETC_208", collectible: true, rarity: "LEGENDARY", cardType: "SPELL" },
      { dbfId: 105260, name: "量产品9号", cardId: "MIS_914", collectible: true, rarity: "LEGENDARY", cardType: "MINION" }
    ]);
    const engine = new ArenaDraftEngine({ cardDatabase: legendaryTeamCardDb });
    engine.applyArenaText([
      "D 10:19:59.000 Arena.SetDraftMode - DRAFTING",
      "D 10:20:00.000 DraftManager.OnChosen(): hero=HERO_05"
    ].join("\n"));

    expect(engine.applyScreenChoices([
      "量产品9号",
      "荆棘谷之心",
      "游供将军标尔瓦刻糖"
    ])).toBe(true);
    expect(engine.getState().currentChoices).toEqual([
      expect.objectContaining({ cardId: "MIS_914", screenSlot: 0 }),
      expect.objectContaining({ cardId: "ETC_208", screenSlot: 1 })
    ]);
    expect(engine.applyScreenChoices([
      "量产品9号",
      "荆棘谷之心",
      "游供将军标尔瓦刻糖"
    ])).toBe(true);
    expect(engine.getState().currentChoices).toEqual([
      expect.objectContaining({ cardId: "MIS_914", screenSlot: 0 }),
      expect.objectContaining({ cardId: "ETC_208", screenSlot: 1 }),
      expect.objectContaining({ cardId: "TIME_609", name: "游侠将军希尔瓦娜斯", screenSlot: 2 })
    ]);
  });

  it("keeps two reliable choices visible when the third OCR title is ambiguous", () => {
    const ambiguousCardDb = createCardDatabase([
      { dbfId: 6101, name: "超长传说名字甲乙丙丁甲", cardId: "AMBIGUOUS_A", collectible: true },
      { dbfId: 6102, name: "超长传说名字甲乙丙丁乙", cardId: "AMBIGUOUS_B", collectible: true },
      { dbfId: 6103, name: "末世的姆诺兹多", cardId: "END_037", collectible: true },
      { dbfId: 6104, name: "瓦丝琪女男爵", cardId: "REV_925", collectible: true }
    ]);
    const engine = new ArenaDraftEngine({ cardDatabase: ambiguousCardDb });
    engine.applyArenaLine("D 12:42:39.000 Arena.SetDraftMode - DRAFTING");

    expect(engine.applyScreenChoices([
      "超长传说名字甲乙丙丁丙",
      "末世的姆诺兹多",
      "瓦丝琪女男爵"
    ])).toBe(true);
    expect(engine.applyScreenChoices([
      "超长传说名字甲乙丙丁丙",
      "末世的姆诺兹多",
      "瓦丝琪女男爵"
    ])).toBe(false);
    expect(engine.getState().currentChoices).toEqual([
      expect.objectContaining({ cardId: "END_037", screenSlot: 1 }),
      expect.objectContaining({ cardId: "REV_925", screenSlot: 2 })
    ]);
  });

  it("upgrades a stable two-card screen result to all three slots without shifting lanes", () => {
    const engine = new ArenaDraftEngine({ cardDatabase: realOcrCardDb });
    engine.applyArenaLine("D 12:42:39.000 Arena.SetDraftMode - DRAFTING");

    expect(engine.applyScreenChoices(["鱼人吸血鬼", "", "P1CK-P0K3T扒窃机"])).toBe(true);
    expect(engine.getState().currentChoices).toEqual([
      expect.objectContaining({ cardId: "TEST_MURLOC", screenSlot: 0 }),
      expect.objectContaining({ cardId: "JAIL_456", screenSlot: 2 })
    ]);

    expect(engine.applyScreenChoices(["鱼人吸血鬼", "寒冰护体", "P1CK-P0K3T扒窃机"])).toBe(true);
    expect(engine.getState().currentChoices).toEqual([
      expect.objectContaining({ cardId: "TEST_MURLOC", screenSlot: 0 }),
      expect.objectContaining({ cardId: "TEST_BARRIER", screenSlot: 1 }),
      expect.objectContaining({ cardId: "JAIL_456", screenSlot: 2 })
    ]);
  });

  it("does not replace a complete three-card result with a later partial OCR frame", () => {
    const engine = new ArenaDraftEngine({ cardDatabase: realOcrCardDb });
    engine.applyArenaLine("D 12:42:39.000 Arena.SetDraftMode - DRAFTING");
    expect(engine.applyScreenChoices(["鱼人吸血鬼", "寒冰护体", "P1CK-P0K3T扒窃机"])).toBe(true);

    expect(engine.applyScreenChoices(["鱼人吸血鬼", "", "P1CK-P0K3T扒窃机"])).toBe(false);
    expect(engine.getState().currentChoices).toHaveLength(3);
  });

  it("stabilizes a changed OCR slot without clearing the other confirmed lanes", () => {
    const slotCardDb = createCardDatabase([
      { dbfId: 6201, name: "Alpha Long Card", cardId: "SLOT_A", collectible: true },
      { dbfId: 6202, name: "Bravo Long Card", cardId: "SLOT_B", collectible: true },
      { dbfId: 6203, name: "Charlie Long Card", cardId: "SLOT_C", collectible: true },
      { dbfId: 6204, name: "Delta Long Card", cardId: "SLOT_D", collectible: true },
      { dbfId: 6205, name: "Echo Long Card", cardId: "SLOT_E", collectible: true }
    ]);
    const engine = new ArenaDraftEngine({ cardDatabase: slotCardDb });
    engine.applyArenaLine("D 12:42:39.000 Arena.SetDraftMode - DRAFTING");
    expect(engine.applyScreenChoices(["Alpha Long Card", "Bravo Long Card", "Charlie Long Card"])).toBe(true);

    expect(engine.applyScreenChoices(["Alpha Long Card", "Delta Long Carx", "Charlie Long Card"])).toBe(false);
    expect(engine.getState().currentChoices.map((choice) => choice.cardId)).toEqual([
      "SLOT_A",
      "SLOT_B",
      "SLOT_C"
    ]);

    expect(engine.applyScreenChoices(["Alpha Long Card", "Echo Long Carx", "Charlie Long Card"])).toBe(false);
    expect(engine.applyScreenChoices(["Alpha Long Card", "Delta Long Carx", "Charlie Long Card"])).toBe(false);
    expect(engine.applyScreenChoices(["Alpha Long Card", "Delta Long Carx", "Charlie Long Card"])).toBe(true);
    expect(engine.getState().currentChoices.map((choice) => choice.cardId)).toEqual([
      "SLOT_A",
      "SLOT_D",
      "SLOT_C"
    ]);
  });

  it("corrects a unique one-character OCR error in a three-character legendary name", () => {
    const shortLegendaryCardDb = createCardDatabase([
      { dbfId: 103169, name: "希希集", cardId: "TOY_913", collectible: true, cardType: "随从" },
      { dbfId: 126211, name: "伊莉达·寻罪", cardId: "JAIL_719", collectible: true, cardType: "随从" },
      { dbfId: 121063, name: "克罗妮卡", cardId: "END_006", collectible: true, cardType: "随从" }
    ]);
    const engine = new ArenaDraftEngine({ cardDatabase: shortLegendaryCardDb });
    engine.applyArenaLine("D 10:40:00.000 Arena.SetDraftMode - DRAFTING");

    expect(engine.applyScreenChoices(["希希巢", "伊莉达，寻罪", "克罗妮卡"])).toBe(true);
    expect(engine.getState().currentChoices.map((choice) => choice.cardId)).toEqual([
      "JAIL_719",
      "END_006"
    ]);
    expect(engine.applyScreenChoices(["希希巢", "伊莉达，寻罪", "克罗妮卡"])).toBe(true);
    expect(engine.getState().currentChoices.map((choice) => choice.cardId)).toEqual([
      "TOY_913",
      "JAIL_719",
      "END_006"
    ]);
  });

  it("prefers the playable card over a same-name hero skin when ratings are unavailable", () => {
    const duplicatedNameCardDb = createCardDatabase([
      { dbfId: 9001, name: "伊莉达·寻罪", cardId: "HERO_10br", collectible: true, cardType: "英雄" },
      { dbfId: 126211, name: "伊莉达·寻罪", cardId: "JAIL_719", collectible: true, cardType: "随从" },
      { dbfId: 103169, name: "希希集", cardId: "TOY_913", collectible: true, cardType: "随从" },
      { dbfId: 121063, name: "克罗妮卡", cardId: "END_006", collectible: true, cardType: "随从" }
    ]);
    const engine = new ArenaDraftEngine({ cardDatabase: duplicatedNameCardDb });
    engine.applyArenaLine("D 10:40:00.000 Arena.SetDraftMode - DRAFTING");

    expect(engine.applyScreenChoices(["希希集", "伊莉达，寻罪", "克罗妮卡"])).toBe(true);
    expect(engine.getState().currentChoices[1]?.cardId).toBe("JAIL_719");
  });

  it("matches the real noisy Deathwing team core and keeps the full Ysera title distinct", () => {
    const legendaryTeamCardDb = createCardDatabase([
      { dbfId: 125467, name: "灭世者死亡之翼", cardId: "CATA_190h", collectible: true, rarity: "LEGENDARY", cardType: "HERO" },
      { dbfId: 113321, name: "伊瑟拉，翡翠守护巨龙", cardId: "EDR_000", collectible: true, rarity: "LEGENDARY", cardType: "MINION" },
      { dbfId: 1186, name: "伊瑟拉", cardId: "EX1_572", collectible: true, rarity: "LEGENDARY", cardType: "MINION" },
      { dbfId: 140003, name: "测试团队核心甲", cardId: "TEAM_CORE_A", collectible: true, rarity: "LEGENDARY", cardType: "MINION" }
    ]);
    const engine = new ArenaDraftEngine({ cardDatabase: legendaryTeamCardDb });
    engine.applyArenaLine("D 10:40:00.000 Arena.SetDraftMode - DRAFTING");

    const frame = ["买世者死皮定熟", "测试团队核心甲", "伊瑟拉。翡翠守护尽态"];
    expect(engine.applyScreenChoices(frame)).toBe(false);
    expect(engine.applyScreenChoices(frame)).toBe(true);
    expect(engine.getState().currentChoices[0]).toMatchObject({
      cardId: "CATA_190h",
      name: "灭世者死亡之翼",
      screenSlot: 0
    });
    expect(engine.getState().currentChoices[2]).toMatchObject({
      cardId: "EDR_000",
      name: "伊瑟拉，翡翠守护巨龙",
      screenSlot: 2
    });
    expect(engine.getState().currentChoices.map((choice) => choice.cardId)).not.toContain("EX1_572");
  });

  it("rejects a noisy seven-character title when the widened fuzzy match is tied", () => {
    const ambiguousTeamCardDb = createCardDatabase([
      { dbfId: 125467, name: "灭世者死亡之翼", cardId: "CATA_190h", collectible: true, rarity: "LEGENDARY", cardType: "HERO" },
      { dbfId: 140005, name: "灭世者死亡之骨", cardId: "TEAM_CORE_DECOY", collectible: true, rarity: "LEGENDARY", cardType: "MINION" },
      { dbfId: 140003, name: "测试团队核心甲", cardId: "TEAM_CORE_A", collectible: true, rarity: "LEGENDARY", cardType: "MINION" },
      { dbfId: 140004, name: "测试团队核心乙", cardId: "TEAM_CORE_B", collectible: true, rarity: "LEGENDARY", cardType: "MINION" }
    ]);
    const engine = new ArenaDraftEngine({ cardDatabase: ambiguousTeamCardDb });
    engine.applyArenaLine("D 10:40:00.000 Arena.SetDraftMode - DRAFTING");

    const frame = ["买世者死皮定熟", "测试团队核心甲", "测试团队核心乙"];
    expect(engine.applyScreenChoices(frame)).toBe(true);
    expect(engine.applyScreenChoices(frame)).toBe(false);
    expect(engine.getState().currentChoices.map((choice) => choice.cardId)).toEqual([
      "TEAM_CORE_A",
      "TEAM_CORE_B"
    ]);
  });

  it("keeps the original fuzzy threshold for an ordinary seven-character draft card", () => {
    const ordinaryCardDb = createCardDatabase([
      { dbfId: 160001, name: "普通七字测试卡", cardId: "ORDINARY_SEVEN", collectible: true, rarity: "COMMON", cardType: "MINION" },
      { dbfId: 160002, name: "普通选牌已开始", cardId: "PREVIEW_DONE", collectible: true, rarity: "COMMON", cardType: "MINION" },
      { dbfId: 160003, name: "普通选牌测试甲", cardId: "ORDINARY_A", collectible: true, rarity: "COMMON", cardType: "MINION" },
      { dbfId: 160004, name: "普通选牌测试乙", cardId: "ORDINARY_B", collectible: true, rarity: "COMMON", cardType: "MINION" }
    ]);
    const engine = new ArenaDraftEngine({ cardDatabase: ordinaryCardDb });
    engine.applyArenaLine("D 10:40:00.000 Arena.SetDraftMode - DRAFTING");
    engine.applyArenaLine("D 10:40:01.000 Client chooses: [PREVIEW_DONE]");

    const frame = ["普同七宇侧式卡", "普通选牌测试甲", "普通选牌测试乙"];
    expect(engine.applyScreenChoices(frame)).toBe(true);
    expect(engine.applyScreenChoices(frame)).toBe(false);
    expect(engine.getState().currentChoices.map((choice) => choice.cardId)).toEqual([
      "ORDINARY_A",
      "ORDINARY_B"
    ]);
  });

  it("rejects a hero-typed team core after leaving the team preview", () => {
    const postPreviewCardDb = createCardDatabase([
      { dbfId: 125467, name: "灭世者死亡之翼", cardId: "CATA_190h", collectible: true, rarity: "LEGENDARY", cardType: "HERO" },
      { dbfId: 160002, name: "普通选牌已开始", cardId: "PREVIEW_DONE", collectible: true, rarity: "COMMON", cardType: "MINION" },
      { dbfId: 160003, name: "普通选牌测试甲", cardId: "ORDINARY_A", collectible: true, rarity: "COMMON", cardType: "MINION" },
      { dbfId: 160004, name: "普通选牌测试乙", cardId: "ORDINARY_B", collectible: true, rarity: "COMMON", cardType: "MINION" }
    ]);
    const engine = new ArenaDraftEngine({ cardDatabase: postPreviewCardDb });
    engine.applyArenaLine("D 10:40:00.000 Arena.SetDraftMode - DRAFTING");
    engine.applyArenaLine("D 10:40:01.000 Client chooses: [PREVIEW_DONE]");

    expect(engine.applyScreenChoices(["灭世者死亡之翼", "普通选牌测试甲", "普通选牌测试乙"])).toBe(true);
    expect(engine.getState().currentChoices.map((choice) => choice.cardId)).toEqual([
      "ORDINARY_A",
      "ORDINARY_B"
    ]);
  });

  it("keeps ordinary hero portraits out of legendary-team screen choices", () => {
    const heroPortraitCardDb = createCardDatabase([
      { dbfId: 150001, name: "玛法里奥·怒风", cardId: "HERO_06", collectible: true, rarity: "LEGENDARY", cardType: "英雄" },
      { dbfId: 150002, name: "测试团队核心甲", cardId: "TEAM_CORE_A", collectible: true, rarity: "LEGENDARY", cardType: "随从" },
      { dbfId: 150003, name: "测试团队核心乙", cardId: "TEAM_CORE_B", collectible: true, rarity: "LEGENDARY", cardType: "随从" }
    ]);
    const engine = new ArenaDraftEngine({ cardDatabase: heroPortraitCardDb });
    engine.applyArenaLine("D 10:40:00.000 Arena.SetDraftMode - DRAFTING");

    expect(engine.applyScreenChoices(["玛法里奥·怒风", "测试团队核心甲", "测试团队核心乙"])).toBe(true);
    expect(engine.getState().currentChoices).toEqual([
      expect.objectContaining({ cardId: "TEAM_CORE_A", screenSlot: 1 }),
      expect.objectContaining({ cardId: "TEAM_CORE_B", screenSlot: 2 })
    ]);
  });

  it("does not treat an internal non-collectible rules keyword as an arena card", () => {
    const cardDatabase = createCardDatabase([
      { dbfId: 70145, name: "流放", cardId: "DH_Lunar_TBBucket_2", cardType: "法术" },
      { dbfId: 103169, name: "希希集", cardId: "TOY_913", collectible: true, cardType: "随从" },
      { dbfId: 126211, name: "伊莉达·寻罪", cardId: "JAIL_719", collectible: true, cardType: "随从" }
    ]);
    const engine = new ArenaDraftEngine({ cardDatabase });
    engine.applyArenaLine("D 10:40:00.000 Arena.SetDraftMode - DRAFTING");

    expect(engine.applyScreenChoices(["希希集", "流放", "伊莉达，寻罪"])).toBe(true);
    expect(engine.getState().currentChoices).toEqual([
      expect.objectContaining({ cardId: "TOY_913", screenSlot: 0 }),
      expect.objectContaining({ cardId: "JAIL_719", screenSlot: 2 })
    ]);
  });

  it("ignores orphan Arena picks and non-local or non-draft Power choices", () => {
    const engine = new ArenaDraftEngine({ cardDatabase: cardDb, ratings });

    engine.applyArenaLine("D 12:00:00.000 Client chooses: [TEST_001]");
    expect(engine.getState().draftCount).toBe(0);

    engine.applyArenaLine("D 12:00:01.000 Arena.SetDraftMode - DRAFTING");
    engine.applyPowerText(`
D 12:00:02.000 GameState.DebugPrintEntityChoices() - id=3 Player=Opponent TaskList=4 ChoiceType=GENERAL CountMin=1 CountMax=1
D 12:00:02.000 GameState.DebugPrintEntityChoices() -   Entities[0]=[entityName=Sample Singleton id=301 zone=SETASIDE zonePos=0 cardId=TEST_001 player=2]
D 12:00:02.000 ChoiceCardMgr.WaitThenShowChoices() - id=3 BEGIN
D 12:00:03.000 GameState.DebugPrintEntityChoices() - id=4 Player=Local TaskList=4 ChoiceType=DISCOVER CountMin=1 CountMax=1
D 12:00:03.000 GameState.DebugPrintEntityChoices() -   Entities[0]=[entityName=Sample Pair id=401 zone=SETASIDE zonePos=0 cardId=TEST_002 player=1]
D 12:00:03.000 ChoiceCardMgr.WaitThenShowChoices() - id=4 BEGIN
`);

    expect(engine.getState().currentChoices).toEqual([]);
    expect(engine.getState().draftCount).toBe(0);
  });
});
