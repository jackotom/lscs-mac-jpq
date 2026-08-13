import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sampleCardDb from "../fixtures/cards.sample.json";
import { parseDeckText } from "../src/shared/deck";
import { createCardDatabase, type CardDatabase } from "../src/shared/cardDatabase";
import { parseLogLine } from "../src/shared/powerLogParser";
import { TrackerEngine } from "../src/shared/trackerEngine";
import { parsePublicTrackerState } from "../src/renderer/runtimeValidation";
import type { CollectionDeck, DeckCard } from "../src/shared/types";

const cardDb = sampleCardDb as CardDatabase;

describe("parseDeckText", () => {
  it("parses manual deck lines", () => {
    const deck = parseDeckText("2x Fireball\n1 Yogg-Saron, Unleashed\nMiracle Salesman");
    expect(deck.cards).toEqual([
      { name: "Fireball", count: 2 },
      { name: "Miracle Salesman", count: 1 },
      { name: "Yogg-Saron, Unleashed", count: 1 }
    ]);
  });

  it("keeps deck code as raw text", () => {
    const deck = parseDeckText("AAECAf0EBveryLongDeckCode000000==");
    expect(deck.rawCode).toBe("AAECAf0EBveryLongDeckCode000000==");
    expect(deck.warnings[0]).toContain("缺少卡牌数据库");
  });

  it("decodes a deck code when a card database is available", () => {
    const deckCode = encodeDeckString([0, 1, 2, 1, 7, 1, 1001, 1, 1002, 0]);

    const deck = parseDeckText(deckCode, cardDb);

    expect(deck.rawCode).toBe(deckCode);
    expect(deck.cards).toEqual([
      expect.objectContaining({ name: "Sample Pair", count: 2, cardId: "TEST_002" }),
      expect.objectContaining({ name: "Sample Singleton", count: 1, cardId: "TEST_001" })
    ]);
    expect(deck.warnings).toEqual([]);
  });
});

describe("parseLogLine", () => {
  it("parses trustworthy match-flow tags without guessing their meaning", () => {
    const turn = parseLogLine(
      "D 12:00:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=TURN value=7"
    );
    const step = parseLogLine(
      "D 12:00:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=MAIN_ACTION"
    );
    const nextStep = parseLogLine(
      "D 12:00:02.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=NEXT_STEP value=MAIN_END"
    );
    const currentPlayer = parseLogLine(
      "D 12:00:03.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=本地玩家 id=2 zone=PLAY cardId= player=2] tag=CURRENT_PLAYER value=1"
    );
    const resources = parseLogLine(
      "D 12:00:04.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=本地玩家 id=2 zone=PLAY cardId= player=2] tag=RESOURCES value=7"
    );
    const resourcesUsed = parseLogLine(
      "D 12:00:05.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=本地玩家 id=2 zone=PLAY cardId= player=2] tag=RESOURCES_USED value=2"
    );

    expect(turn).toEqual([
      expect.objectContaining({ type: "match-flow", tag: "TURN", value: "7" })
    ]);
    expect(step).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "game-setup-complete" }),
      expect.objectContaining({ type: "match-flow", tag: "STEP", value: "MAIN_ACTION" })
    ]));
    expect(nextStep).toEqual([
      expect.objectContaining({ type: "match-flow", tag: "NEXT_STEP", value: "MAIN_END" })
    ]);
    for (const [events, tag, value] of [
      [currentPlayer, "CURRENT_PLAYER", "1"],
      [resources, "RESOURCES", "7"],
      [resourcesUsed, "RESOURCES_USED", "2"]
    ] as const) {
      expect(events).toEqual([
        expect.objectContaining({
          type: "match-flow",
          tag,
          value,
          entity: expect.objectContaining({ id: "2", controller: 2 })
        })
      ]);
    }
  });

  it("parses zone changes", () => {
    const events = parseLogLine(
      "D 12:00:00.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Fireball id=64 zone=DECK zonePos=1 cardId=CS2_029 player=1] tag=ZONE value=HAND"
    );

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "zone-change",
          entityId: "64",
          cardName: "Fireball",
          fromZone: "DECK",
          toZone: "HAND"
        })
      ])
    );
  });

  it("keeps Kel'Thuzad's resurrection counter as script data", () => {
    const events = parseLogLine(
      "D 15:03:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=天定之灾克尔苏加德 id=40 zone=HAND cardId=REV_514 player=1] tag=TAG_SCRIPT_DATA_NUM_1 value=5"
    );

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "entity-script-data",
        entity: expect.objectContaining({ id: "40", cardId: "REV_514", controller: 1 }),
        index: 1,
        value: 5
      })
    ]));
  });

  it("keeps card ids when Hearthstone logs an unknown nested entity", () => {
    const events = parseLogLine(
      "D 12:00:00.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=64 zone=DECK zonePos=1 cardId=TEST_001 player=1] tag=ZONE value=HAND"
    );

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "zone-change",
          entityId: "64",
          cardName: undefined,
          cardId: "TEST_001",
          fromZone: "DECK",
          toZone: "HAND"
        })
      ])
    );
  });

  it("recognizes Hearthstone's end-of-game records", () => {
    expect(
      parseLogLine("D 12:10:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=本地玩家 tag=PLAYSTATE value=LOST")
    ).toEqual([expect.objectContaining({ type: "game-end" })]);
    expect(
      parseLogLine("D 12:10:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=FINAL_GAMEOVER")
    ).toEqual([expect.objectContaining({ type: "game-end" })]);
  });

  it("recognizes Arena CREATE_GAME records as game starts after the service releases them", () => {
    expect(
      parseLogLine(
        "D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_ARENA"
      )
    ).toEqual([expect.objectContaining({ type: "game-start" })]);
  });

  it("parses player identities and public player counters without card data", () => {
    expect(
      parseLogLine(
        "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=2, PlayerName=测试玩家#1234"
      )
    ).toEqual([
      expect.objectContaining({
        type: "player-identity",
        playerId: 2,
        playerName: "测试玩家#1234"
      })
    ]);

    expect(
      parseLogLine(
        "D 12:00:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=测试玩家#1234 tag=FATIGUE value=2"
      )
    ).toEqual([
      expect.objectContaining({
        type: "player-counter",
        playerName: "测试玩家#1234",
        counter: "fatigue",
        value: 2
      })
    ]);
    expect(
      parseLogLine(
        "D 12:00:02.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=测试玩家#1234 tag=CORPSES value=7"
      )
    ).toEqual([
      expect.objectContaining({
        type: "player-counter",
        playerName: "测试玩家#1234",
        counter: "corpses",
        value: 7
      })
    ]);
    expect(
      parseLogLine(
        "D 12:00:03.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=测试玩家 id=2 zone=PLAY cardId= player=2] tag=NUM_SPELLS_PLAYED_THIS_GAME value=5"
      )
    ).toEqual([
      expect.objectContaining({
        type: "player-counter",
        playerId: 2,
        counter: "spells-played",
        value: 5
      })
    ]);
  });

  it("emits only whitelisted start-of-game global effect triggers", () => {
    const globalEffect = parseLogLine(
      "D 20:46:32.000 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=TRIGGER Entity=[entityName=指挥官碧阿崔克丝 id=42 zone=SETASIDE cardId=JAIL_397 player=2] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1 TriggerKeyword=START_OF_GAME_KEYWORD"
    );
    const ordinaryTrigger = parseLogLine(
      "D 20:46:33.000 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=TRIGGER Entity=[entityName=普通光环 id=43 zone=PLAY cardId=NORMAL_AURA player=2] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1 TriggerKeyword=START_OF_GAME_KEYWORD"
    );

    expect(globalEffect.filter((event) => event.type === "global-effect")).toEqual([
      expect.objectContaining({ type: "global-effect", entity: expect.objectContaining({ cardId: "JAIL_397", controller: 2 }) })
    ]);
    expect(ordinaryTrigger.some((event) => event.type === "global-effect")).toBe(false);
  });

  it("emits a persistent effect only for an explicitly whitelisted played card", () => {
    const persistentPlay = parseLogLine(
      "D 12:00:01.000 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=星界沟通 id=51 zone=HAND cardId=BAR_539 player=1] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1"
    );
    const ordinaryPlay = parseLogLine(
      "D 12:00:02.000 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=普通法术 id=52 zone=HAND cardId=NORMAL_SPELL player=1] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1"
    );

    expect(persistentPlay).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "global-effect",
        source: "played",
        entity: expect.objectContaining({ cardId: "BAR_539", controller: 1 })
      })
    ]));
    expect(ordinaryPlay.some((event) => event.type === "global-effect")).toBe(false);
  });

  it("parses attack blocks with both attacker and target", () => {
    const events = parseLogLine(
      "D 12:00:03.000 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=ATTACK Entity=[entityName=友方随从 id=51 zone=PLAY cardId=TEST_MINION player=1] EffectCardId=0 EffectIndex=0 Target=[entityName=对方英雄 id=4 zone=PLAY cardId=HERO_01 player=2] SubOption=-1"
    );

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "block-boundary",
        phase: "start",
        blockType: "ATTACK",
        entity: expect.objectContaining({ id: "51", controller: 1 }),
        target: expect.objectContaining({ id: "4", controller: 2 })
      }),
      expect.objectContaining({
        type: "action-boundary",
        phase: "start",
        action: "attack",
        target: expect.objectContaining({ id: "4", controller: 2 })
      })
    ]));
  });
});

describe("TrackerEngine", () => {
  it("publishes match flow and stamps trusted turns onto uses, burns, and events", () => {
    const engine = createLifecycleEngine("1x 友方使用牌\n1x 烧毁测试牌");

    engine.applyText([
      "D 12:00:00.000 GameState.DebugPrintPower() - CREATE_GAME",
      "D 12:00:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=TURN value=7",
      "D 12:00:02.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=MAIN_ACTION",
      "D 12:00:03.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=本地玩家 id=1 zone=PLAY cardId= player=1] tag=CURRENT_PLAYER value=1",
      "D 12:00:04.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=本地玩家 id=1 zone=PLAY cardId= player=1] tag=TURN value=4",
      "D 12:00:05.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=本地玩家 id=1 zone=PLAY cardId= player=1] tag=RESOURCES value=7",
      "D 12:00:06.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=本地玩家 id=1 zone=PLAY cardId= player=1] tag=RESOURCES_USED value=2",
      "D 12:00:07.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=友方使用牌 id=51 zone=HAND cardId=FRIEND_USE player=1]",
      "D 12:00:08.000 GameState.DebugPrintPower() - BLOCK_END",
      ...createHandEntityLines(10, 1, 300),
      "D 12:00:30.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=烧毁测试牌 id=43 zone=DECK cardId=BURNED_CARD player=1] tag=ZONE value=GRAVEYARD"
    ].join("\n"));

    const state = engine.getState();
    expect(state.matchFlow).toEqual({
      globalTurn: 7,
      activeSide: "friendly",
      phase: "action",
      friendly: { turn: 4, mana: 7, manaUsed: 2 }
    });
    expect(state.cardTracking.friendly.used.items[0]).toMatchObject({
      entityId: "51",
      turn: 7
    });
    expect(state.cardTracking.friendly.burned.items[0]).toMatchObject({
      entityId: "43",
      turn: 7
    });
    expect(state.events.find((event) => event.cardId === "BURNED_CARD")).toMatchObject({
      turn: 7
    });
  });

  it("clears match flow at both new-game and game-end boundaries", () => {
    const engine = createLifecycleEngine();
    engine.resetForGame();
    engine.applyText([
      "D 12:00:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=TURN value=7",
      "D 12:00:02.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=本地玩家 id=1 zone=PLAY cardId= player=1] tag=CURRENT_PLAYER value=1"
    ].join("\n"));
    expect(engine.getState().matchFlow).toEqual({
      globalTurn: 7,
      activeSide: "friendly"
    });

    engine.resetForGame();
    expect(engine.getState().matchFlow).toBeUndefined();

    engine.applyLine(
      "D 12:10:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=TURN value=8"
    );
    engine.applyLine(
      "D 12:10:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=FINAL_GAMEOVER"
    );
    expect(engine.getState().matchFlow).toBeUndefined();
  });

  it("applies player-name and entity-detail match-flow tags with their real controller", () => {
    const engine = new TrackerEngine();
    engine.setFriendlyController(2);
    engine.resetForGame();
    engine.applyText([
      "D 12:00:00.000 GameState.DebugPrintGame() - PlayerID=2, PlayerName=本地玩家#1234",
      "D 12:00:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=本地玩家 tag=CURRENT_PLAYER value=1",
      "D 12:00:01.500 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=TURN value=9",
      "D 12:00:02.000 GameState.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=本地玩家 id=2 zone=PLAY cardId= player=2] CardID=",
      "D 12:00:02.050 GameState.DebugPrintPower() -     tag=TURN value=4",
      "D 12:00:02.100 GameState.DebugPrintPower() -     tag=RESOURCES value=8",
      "D 12:00:02.200 GameState.DebugPrintPower() -     tag=RESOURCES_USED value=3"
    ].join("\n"));

    expect(engine.getState().matchFlow).toEqual({
      globalTurn: 9,
      activeSide: "friendly",
      friendly: { turn: 4, mana: 8, manaUsed: 3 }
    });
  });

  it("shows Aviana beside Hamuul after the opponent reaches full moon", () => {
    const fixture = readFileSync(
      join(process.cwd(), "fixtures/logs/opponent-aviana-full-moon/Power.log"),
      "utf8"
    );
    const richDb = createCardDatabase([
      { id: 1, cardId: "EDR_845", name: "哈缪尔·符文图腾", type: "MINION" },
      { id: 2, cardId: "EDR_895", name: "艾维娜，艾露恩钦选者", type: "MINION" }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(1);

    engine.applyText(fixture);

    expect(engine.getState().opponentGlobalEffects).toHaveLength(2);
    expect(engine.getState().opponentGlobalEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "哈缪尔·符文图腾", cardId: "EDR_845" }),
      expect.objectContaining({ name: "艾维娜，艾露恩钦选者", cardId: "EDR_895" })
    ]));
  });

  it("replays the sanitized real duplicate-start fixture without dropping the selected deck", () => {
    const fixture = readFileSync(
      join(process.cwd(), "fixtures/logs/constructed-duplicate-create/Power.log"),
      "utf8"
    );
    const richDb = createCardDatabase([
      { id: 1, cardId: "JAIL_397", name: "指挥官碧阿崔克丝", type: "MINION" },
      { id: 2, cardId: "CORE_DS1_184", name: "追踪术", type: "SPELL" },
      { id: 3, cardId: "JAM_037", name: "精英牛头人歌王", type: "MINION" }
    ]);
    const engine = new TrackerEngine({
      cardDatabase: richDb,
      collectionDecks: [createCollectionDeck("selected", "学徒猎人", [{ name: "测试卡", count: 30, cardId: "TEST_CARD" }])]
    });
    engine.setFriendlyController(1);
    const [firstLine, ...remainingLines] = fixture.trimEnd().split("\n");
    engine.applyLine(firstLine);
    expect(engine.activateCollectionDeck("selected")).toBe(true);
    engine.applyText(remainingLines.join("\n"));

    expect(engine.getState()).toMatchObject({
      deckName: "学徒猎人",
      summary: { totalCards: 30, remainingCards: 30, drawnCards: 0 },
      friendlyHand: [{ name: "精英牛头人歌王", count: 1, cardId: "JAM_037" }],
      friendlyOther: [{ name: "追踪术", count: 1, cardId: "CORE_DS1_184" }],
      globalEffects: [],
      opponentGlobalEffects: [{ name: "指挥官碧阿崔克丝", count: 1, cardId: "JAIL_397" }]
    });
  });

  it("keeps friendly and opponent global effects separate and resets them on a real new game", () => {
    const richDb = createCardDatabase([
      { id: 1, cardId: "GIL_692", name: "格恩·灰鬃", type: "MINION" },
      { id: 2, cardId: "JAIL_397", name: "指挥官碧阿崔克丝", type: "MINION" }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(1);
    engine.applyText(`
D 20:46:06.3975180 GameState.DebugPrintPower() - CREATE_GAME
D 20:46:07.000 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=TRIGGER Entity=[entityName=格恩·灰鬃 id=41 zone=SETASIDE cardId=GIL_692 player=1] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1 TriggerKeyword=START_OF_GAME_KEYWORD
D 20:46:08.000 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=TRIGGER Entity=[entityName=指挥官碧阿崔克丝 id=42 zone=SETASIDE cardId=JAIL_397 player=2] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1 TriggerKeyword=START_OF_GAME_KEYWORD
D 20:46:06.3975180 PowerTaskList.DebugPrintPower() - CREATE_GAME
`);

    expect(engine.getState()).toMatchObject({
      globalEffects: [{ name: "格恩·灰鬃", count: 1, cardId: "GIL_692" }],
      opponentGlobalEffects: [{ name: "指挥官碧阿崔克丝", count: 1, cardId: "JAIL_397" }]
    });

    engine.applyLine("D 20:50:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME");
    expect(engine.getState()).toMatchObject({ globalEffects: [], opponentGlobalEffects: [] });
  });

  it("tracks public counters by PlayerID and resets them at game boundaries", () => {
    const engine = new TrackerEngine();
    engine.setFriendlyController(2);
    engine.applyText(`
D 12:00:00.000 GameState.DebugPrintPower() - CREATE_GAME
D 12:00:00.100 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER
D 12:00:00.100 GameState.DebugPrintGame() - PlayerID=2, PlayerName=看似对手#1234
D 12:00:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=本地玩家 tag=NUM_SPELLS_PLAYED_THIS_GAME value=4
D 12:00:01.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=本地玩家 tag=NUM_SPELLS_PLAYED_THIS_GAME value=4
D 12:00:02.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=看似对手#1234 tag=CORPSES value=7
D 12:00:02.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=看似对手#1234 tag=CORPSES value=7
D 12:00:03.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=本地玩家 tag=FATIGUE value=2
D 12:00:03.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=本地玩家 tag=FATIGUE value=2
D 12:00:04.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=看似对手#1234 tag=NUM_SPELLS_PLAYED_THIS_GAME value=5
D 12:00:04.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=看似对手#1234 tag=NUM_SPELLS_PLAYED_THIS_GAME value=5
D 12:00:05.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=看似对手#1234 tag=FATIGUE value=0
`);

    expect(engine.getState().matchCounters).toEqual({
      friendly: { corpses: 7, spellsPlayed: 5 },
      opponent: { nextFatigueDamage: 3, spellsPlayed: 4 }
    });

    engine.applyLine("D 12:01:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME");
    expect(engine.getState().matchCounters).toBeUndefined();

    engine.applyText(`
D 12:01:00.100 GameState.DebugPrintGame() - PlayerID=1, PlayerName=UNKNOWN HUMAN PLAYER
D 12:01:00.100 GameState.DebugPrintGame() - PlayerID=2, PlayerName=看似对手#1234
D 12:01:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=看似对手#1234 tag=CORPSES value=2
D 12:01:02.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=看似对手#1234 tag=PLAYSTATE value=LOST
`);
    expect(engine.getState().matchCounters).toBeUndefined();
  });

  const realPowerLogPath = "/Applications/Hearthstone/Logs/Hearthstone_2026_07_23_11_05_14/Power.log";
  const realPowerLogTest = existsSync(realPowerLogPath) ? it : it.skip;
  realPowerLogTest("replays public counters from the real 2026-07-23 Power.log", () => {
    const fixture = readFileSync(realPowerLogPath, "utf8");
    const gameEndIndex = fixture.search(
      /tag=PLAYSTATE\s+value=(?:WON|LOST|TIED|CONCEDED)\b|tag=(?:STEP|NEXT_STEP)\s+value=FINAL_GAMEOVER\b/i
    );
    expect(gameEndIndex).toBeGreaterThan(0);

    const engine = new TrackerEngine();
    engine.setFriendlyController(2);
    engine.applyText(fixture.slice(0, gameEndIndex));

    expect(engine.getState().matchCounters).toEqual({
      friendly: { corpses: 17, spellsPlayed: 14 },
      opponent: { nextFatigueDamage: 3, corpses: 12, spellsPlayed: 11 }
    });

    engine.applyText(fixture.slice(gameEndIndex));
    expect(engine.getState().matchCounters).toBeUndefined();
  });

  it("separates persistent effects played by each controller and clears them after game end", () => {
    const richDb = createCardDatabase([
      { id: 1, cardId: "BAR_539", name: "星界沟通", type: "SPELL" },
      { id: 2, cardId: "GDB_467", name: "类星体", type: "SPELL" },
      { id: 3, cardId: "NORMAL_SPELL", name: "普通法术", type: "SPELL" }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(1);
    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=星界沟通 id=51 zone=HAND cardId=BAR_539 player=1] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1
D 12:00:02.000 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=类星体 id=52 zone=HAND cardId=GDB_467 player=2] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1
D 12:00:03.000 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=星界沟通 id=53 zone=HAND cardId=BAR_539] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1
D 12:00:04.000 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=普通法术 id=54 zone=HAND cardId=NORMAL_SPELL player=1] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1
`);

    expect(engine.getState()).toMatchObject({
      globalEffects: [{ name: "星界沟通", count: 1, cardId: "BAR_539" }],
      opponentGlobalEffects: [{ name: "类星体", count: 1, cardId: "GDB_467" }]
    });

    engine.applyLine("D 12:10:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=本地玩家 id=1 zone=PLAY cardId= player=1] tag=PLAYSTATE value=LOST");
    expect(engine.getState()).toMatchObject({ globalEffects: [], opponentGlobalEffects: [] });
  });

  it("在星空投影球详情中按施放顺序记录本局我方法术并忽略重复日志", () => {
    const richDb = createCardDatabase([
      { id: 103354, cardId: "TOY_378", name: "星空投影球", type: "SPELL", cost: 10 },
      { id: 1, cardId: "CORE_CS2_024", name: "寒冰箭", type: "SPELL", cost: 2 },
      { id: 2, cardId: "REV_840", name: "死神之躯", type: "SPELL", cost: 6 },
      { id: 3, cardId: "OPPONENT_SPELL", name: "对手法术", type: "SPELL", cost: 4 }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(2);
    engine.applyText(`
D 08:18:06.3615000 GameState.DebugPrintPower() - CREATE_GAME
D 08:18:32.0537060 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=星空投影球 id=60 zone=DECK zonePos=0 cardId=TOY_378 player=2] tag=ZONE value=HAND
D 08:20:53.4861770 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=寒冰箭 id=51 zone=HAND zonePos=7 cardId=CORE_CS2_024 player=2] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1
D 08:20:53.4861770 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=寒冰箭 id=51 zone=HAND zonePos=7 cardId=CORE_CS2_024 player=2] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1
D 08:21:39.5040300 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=死神之躯 id=85 zone=HAND zonePos=5 cardId=REV_840 player=2] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1
D 08:21:39.5040300 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=死神之躯 id=85 zone=HAND zonePos=5 cardId=REV_840 player=2] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1
D 08:22:00.0000000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=对手法术 id=90 zone=HAND zonePos=1 cardId=OPPONENT_SPELL player=1] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1
`);

    expect(engine.getState().friendlyHand).toContainEqual(
      expect.objectContaining({
        name: "星空投影球",
        cardId: "TOY_378",
        details: expect.objectContaining({
          playedSpellsThisGame: [
            expect.objectContaining({ name: "寒冰箭", cardId: "CORE_CS2_024" }),
            expect.objectContaining({ name: "死神之躯", cardId: "REV_840" })
          ]
        })
      })
    );
  });

  it("records the actual nested spells cast by a random-spell card", () => {
    const richDb = createCardDatabase([
      {
        id: 103270,
        cardId: "TOY_372",
        name: "匣中古神",
        collectible: 1,
        type: "SPELL",
        text: "随机施放5个法术。"
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        id: 9001 + index,
        cardId: `SPELL_${index + 1}`,
        name: `第${index + 1}张法术`,
        collectible: 1,
        type: "SPELL"
      }))
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(2);
    engine.applyText(`
D 08:18:06.3615000 GameState.DebugPrintPower() - CREATE_GAME
D 08:18:32.0537060 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=匣中古神 id=60 zone=DECK zonePos=0 cardId=TOY_372 player=2] tag=ZONE value=HAND
D 08:20:53.4861770 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=匣中古神 id=60 zone=HAND zonePos=1 cardId=TOY_372 player=2] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1
D 08:20:53.5000000 GameState.DebugPrintPower() -     BLOCK_START BlockType=POWER Entity=[entityName=匣中古神 id=60 zone=PLAY zonePos=0 cardId=TOY_372 player=2]
D 08:20:53.5000000 GameState.DebugPrintPower() -         FULL_ENTITY - Creating ID=71 CardID=SPELL_1
D 08:20:53.5000000 GameState.DebugPrintPower() -         FULL_ENTITY - Creating ID=72 CardID=SPELL_2
D 08:20:53.5000000 GameState.DebugPrintPower() -         FULL_ENTITY - Creating ID=73 CardID=SPELL_3
D 08:20:53.5000000 GameState.DebugPrintPower() -         FULL_ENTITY - Creating ID=74 CardID=SPELL_4
D 08:20:53.5000000 GameState.DebugPrintPower() -         FULL_ENTITY - Creating ID=75 CardID=SPELL_5
D 08:20:53.5200000 GameState.DebugPrintPower() -         BLOCK_START BlockType=POWER Entity=[entityName=第2张法术 id=72 zone=PLAY zonePos=0 cardId=SPELL_2 player=2]
D 08:20:53.5200000 GameState.DebugPrintPower() -             FULL_ENTITY - Creating ID=76 CardID=SPELL_6
D 08:20:53.5300000 GameState.DebugPrintPower() -         BLOCK_END
D 08:20:53.5400000 GameState.DebugPrintPower() -     BLOCK_END
D 08:20:53.5500000 GameState.DebugPrintPower() - BLOCK_END
`);

    const used = engine.getState().cardTracking!.friendly.used;
    expect(used.totalCount).toBe(1);
    const section = used.items[0]?.outcomeSections?.[0];
    expect(section?.cards.map((node) => node.card.cardId)).toEqual([
      "SPELL_1",
      "SPELL_2",
      "SPELL_3",
      "SPELL_4",
      "SPELL_5"
    ]);
    expect(section?.cards?.[1]).toMatchObject({
      card: expect.objectContaining({ cardId: "SPELL_2", name: "第2张法术" })
    });
    expect(section?.cards[1]?.children).toBeUndefined();
  });

  it("keeps ten doubled outcomes, nested random casts, controller isolation, duplicate-log deduplication, and clears on a new game", () => {
    const richDb = createCardDatabase([
      {
        id: 103270,
        cardId: "TOY_372",
        name: "匣中古神",
        collectible: 1,
        type: "SPELL",
        text: "随机施放5个法术。"
      },
      ...Array.from({ length: 11 }, (_, index) => ({
        id: 9100 + index,
        cardId: `RANDOM_SPELL_${index + 1}`,
        name: `随机法术${index + 1}`,
        collectible: 1,
        type: "SPELL"
      }))
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(2);
    const blockLines = [
      ["08:20:01.0000000", "BLOCK_START BlockType=PLAY Entity=[entityName=匣中古神 id=60 zone=HAND cardId=TOY_372 player=2]"],
      ["08:20:02.0000000", "    BLOCK_START BlockType=POWER Entity=[entityName=匣中古神 id=60 zone=PLAY cardId=TOY_372 player=2]"],
      ...Array.from({ length: 5 }, (_, index) => [
        "08:20:02.0000000",
        `        FULL_ENTITY - Creating ID=${71 + index} CardID=RANDOM_SPELL_${index + 1}`
      ]),
      ["08:20:03.0000000", "    BLOCK_END"],
      ["08:20:04.0000000", "    BLOCK_START BlockType=POWER Entity=[entityName=匣中古神 id=60 zone=PLAY cardId=TOY_372 player=2]"],
      ...Array.from({ length: 4 }, (_, index) => [
        "08:20:04.0000000",
        `        FULL_ENTITY - Creating ID=${81 + index} CardID=RANDOM_SPELL_${index === 0 ? 1 : index + 6}`
      ]),
      ["08:20:04.0000000", "        FULL_ENTITY - Creating ID=90 CardID=TOY_372"],
      ["08:20:05.0000000", "        BLOCK_START BlockType=POWER Entity=[entityName=匣中古神 id=90 zone=PLAY cardId=TOY_372 player=2]"],
      ["08:20:05.0000000", "            FULL_ENTITY - Creating ID=91 CardID=RANDOM_SPELL_10"],
      ["08:20:06.0000000", "        BLOCK_END"],
      ["08:20:07.0000000", "    BLOCK_END"],
      ["08:20:08.0000000", "BLOCK_END"]
    ] as const;
    const renderBlock = (source: "GameState" | "PowerTaskList") =>
      blockLines.map(([time, payload]) => `D ${time} ${source}.DebugPrintPower() - ${payload}`);
    engine.applyText([
      "D 08:18:06.3615000 GameState.DebugPrintPower() - CREATE_GAME",
      "D 08:18:32.0537060 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=匣中古神 id=60 zone=DECK cardId=TOY_372 player=2] tag=ZONE value=HAND",
      ...renderBlock("GameState"),
      ...renderBlock("PowerTaskList"),
      "D 08:21:00.0000000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=匣中古神 id=160 zone=HAND cardId=TOY_372 player=1]",
      "D 08:21:01.0000000 GameState.DebugPrintPower() - BLOCK_START BlockType=POWER Entity=[entityName=匣中古神 id=160 zone=PLAY cardId=TOY_372 player=1]",
      "D 08:21:01.0000000 GameState.DebugPrintPower() - FULL_ENTITY - Creating ID=161 CardID=RANDOM_SPELL_11",
      "D 08:21:01.0000000 GameState.DebugPrintPower() - BLOCK_END",
      "D 08:21:02.0000000 GameState.DebugPrintPower() - BLOCK_END",
      "D 08:21:03.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=匣中古神 id=160 zone=HAND cardId=TOY_372 player=1] tag=ZONE value=PLAY"
    ].join("\n"));

    const friendlyUsed = engine.getState().cardTracking!.friendly.used;
    const opponentUsed = engine.getState().cardTracking!.opponent.used;
    expect(friendlyUsed.totalCount).toBe(1);
    expect(opponentUsed.totalCount).toBe(1);
    const outcomeSection = friendlyUsed.items[0]?.outcomeSections?.[0];
    expect(outcomeSection?.cards).toHaveLength(10);
    expect(outcomeSection?.cards.filter((node) => node.card.cardId === "RANDOM_SPELL_1")).toHaveLength(2);
    expect(outcomeSection?.cards?.[9]).toMatchObject({
      card: expect.objectContaining({ cardId: "TOY_372" }),
      children: [
        expect.objectContaining({ card: expect.objectContaining({ cardId: "RANDOM_SPELL_10" }) })
      ]
    });
    expect(friendlyUsed.items[0]?.outcomeSections).toHaveLength(1);
    expect(opponentUsed.items[0]?.outcomeSections?.[0]?.cards).toEqual([
      expect.objectContaining({ card: expect.objectContaining({ cardId: "RANDOM_SPELL_11" }) })
    ]);
    expect((engine.getState().friendlyHand ?? [])
      .find((card) => card.cardId === "TOY_372")
      ?.details).not.toHaveProperty("cardOutcomeSections");
    expect((engine.getState().opponentPlayed ?? [])
      .find((card) => card.cardId === "TOY_372")
      ?.details).not.toHaveProperty("cardOutcomeSections");

    engine.applyText(`
D 08:26:11.3028700 GameState.DebugPrintPower() - CREATE_GAME
D 08:26:12.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=匣中古神 id=260 zone=DECK cardId=TOY_372 player=2] tag=ZONE value=HAND
`);
    expect(engine.getState().cardTracking!.friendly.used.totalCount).toBe(0);
    expect(engine.getState().cardTracking!.opponent.used.totalCount).toBe(0);
  });

  it("keeps same-timestamp real captures while deduplicating their cross-source copies", () => {
    const engine = createOutcomeBindingEngine();
    const firstCapture = renderRandomSpellCapture({
      source: "GameState",
      time: "09:00:01",
      sourceEntityId: 60,
      resultEntityStart: 71,
      resultCardIds: ["SPELL_1", "SPELL_2", "SPELL_3", "SPELL_4", "SPELL_5"],
      controller: 1
    });
    const firstDuplicate = firstCapture.map((line) => line.replace("GameState", "PowerTaskList"));
    const secondCapture = renderRandomSpellCapture({
      source: "GameState",
      time: "09:00:01",
      sourceEntityId: 60,
      resultEntityStart: 81,
      resultCardIds: ["SPELL_1", "SPELL_2", "SPELL_3", "SPELL_4", "SPELL_5"],
      controller: 1
    });
    const secondDuplicate = secondCapture.map((line) => line.replace("GameState", "PowerTaskList"));

    engine.applyText([
      "D 09:00:00.000 GameState.DebugPrintPower() - CREATE_GAME",
      ...firstCapture,
      ...firstDuplicate,
      ...secondCapture,
      ...secondDuplicate
    ].join("\n"));

    const used = engine.getState().cardTracking!.friendly.used;
    expect(used.totalCount).toBe(1);
    expect(used.items[0]?.outcomeSections).toHaveLength(1);
    expect(used.items[0]?.outcomeSections?.[0]?.cards.map((node) => node.card.cardId)).toEqual([
      "SPELL_1",
      "SPELL_2",
      "SPELL_3",
      "SPELL_4",
      "SPELL_5",
      "SPELL_1",
      "SPELL_2",
      "SPELL_3",
      "SPELL_4",
      "SPELL_5"
    ]);
  });

  it("keeps mismatched cross-source captures with different outcome content", () => {
    const engine = createOutcomeBindingEngine();
    engine.applyText([
      "D 09:10:00.000 GameState.DebugPrintPower() - CREATE_GAME",
      ...renderRandomSpellCapture({
        source: "GameState",
        time: "09:10:01",
        sourceEntityId: 60,
        resultEntityStart: 201,
        resultCardIds: ["SPELL_1"],
        controller: 1
      }),
      ...renderRandomSpellCapture({
        source: "PowerTaskList",
        time: "09:10:01",
        sourceEntityId: 60,
        resultEntityStart: 202,
        resultCardIds: ["SPELL_2"],
        controller: 1
      })
    ].join("\n"));

    const used = engine.getState().cardTracking!.friendly.used;
    expect(used.totalCount).toBe(1);
    expect(used.items[0]?.outcomeSections?.[0]?.cards.map((node) => node.card.cardId))
      .toEqual(["SPELL_1", "SPELL_2"]);
  });

  it("does not deduplicate a returned entity's second usage against its first usage", () => {
    const engine = createOutcomeBindingEngine();
    engine.applyText([
      "D 09:20:00.000 GameState.DebugPrintPower() - CREATE_GAME",
      ...renderRandomSpellCapture({
        source: "GameState",
        time: "09:20:01",
        sourceEntityId: 60,
        resultEntityStart: 211,
        resultCardIds: ["SPELL_1"],
        controller: 1
      }),
      "D 09:20:01.950 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=匣中古神 id=60 zone=HAND cardId=TOY_372 player=1] tag=ZONE value=PLAY",
      "D 09:20:02.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=匣中古神 id=60 zone=PLAY cardId=TOY_372 player=1] tag=ZONE value=HAND",
      ...renderRandomSpellCapture({
        source: "PowerTaskList",
        time: "09:20:01",
        sourceEntityId: 60,
        resultEntityStart: 212,
        resultCardIds: ["SPELL_1"],
        controller: 1
      })
    ].join("\n"));

    const used = engine.getState().cardTracking!.friendly.used;
    expect(used.totalCount).toBe(2);
    expect(new Set(used.items.map((item) => item.id)).size).toBe(2);
    expect(used.items.map((item) =>
      item.outcomeSections?.[0]?.cards.map((node) => node.card.cardId)
    )).toEqual([["SPELL_1"], ["SPELL_1"]]);
  });

  it("keeps returned and same-name Yogg uses bound to their own usageIds", () => {
    const engine = createOutcomeBindingEngine();
    engine.applyText([
      "D 10:00:00.000 GameState.DebugPrintPower() - CREATE_GAME",
      "D 10:00:00.500 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=匣中古神 id=60 zone=DECK cardId=TOY_372 player=1] tag=ZONE value=HAND",
      ...renderRandomSpellCapture({
        source: "GameState",
        time: "10:00:01",
        sourceEntityId: 60,
        resultEntityStart: 101,
        resultCardIds: ["SPELL_1"],
        controller: 1
      }),
      "D 10:00:01.950 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=匣中古神 id=60 zone=HAND cardId=TOY_372 player=1] tag=ZONE value=PLAY",
      "D 10:00:02.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=匣中古神 id=60 zone=PLAY cardId=TOY_372 player=1] tag=ZONE value=HAND",
      ...renderRandomSpellCapture({
        source: "GameState",
        time: "10:00:03",
        sourceEntityId: 60,
        resultEntityStart: 102,
        resultCardIds: ["SPELL_2"],
        controller: 1
      }),
      "D 10:00:04.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=匣中古神 id=160 zone=DECK cardId=TOY_372 player=1] tag=ZONE value=HAND",
      ...renderRandomSpellCapture({
        source: "GameState",
        time: "10:00:05",
        sourceEntityId: 160,
        resultEntityStart: 103,
        resultCardIds: ["SPELL_3"],
        controller: 1
      })
    ].join("\n"));

    const used = engine.getState().cardTracking!.friendly.used;
    expect(used.totalCount).toBe(3);
    expect(new Set(used.items.map((item) => item.id)).size).toBe(3);
    expect(used.items.map((item) => ({
      entityId: item.entityId,
      cards: item.outcomeSections?.[0]?.cards.map((node) => node.card.cardId)
    }))).toEqual([
      { entityId: "160", cards: ["SPELL_3"] },
      { entityId: "60", cards: ["SPELL_2"] },
      { entityId: "60", cards: ["SPELL_1"] }
    ]);
    expect((engine.getState().friendlyHand ?? [])
      .find((card) => card.cardId === "TOY_372")
      ?.details).not.toHaveProperty("cardOutcomeSections");
  });

  it("does not attach an empty random-spell outcome section to an ordinary spell use", () => {
    const engine = createOutcomeBindingEngine();
    engine.applyText(`
D 11:30:00.000 GameState.DebugPrintPower() - CREATE_GAME
D 11:30:00.100 GameState.DebugPrintPower() - BLOCK_START BlockType=POWER Entity=[entityName=匣中古神 id=300 zone=PLAY cardId=TOY_372 player=1]
D 11:30:00.200 GameState.DebugPrintPower() - FULL_ENTITY - Creating ID=301 CardID=SPELL_1
D 11:30:00.300 GameState.DebugPrintPower() - BLOCK_END
D 11:30:01.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=普通法术 id=200 zone=HAND cardId=NORMAL_SPELL player=1]
D 11:30:01.100 GameState.DebugPrintPower() - BLOCK_END
`);

    const used = engine.getState().cardTracking!.friendly.used;
    expect(used.totalCount).toBe(1);
    expect(used.items[0]).toMatchObject({
      entityId: "200",
      card: expect.objectContaining({ cardId: "NORMAL_SPELL", name: "普通法术" })
    });
    expect(used.items[0]?.outcomeSections).toBeUndefined();
  });

  it("同一法术实体回手后再次施放会重复记录且新局清空历史", () => {
    const richDb = createCardDatabase([
      { id: 103354, cardId: "TOY_378", name: "星空投影球", type: "SPELL", cost: 10 },
      { id: 1, cardId: "CORE_CS2_024", name: "寒冰箭", type: "SPELL", cost: 2 }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(2);
    engine.applyText(`
D 08:18:06.3615000 GameState.DebugPrintPower() - CREATE_GAME
D 08:18:32.0537060 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=星空投影球 id=60 zone=DECK zonePos=0 cardId=TOY_378 player=2] tag=ZONE value=HAND
D 08:20:53.4861770 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=寒冰箭 id=51 zone=HAND zonePos=7 cardId=CORE_CS2_024 player=2] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1
D 08:20:53.4861770 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=寒冰箭 id=51 zone=HAND zonePos=7 cardId=CORE_CS2_024 player=2] tag=ZONE value=PLAY
D 08:20:53.4861770 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=寒冰箭 id=51 zone=PLAY zonePos=0 cardId=CORE_CS2_024 player=2] tag=ZONE value=GRAVEYARD
D 08:20:53.4861770 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=寒冰箭 id=51 zone=HAND zonePos=7 cardId=CORE_CS2_024 player=2] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1
D 08:21:00.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=寒冰箭 id=51 zone=GRAVEYARD zonePos=0 cardId=CORE_CS2_024 player=2] tag=ZONE value=HAND
D 08:21:01.0000000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=寒冰箭 id=51 zone=HAND zonePos=1 cardId=CORE_CS2_024 player=2] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1
D 08:21:01.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=寒冰箭 id=51 zone=HAND zonePos=1 cardId=CORE_CS2_024 player=2] tag=ZONE value=PLAY
D 08:21:01.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=寒冰箭 id=51 zone=PLAY zonePos=0 cardId=CORE_CS2_024 player=2] tag=ZONE value=GRAVEYARD
D 08:21:01.0000000 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=寒冰箭 id=51 zone=HAND zonePos=1 cardId=CORE_CS2_024 player=2] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1
`);

    expect(engine.getState().friendlyHand).toContainEqual(
      expect.objectContaining({
        cardId: "TOY_378",
        details: expect.objectContaining({
          playedSpellsThisGame: [
            expect.objectContaining({ name: "寒冰箭", cardId: "CORE_CS2_024" }),
            expect.objectContaining({ name: "寒冰箭", cardId: "CORE_CS2_024" })
          ]
        })
      })
    );

    engine.applyText(`
D 08:26:11.3028700 GameState.DebugPrintPower() - CREATE_GAME
D 08:26:12.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=星空投影球 id=160 zone=DECK zonePos=0 cardId=TOY_378 player=2] tag=ZONE value=HAND
`);

    expect(engine.getState().friendlyHand).toContainEqual(
      expect.objectContaining({
        cardId: "TOY_378",
        details: expect.objectContaining({ playedSpellsThisGame: [] })
      })
    );
  });

  it("removes a revealed card burned directly from deck while keeping it in the graveyard section", () => {
    const richDb = createCardDatabase([
      { id: 126662, cardId: "JAIL_732", name: "虚空灵魂", collectible: 1, type: "SPELL" }
    ]);
    const engine = new TrackerEngine({ deckText: "1x 虚空灵魂", cardDatabase: richDb });
    engine.setFriendlyController(2);
    engine.applyText(`
D 19:52:00.0000000 GameState.DebugPrintPower() - CREATE_GAME
D 19:52:01.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=43 zone=DECK zonePos=1 cardId= player=2] tag=ZONE value=GRAVEYARD
D 19:52:01.0000000 GameState.DebugPrintPower() - SHOW_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=43 zone=GRAVEYARD zonePos=0 cardId= player=2] CardID=JAIL_732
`);

    expect(engine.getState()).toMatchObject({
      deck: [expect.objectContaining({ cardId: "JAIL_732", remaining: 0, drawn: 1 })],
      friendlyHand: [],
      friendlyOther: [expect.objectContaining({ cardId: "JAIL_732", name: "虚空灵魂" })],
      summary: expect.objectContaining({ remainingCards: 0, drawnCards: 1 })
    });
  });

  it("replays the reported Power.log death order for Endgame and ignores duplicate and opponent deaths", () => {
    const richDb = createCardDatabase([
      { id: 106652, cardId: "TOY_886", name: "决胜时刻", type: "SPELL", text: "复活上一个死亡的你的恶魔。" },
      { id: 124073, cardId: "JAIL_906", name: "摩拉格", type: "MINION", minion_type_id: 15 },
      { id: 125917, cardId: "JAIL_399", name: "小鬼马仔", type: "MINION", minion_type_id: 15 },
      { id: 200001, cardId: "OPPONENT_DEMON", name: "对手恶魔", type: "MINION", minion_type_id: 15 }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(2);
    engine.applyText(`
D 20:07:57.0409600 GameState.DebugPrintPower() - CREATE_GAME
D 20:08:00.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=决胜时刻 id=49 zone=DECK zonePos=0 cardId=TOY_886 player=2] tag=ZONE value=HAND
D 20:13:43.9477010 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=摩拉格 id=55 zone=PLAY zonePos=1 cardId=JAIL_906 player=2] tag=ZONE value=GRAVEYARD
D 20:13:45.7896170 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=摩拉格 id=55 zone=PLAY zonePos=1 cardId=JAIL_906 player=2] tag=ZONE value=GRAVEYARD
D 20:14:00.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=对手恶魔 id=155 zone=PLAY zonePos=1 cardId=OPPONENT_DEMON player=1] tag=ZONE value=GRAVEYARD
D 20:14:19.9741080 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=小鬼马仔 id=42 zone=PLAY zonePos=2 cardId=JAIL_399 player=2] tag=ZONE value=GRAVEYARD
D 20:14:22.9982780 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=小鬼马仔 id=42 zone=PLAY zonePos=2 cardId=JAIL_399 player=2] tag=ZONE value=GRAVEYARD
`);

    expect(engine.getState().friendlyHand).toContainEqual(
      expect.objectContaining({
        cardId: "TOY_886",
        details: expect.objectContaining({
          gameContextSections: [
            expect.objectContaining({
              key: "dead-minions",
              title: "将复活",
              cards: [expect.objectContaining({ cardId: "JAIL_399", name: "小鬼马仔" })]
            })
          ]
        })
      })
    );
  });

  it("shows the friendly post-mulligan opening hand for The Fins Beyond Time", () => {
    const richDb = createCardDatabase([
      {
        id: 140706,
        cardId: "TIME_706",
        name: "超时空鳍侠",
        type: "MINION",
        cost: 2,
        text: "战吼：将你的手牌替换为你的起始手牌。在你的回合结束时换回。"
      },
      { id: 200001, cardId: "START_A", name: "起手牌甲", type: "SPELL", cost: 1 },
      { id: 200002, cardId: "MULLIGAN_B", name: "被换掉的牌", type: "MINION", cost: 2 },
      { id: 200003, cardId: "START_C", name: "起手牌乙", type: "WEAPON", cost: 3 },
      { id: 200004, cardId: "START_D", name: "换入的起手牌", type: "SPELL", cost: 4 },
      { id: 200005, cardId: "TIME_COIN1", name: "幸运币", type: "SPELL", cost: 0 }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(2);
    engine.applyText(`
D 15:02:59.000 GameState.DebugPrintPower() - CREATE_GAME
D 15:03:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=起手牌甲 id=40 zone=DECK cardId=START_A player=2] tag=ZONE value=HAND
D 15:03:00.100 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=被换掉的牌 id=41 zone=DECK cardId=MULLIGAN_B player=2] tag=ZONE value=HAND
D 15:03:00.200 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=起手牌乙 id=42 zone=DECK cardId=START_C player=2] tag=ZONE value=HAND
D 15:03:00.300 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=幸运币 id=46 zone=DECK cardId=TIME_COIN1 player=2] tag=ZONE value=HAND
D 15:03:00.400 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=NEXT_STEP value=MAIN_READY
D 15:03:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=被换掉的牌 id=41 zone=HAND cardId=MULLIGAN_B player=2] tag=ZONE value=DECK
D 15:03:01.100 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=换入的起手牌 id=43 zone=DECK cardId=START_D player=2] tag=ZONE value=HAND
D 15:03:01.200 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=起手牌甲 id=45 zone=DECK cardId=START_A player=2] tag=ZONE value=HAND
D 15:03:02.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=MAIN_READY
D 15:03:02.100 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=起手牌甲 id=40 zone=HAND cardId=START_A player=2] tag=ZONE value=PLAY
D 15:03:02.200 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=起手牌乙 id=42 zone=HAND cardId=START_C player=2] tag=ZONE value=PLAY
D 15:03:02.300 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=换入的起手牌 id=43 zone=HAND cardId=START_D player=2] tag=ZONE value=PLAY
D 15:03:03.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=超时空鳍侠 id=44 zone=DECK cardId=TIME_706 player=2] tag=ZONE value=HAND
D 15:03:04.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=MAIN_ACTION
`);

    const state = engine.getState();
    expect(state.friendlyHand).toContainEqual(
      expect.objectContaining({
        cardId: "TIME_706",
        details: expect.objectContaining({
          gameContextSections: [
            expect.objectContaining({
              key: "friendly-opening-hand",
              title: "我的起始手牌",
              cards: [
                expect.objectContaining({ cardId: "START_A", name: "起手牌甲" }),
                expect.objectContaining({ cardId: "START_C", name: "起手牌乙" }),
                expect.objectContaining({ cardId: "START_D", name: "换入的起手牌" }),
                expect.objectContaining({ cardId: "START_A", name: "起手牌甲" })
              ]
            })
          ]
        })
      })
    );
    expect(state.cardTracking?.contextDetailsBySideAndCardKey.friendly["id:time_706"])
      .toMatchObject({
        gameContextSections: [expect.objectContaining({
          key: "friendly-opening-hand",
          cards: [
            expect.objectContaining({ cardId: "START_A" }),
            expect.objectContaining({ cardId: "START_C" }),
            expect.objectContaining({ cardId: "START_D" }),
            expect.objectContaining({ cardId: "START_A" })
          ]
        })]
      });
    expect(state.cardTracking?.contextDetailsBySideAndCardKey.opponent)
      .not.toHaveProperty("id:time_706");

    engine.applyText(`
D 16:00:00.000 GameState.DebugPrintPower() - CREATE_GAME
D 16:00:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=超时空鳍侠 id=140 zone=DECK cardId=TIME_706 player=2] tag=ZONE value=HAND
D 16:00:02.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=MAIN_ACTION
`);
    expect(engine.getState().cardTracking?.contextDetailsBySideAndCardKey.friendly["id:time_706"])
      .toMatchObject({
        gameContextSections: [expect.objectContaining({
          cards: [expect.objectContaining({ cardId: "TIME_706" })]
        })]
      });
  });

  it("shows the real Kel'Thuzad resurrection count from Power.log and keeps duplicate sources idempotent", () => {
    const richDb = createCardDatabase([
      {
        id: 79767,
        cardId: "REV_514",
        name: "天定之灾克尔苏加德",
        type: "MINION",
        cost: 8,
        text: "战吼：复活你的不稳定的骷髅。战场上放不下的骷髅会立即爆炸。（复活 个）"
      }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(2);
    engine.applyText(`
D 15:02:59.000 GameState.DebugPrintPower() - CREATE_GAME
D 15:03:00.000 GameState.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=天定之灾克尔苏加德 id=40 zone=HAND cardId=REV_514 player=1] CardID=REV_514
D 15:03:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=天定之灾克尔苏加德 id=40 zone=HAND cardId=REV_514 player=1] tag=TAG_SCRIPT_DATA_NUM_1 value=5
D 15:03:01.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=天定之灾克尔苏加德 id=40 zone=HAND cardId=REV_514 player=1] tag=TAG_SCRIPT_DATA_NUM_1 value=5
`);

    const state = engine.getState();
    expect(state.opponentHand).toContainEqual(
      expect.objectContaining({
        cardId: "REV_514",
        details: expect.objectContaining({
          gameContextSections: [
            expect.objectContaining({
              key: "kelthuzad-resurrection-count",
              title: "会复活",
              totalCount: 5,
              cards: []
            })
          ]
        })
      })
    );
    expect(state.cardTracking?.contextDetailsBySideAndCardKey.opponent["id:rev_514"])
      .toMatchObject({
        gameContextSections: [expect.objectContaining({ totalCount: 5 })]
      });
    expect(state.cardTracking?.contextDetailsBySideAndCardKey.friendly)
      .not.toHaveProperty("id:rev_514");
  });

  it("reads Kel'Thuzad's resurrection count from FULL_ENTITY continuation tags and clears it next game", () => {
    const richDb = createCardDatabase([
      { id: 79767, cardId: "REV_514", name: "天定之灾克尔苏加德", type: "MINION" },
      { id: 79768, cardId: "CORE_REV_514", name: "天定之灾克尔苏加德", type: "MINION" }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(2);
    engine.applyText(`
D 16:00:00.000 GameState.DebugPrintPower() - CREATE_GAME
D 16:00:01.000 GameState.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=天定之灾克尔苏加德 id=40 zone=HAND cardId=REV_514 player=1] CardID=REV_514
D 16:00:01.100 GameState.DebugPrintPower() -     tag=CONTROLLER value=1
D 16:00:01.200 GameState.DebugPrintPower() -     tag=TAG_SCRIPT_DATA_NUM_1 value=7
`);
    expect(engine.getState().cardTracking?.contextDetailsBySideAndCardKey.opponent["id:rev_514"])
      .toMatchObject({
        gameContextSections: [expect.objectContaining({ totalCount: 7 })]
      });

    engine.applyText(`
D 16:00:02.000 GameState.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=天定之灾克尔苏加德 id=41 zone=HAND cardId=CORE_REV_514 player=1] CardID=CORE_REV_514
D 16:00:02.100 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY id=41 zone=HAND cardId= player=1] tag=TAG_SCRIPT_DATA_NUM_1 value=9
`);
    expect(engine.getState().cardTracking?.contextDetailsBySideAndCardKey.opponent["id:core_rev_514"])
      .toMatchObject({
        gameContextSections: [expect.objectContaining({ totalCount: 9 })]
      });

    engine.applyText(`
D 16:10:00.000 GameState.DebugPrintPower() - CREATE_GAME
D 16:10:01.000 GameState.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=天定之灾克尔苏加德 id=140 zone=HAND cardId=REV_514 player=1] CardID=REV_514
`);
    expect(engine.getState().cardTracking?.contextDetailsBySideAndCardKey.opponent["id:rev_514"])
      .toBeUndefined();
  });

  it("reports known opponent cards in deck, hand, and other current zones", () => {
    const richDb = createCardDatabase([
      { id: 1, cardId: "OPP_DECK", name: "对手牌库牌", type: "SPELL" },
      { id: 2, cardId: "OPP_HAND", name: "对手手牌", type: "MINION" },
      { id: 3, cardId: "OPP_PLAY", name: "对手场上牌", type: "LOCATION" }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(1);
    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=对手牌库牌 id=10 zone=DECK cardId=OPP_DECK player=2] CardID=OPP_DECK
D 12:00:02.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=对手手牌 id=11 zone=HAND cardId=OPP_HAND player=2] CardID=OPP_HAND
D 12:00:03.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=对手场上牌 id=12 zone=PLAY cardId=OPP_PLAY player=2] CardID=OPP_PLAY
`);

    expect(engine.getState()).toMatchObject({
      opponentDeck: [{ name: "对手牌库牌", count: 1, cardId: "OPP_DECK" }],
      opponentHand: [{ name: "对手手牌", count: 1, cardId: "OPP_HAND" }],
      opponentOther: [{ name: "对手场上牌", count: 1, cardId: "OPP_PLAY" }],
      opponentDeckCount: 1,
      opponentHandCount: 1
    });
  });

  it("counts hidden opponent deck and hand entities without inventing deck identities", () => {
    const engine = new TrackerEngine();
    engine.setFriendlyController(1);
    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY id=20 zone=DECK cardId= player=2] CardID=
D 12:00:02.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY id=21 zone=DECK cardId= player=2] CardID=
D 12:00:03.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY id=22 zone=HAND cardId= player=2] CardID=
D 12:00:04.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY id=23 zone=HAND cardId= player=2] CardID=
`);

    expect(engine.getState()).toMatchObject({
      opponentDeck: [],
      opponentHand: [],
      opponentDeckCount: 2,
      opponentHandCount: 2
    });
  });

  it("replaces one hidden opponent hand row when that entity is revealed", () => {
    const richDb = createCardDatabase([
      { id: 1, cardId: "REVEALED", name: "被揭示的牌", type: "SPELL" }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(1);
    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY id=30 zone=HAND cardId= player=2] CardID=
D 12:00:02.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY id=31 zone=HAND cardId= player=2] CardID=
`);
    engine.applyLine(
      "D 12:00:03.000 PowerTaskList.DebugPrintPower() - SHOW_ENTITY - Updating Entity=[entityName=被揭示的牌 id=30 zone=HAND cardId= player=2] CardID=REVEALED"
    );

    expect(engine.getState()).toMatchObject({
      opponentHand: [{ name: "被揭示的牌", count: 1, cardId: "REVEALED" }],
      opponentHandCount: 2
    });
  });

  it("keeps a revealed opponent card known when a linked deathrattle returns it as a new hand entity", () => {
    const richDb = createCardDatabase([
      { id: 1, cardId: "END_033", name: "先觉蜿变幼龙", type: "MINION" }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(1);
    engine.applyText(`
D 12:34:02.2890600 PowerTaskList.DebugPrintPower() - CREATE_GAME
D 12:34:02.2890600 PowerTaskList.DebugPrintPower() -     SHOW_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=97 zone=SETASIDE zonePos=0 cardId= player=2] CardID=END_033
D 12:34:02.2890600 PowerTaskList.DebugPrintPower() -         tag=CONTROLLER value=2
D 12:34:02.2890600 PowerTaskList.DebugPrintPower() -         tag=CARDTYPE value=MINION
D 12:34:02.2890600 PowerTaskList.DebugPrintPower() -         tag=ZONE value=SETASIDE
D 12:34:02.2890600 PowerTaskList.DebugPrintPower() -         tag=ENTITY_ID value=97
D 12:34:02.2890600 PowerTaskList.DebugPrintPower() -     FULL_ENTITY - Updating [entityName=绑架犯的袋子 id=98 zone=PLAY zonePos=3 cardId=REV_828t player=1] CardID=REV_828t
D 12:34:02.2890600 PowerTaskList.DebugPrintPower() -         tag=CONTROLLER value=1
D 12:34:02.2890600 PowerTaskList.DebugPrintPower() -         tag=CARDTYPE value=MINION
D 12:34:02.2890600 PowerTaskList.DebugPrintPower() -         tag=ZONE value=PLAY
D 12:34:02.2890600 PowerTaskList.DebugPrintPower() -         tag=ENTITY_ID value=98
D 12:34:02.2890600 PowerTaskList.DebugPrintPower() -     SHOW_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=99 zone=SETASIDE zonePos=0 cardId= player=1] CardID=REV_828e
D 12:34:02.2890600 PowerTaskList.DebugPrintPower() -         tag=CONTROLLER value=1
D 12:34:02.2890600 PowerTaskList.DebugPrintPower() -         tag=CARDTYPE value=ENCHANTMENT
D 12:34:02.2890600 PowerTaskList.DebugPrintPower() -         tag=ATTACHED value=98
D 12:34:02.2890600 PowerTaskList.DebugPrintPower() -         tag=ZONE value=SETASIDE
D 12:34:02.2890600 PowerTaskList.DebugPrintPower() -         tag=ENTITY_ID value=99
D 12:34:02.2890600 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=99 zone=SETASIDE zonePos=0 cardId= player=1] tag=ZONE value=PLAY
D 12:34:02.2890600 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=99 zone=SETASIDE zonePos=0 cardId= player=1] tag=TAG_SCRIPT_DATA_NUM_1 value=97
D 12:34:06.7058310 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=绑架犯的袋子 id=98 zone=PLAY zonePos=3 cardId=REV_828t player=1] tag=ZONE value=GRAVEYARD
D 12:34:06.7058310 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=绑架犯的袋子 id=99 zone=PLAY zonePos=0 cardId=REV_828e player=1] tag=1234 value=98
D 12:34:06.7058310 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=TRIGGER Entity=[entityName=绑架犯的袋子 id=98 zone=PLAY zonePos=3 cardId=REV_828t player=1] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1 TriggerKeyword=DEATHRATTLE
D 12:34:06.7058310 PowerTaskList.DebugPrintPower() -     FULL_ENTITY - Creating ID=100 CardID=
D 12:34:06.7058310 PowerTaskList.DebugPrintPower() -         tag=ZONE value=HAND
D 12:34:06.7058310 PowerTaskList.DebugPrintPower() -         tag=CONTROLLER value=2
D 12:34:06.7058310 PowerTaskList.DebugPrintPower() -         tag=ENTITY_ID value=100
D 12:34:06.7058310 PowerTaskList.DebugPrintPower() - BLOCK_END
`);

    expect(engine.getState()).toMatchObject({
      opponentHand: [{ name: "先觉蜿变幼龙", count: 1, cardId: "END_033" }],
      opponentHandCount: 1
    });
  });

  it("ignores other created entities before the linked deathrattle creates one hidden hand card", () => {
    const richDb = createCardDatabase([
      { id: 1, cardId: "KNOWN_RETURN", name: "应返回的随从", type: "MINION" }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(1);
    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() - SHOW_ENTITY - Updating Entity=[entityName=应返回的随从 id=97 zone=SETASIDE cardId= player=2] CardID=KNOWN_RETURN
D 12:00:02.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=亡语随从 id=98 zone=PLAY cardId=TRIGGER_MINION player=1] CardID=TRIGGER_MINION
D 12:00:03.000 PowerTaskList.DebugPrintPower() - SHOW_ENTITY - Updating Entity=[entityName=关联附魔 id=99 zone=PLAY cardId=LINK_ENCHANTMENT player=1] CardID=LINK_ENCHANTMENT
D 12:00:03.000 PowerTaskList.DebugPrintPower() -         tag=ATTACHED value=98
D 12:00:03.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=关联附魔 id=99 zone=PLAY cardId=LINK_ENCHANTMENT player=1] tag=TAG_SCRIPT_DATA_NUM_1 value=97
D 12:00:04.000 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=TRIGGER Entity=[entityName=亡语随从 id=98 zone=GRAVEYARD cardId=TRIGGER_MINION player=1] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1 TriggerKeyword=DEATHRATTLE
D 12:00:04.000 PowerTaskList.DebugPrintPower() -     FULL_ENTITY - Creating ID=150 CardID=
D 12:00:04.000 PowerTaskList.DebugPrintPower() -         tag=ZONE value=SETASIDE
D 12:00:04.000 PowerTaskList.DebugPrintPower() -         tag=CONTROLLER value=1
D 12:00:04.000 PowerTaskList.DebugPrintPower() -     FULL_ENTITY - Creating ID=100 CardID=
D 12:00:04.000 PowerTaskList.DebugPrintPower() -         tag=ZONE value=HAND
D 12:00:04.000 PowerTaskList.DebugPrintPower() -         tag=CONTROLLER value=2
D 12:00:04.000 PowerTaskList.DebugPrintPower() - BLOCK_END
`);

    expect(engine.getState()).toMatchObject({
      opponentHand: [{ name: "应返回的随从", count: 1, cardId: "KNOWN_RETURN" }],
      opponentHandCount: 1
    });
  });

  it("does not transfer a known identity when a linked deathrattle creates two hidden hand cards", () => {
    const richDb = createCardDatabase([
      { id: 1, cardId: "KNOWN_RETURN", name: "不应猜测的随从", type: "MINION" }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(1);
    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() - SHOW_ENTITY - Updating Entity=[entityName=不应猜测的随从 id=97 zone=SETASIDE cardId= player=2] CardID=KNOWN_RETURN
D 12:00:02.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=亡语随从 id=98 zone=PLAY cardId=TRIGGER_MINION player=1] CardID=TRIGGER_MINION
D 12:00:03.000 PowerTaskList.DebugPrintPower() - SHOW_ENTITY - Updating Entity=[entityName=关联附魔 id=99 zone=PLAY cardId=LINK_ENCHANTMENT player=1] CardID=LINK_ENCHANTMENT
D 12:00:03.000 PowerTaskList.DebugPrintPower() -         tag=ATTACHED value=98
D 12:00:03.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=关联附魔 id=99 zone=PLAY cardId=LINK_ENCHANTMENT player=1] tag=TAG_SCRIPT_DATA_NUM_1 value=97
D 12:00:04.000 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=TRIGGER Entity=[entityName=亡语随从 id=98 zone=GRAVEYARD cardId=TRIGGER_MINION player=1] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1 TriggerKeyword=DEATHRATTLE
D 12:00:04.000 PowerTaskList.DebugPrintPower() -     FULL_ENTITY - Creating ID=100 CardID=
D 12:00:04.000 PowerTaskList.DebugPrintPower() -         tag=ZONE value=HAND
D 12:00:04.000 PowerTaskList.DebugPrintPower() -         tag=CONTROLLER value=2
D 12:00:04.000 PowerTaskList.DebugPrintPower() -     FULL_ENTITY - Creating ID=101 CardID=
D 12:00:04.000 PowerTaskList.DebugPrintPower() -         tag=ZONE value=HAND
D 12:00:04.000 PowerTaskList.DebugPrintPower() -         tag=CONTROLLER value=2
D 12:00:04.000 PowerTaskList.DebugPrintPower() - BLOCK_END
`);

    expect(engine.getState()).toMatchObject({
      opponentHand: [],
      opponentHandCount: 2
    });
  });

  it("keeps a revealed opponent card known when the same entity returns to hand", () => {
    const richDb = createCardDatabase([
      { id: 1, cardId: "KNOWN_MINION", name: "已公开随从", type: "MINION" }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(1);
    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=已公开随从 id=40 zone=PLAY cardId=KNOWN_MINION player=2] CardID=KNOWN_MINION
D 12:00:02.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY id=40 zone=PLAY cardId= player=2] tag=ZONE value=HAND
`);

    expect(engine.getState()).toMatchObject({
      opponentHand: [{ name: "已公开随从", count: 1, cardId: "KNOWN_MINION" }],
      opponentHandCount: 1
    });
  });

  it("does not reveal a new opponent hand entity without a reliable source link", () => {
    const richDb = createCardDatabase([
      { id: 1, cardId: "KNOWN_MINION", name: "场外已公开随从", type: "MINION" }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(1);
    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() - SHOW_ENTITY - Updating Entity=[entityName=场外已公开随从 id=97 zone=SETASIDE cardId= player=2] CardID=KNOWN_MINION
D 12:00:02.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=普通亡语随从 id=98 zone=PLAY cardId=DEATHRATTLE_MINION player=1] CardID=DEATHRATTLE_MINION
D 12:00:03.000 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=TRIGGER Entity=[entityName=普通亡语随从 id=98 zone=GRAVEYARD cardId=DEATHRATTLE_MINION player=1] EffectCardId=0 EffectIndex=0 Target=0 SubOption=-1 TriggerKeyword=DEATHRATTLE
D 12:00:03.000 PowerTaskList.DebugPrintPower() -     FULL_ENTITY - Creating ID=100 CardID=
D 12:00:03.000 PowerTaskList.DebugPrintPower() -         tag=ZONE value=HAND
D 12:00:03.000 PowerTaskList.DebugPrintPower() -         tag=CONTROLLER value=2
D 12:00:03.000 PowerTaskList.DebugPrintPower() -         tag=ENTITY_ID value=100
D 12:00:03.000 PowerTaskList.DebugPrintPower() - BLOCK_END
`);

    expect(engine.getState()).toMatchObject({
      opponentHand: [],
      opponentHandCount: 1
    });
  });

  it("clears opponent zone cards and totals on the next game", () => {
    const engine = new TrackerEngine();
    engine.setFriendlyController(1);
    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY id=40 zone=DECK cardId= player=2] CardID=
D 12:00:02.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY id=41 zone=HAND cardId= player=2] CardID=
D 12:01:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME
`);

    expect(engine.getState()).toMatchObject({
      opponentDeck: [],
      opponentHand: [],
      opponentOther: [],
      opponentDeckCount: 0,
      opponentHandCount: 0
    });
  });

  it("tracks opponent secret slots and live attack totals for both boards", () => {
    const richDb = createCardDatabase([
      { id: 1, cardId: "EX1_287", name: "法术反制", collectible: true, type: "SPELL", playerClass: "MAGE", mechanics: ["SECRET"] },
      { id: 2, cardId: "MINION", name: "测试随从", type: "MINION" }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(1);
    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY id=70 zone=HAND cardId= player=2] tag=ZONE value=SECRET
D 12:00:02.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=测试随从 id=80 zone=PLAY cardId=MINION player=1] CardID=MINION
D 12:00:02.100 PowerTaskList.DebugPrintPower() - tag=ATK value=4
D 12:00:03.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=测试随从 id=81 zone=PLAY cardId=MINION player=2] CardID=MINION
D 12:00:03.100 PowerTaskList.DebugPrintPower() - tag=ATK value=6
`);

    expect(engine.getState()).toMatchObject({
      opponentSecrets: [{ entityId: "70" }],
      boardAttack: { friendly: 4, opponent: 6 }
    });

    engine.applyLine("D 12:00:04.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=测试随从 id=81 zone=PLAY cardId=MINION player=2] tag=ZONE value=GRAVEYARD");
    expect(engine.getState().boardAttack).toEqual({ friendly: 4, opponent: 0 });
    engine.applyLine("D 12:10:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=本地玩家 tag=PLAYSTATE value=LOST");
    expect(engine.getState().opponentSecrets).toEqual([]);
  });

  it("counts hero attack once and excludes weapons and non-combat board entities", () => {
    const richDb = createCardDatabase([
      { id: 1, cardId: "HERO", name: "测试英雄", type: "HERO" },
      { id: 2, cardId: "WEAPON", name: "测试武器", type: "WEAPON" },
      { id: 3, cardId: "MINION", name: "测试随从", type: "MINION" },
      { id: 4, cardId: "LOCATION", name: "测试地标", type: "LOCATION" }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(1);
    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=测试英雄 id=80 zone=PLAY cardId=HERO player=1] CardID=HERO
D 12:00:01.050 PowerTaskList.DebugPrintPower() - tag=CARDTYPE value=HERO
D 12:00:01.100 PowerTaskList.DebugPrintPower() - tag=ATK value=4
D 12:00:02.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=测试武器 id=81 zone=PLAY cardId=WEAPON player=1] CardID=WEAPON
D 12:00:02.050 PowerTaskList.DebugPrintPower() - tag=CARDTYPE value=WEAPON
D 12:00:02.100 PowerTaskList.DebugPrintPower() - tag=ATK value=4
D 12:00:03.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=测试随从 id=82 zone=PLAY cardId=MINION player=1] CardID=MINION
D 12:00:03.050 PowerTaskList.DebugPrintPower() - tag=CARDTYPE value=MINION
D 12:00:03.100 PowerTaskList.DebugPrintPower() - tag=ATK value=3
D 12:00:04.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=测试地标 id=83 zone=PLAY cardId=LOCATION player=1] CardID=LOCATION
D 12:00:04.050 PowerTaskList.DebugPrintPower() - tag=CARDTYPE value=LOCATION
D 12:00:04.100 PowerTaskList.DebugPrintPower() - tag=ATK value=9
`);

    expect(engine.getState().boardAttack).toEqual({ friendly: 7, opponent: 0 });
  });

  it("narrows an existing secret slot after the opponent hero is revealed", () => {
    const richDb = createCardDatabase([
      { id: 1, cardId: "MAGE_SECRET", name: "法师奥秘", collectible: true, type: "SPELL", playerClass: "MAGE", mechanics: ["SECRET"] },
      { id: 2, cardId: "PAL_SECRET", name: "骑士奥秘", collectible: true, type: "SPELL", playerClass: "PALADIN", mechanics: ["SECRET"] },
      { id: 3, cardId: "HERO_MAGE", name: "法师英雄", type: "HERO", playerClass: "MAGE" }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(1);
    engine.applyLine("D 12:00:01.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY id=70 zone=HAND cardId= player=2] tag=ZONE value=SECRET");
    engine.applyLine("D 12:00:02.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=法师英雄 id=2 zone=PLAY cardId=HERO_MAGE player=2] CardID=HERO_MAGE");
    expect(engine.getState().opponentSecrets?.[0].candidates.map((candidate) => candidate.cardId)).toEqual(["MAGE_SECRET"]);
  });

  it("does not treat a revealed questline in the SECRET zone as an opponent secret", () => {
    const richDb = createCardDatabase([
      { id: 64375, cardId: "SW_039", name: "一决胜负", collectible: true, type: "SPELL", playerClass: "DEMONHUNTER" }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(2);
    engine.applyText(`
D 15:50:59.335 GameState.DebugPrintPower() - SHOW_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=28 zone=HAND zonePos=1 cardId= player=1] CardID=SW_039
D 15:50:59.335 GameState.DebugPrintPower() - tag=ZONE value=SECRET
D 15:50:59.335 GameState.DebugPrintPower() - tag=QUEST_PROGRESS_TOTAL value=4
D 15:50:59.335 GameState.DebugPrintPower() - tag=QUESTLINE value=1
`);
    expect(engine.getState().opponentSecrets).toEqual([]);
  });

  it("removes an anonymous temporary slot when it is later revealed as a non-secret questline", () => {
    const richDb = createCardDatabase([
      { id: 64375, cardId: "SW_039", name: "一决胜负", collectible: true, type: "SPELL", playerClass: "DEMONHUNTER" }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(2);
    engine.applyLine("D 15:50:58.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY id=28 zone=HAND cardId= player=1] tag=ZONE value=SECRET");
    expect(engine.getState().opponentSecrets).toHaveLength(1);
    engine.applyLine("D 15:50:59.335 GameState.DebugPrintPower() - SHOW_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY id=28 zone=SECRET cardId= player=1] CardID=SW_039");
    expect(engine.getState().opponentSecrets).toEqual([]);
  });

  it("keeps real and unknown opponent secrets conservatively", () => {
    const richDb = createCardDatabase([
      { id: 1, cardId: "REAL_SECRET", name: "真实奥秘", collectible: true, type: "SPELL", playerClass: "MAGE", mechanics: ["SECRET"] }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(1);
    engine.applyLine("D 12:00:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=真实奥秘 id=70 zone=HAND cardId=REAL_SECRET player=2] tag=ZONE value=SECRET");
    engine.applyLine("D 12:00:02.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY id=71 zone=HAND cardId= player=2] tag=ZONE value=SECRET");
    expect(engine.getState().opponentSecrets?.map((slot) => slot.entityId)).toEqual(["70", "71"]);
  });

  it("keeps text-identified CORE secrets and waits for the matching outer PLAY end", () => {
    const richDb = createCardDatabase([
      {
        id: 69607,
        cardId: "CORE_EX1_287",
        name: "法术反制",
        collectible: 1,
        type: "SPELL",
        playerClass: "MAGE",
        text: "<b>奥秘：</b>当你的对手施放一个法术时，反制该法术。"
      },
      { id: 2, cardId: "TEST_SPELL", name: "测试法术", type: "SPELL" }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(1);
    engine.applyText(`
D 12:00:01.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY id=70 zone=HAND cardId= player=2] tag=ZONE value=SECRET
D 12:00:02.000 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=测试法术 id=80 zone=HAND cardId=TEST_SPELL player=1] Target=0
D 12:00:02.100 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=POWER Entity=[entityName=测试法术 id=80 zone=PLAY cardId=TEST_SPELL player=1] Target=0
D 12:00:02.200 PowerTaskList.DebugPrintPower() - BLOCK_END
`);

    expect(engine.getState().opponentSecrets?.[0].candidates).toContainEqual(expect.objectContaining({
      cardId: "CORE_EX1_287",
      status: "possible"
    }));

    engine.applyLine("D 12:00:02.300 PowerTaskList.DebugPrintPower() - BLOCK_END");
    expect(engine.getState().opponentSecrets?.[0].candidates).toContainEqual(expect.objectContaining({
      cardId: "CORE_EX1_287",
      status: "excluded",
      exclusionReason: "spell-played-without-trigger"
    }));
  });

  it("keeps other slots possible when one secret reveals and leaves during the action", () => {
    const richDb = createCardDatabase([
      { id: 1, cardId: "CORE_EX1_287", name: "法术反制", collectible: true, type: "SPELL", playerClass: "MAGE", mechanics: ["SECRET"] },
      { id: 2, cardId: "DMF_236", name: "古神在上", collectible: true, type: "SPELL", playerClass: "PALADIN", mechanics: ["SECRET"] },
      { id: 3, cardId: "TEST_SPELL", name: "测试法术", type: "SPELL" }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(1);
    engine.applyText(`
D 12:00:01.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY id=70 zone=HAND cardId= player=2] tag=ZONE value=SECRET
D 12:00:01.100 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY id=71 zone=HAND cardId= player=2] tag=ZONE value=SECRET
D 12:00:02.000 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=测试法术 id=80 zone=HAND cardId=TEST_SPELL player=1] Target=0
D 12:00:02.100 PowerTaskList.DebugPrintPower() - SHOW_ENTITY - Updating Entity=[entityName=法术反制 id=70 zone=SECRET cardId=CORE_EX1_287 player=2] CardID=CORE_EX1_287
D 12:00:02.200 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=法术反制 id=70 zone=SECRET cardId=CORE_EX1_287 player=2] tag=ZONE value=GRAVEYARD
D 12:00:02.300 PowerTaskList.DebugPrintPower() - BLOCK_END
`);

    expect(engine.getState().opponentSecrets).toHaveLength(1);
    expect(engine.getState().opponentSecrets?.[0].candidates.every(
      (candidate) => candidate.status === "possible"
    )).toBe(true);
  });

  it("excludes hero-attack secrets after a completed friendly attack on the opponent hero", () => {
    const richDb = createCardDatabase([
      { id: 1, cardId: "VAN_EX1_289", name: "寒冰护体", collectible: true, type: "SPELL", playerClass: "MAGE", mechanics: ["SECRET"] },
      { id: 2, cardId: "TEST_MINION", name: "测试随从", type: "MINION" },
      { id: 3, cardId: "HERO_01", name: "对方英雄", type: "HERO" }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(1);
    engine.applyText(`
D 12:00:01.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY id=70 zone=HAND cardId= player=2] tag=ZONE value=SECRET
D 12:00:02.000 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=ATTACK Entity=[entityName=测试随从 id=80 zone=PLAY cardId=TEST_MINION player=1] Target=[entityName=对方英雄 id=4 zone=PLAY cardId=HERO_01 player=2]
D 12:00:02.100 PowerTaskList.DebugPrintPower() - BLOCK_END
`);

    expect(engine.getState().opponentSecrets?.[0].candidates).toContainEqual(expect.objectContaining({
      cardId: "VAN_EX1_289",
      status: "excluded",
      exclusionReason: "hero-attacked-without-trigger"
    }));
  });

  it("does not exclude Mirror Entity when the opponent board is full", () => {
    const richDb = createCardDatabase([
      { id: 1, cardId: "CORE_EX1_294", name: "镜像实体", collectible: true, type: "SPELL", playerClass: "MAGE", mechanics: ["SECRET"] },
      { id: 2, cardId: "TEST_MINION", name: "测试随从", type: "MINION" }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(1);
    const opponentBoard = Array.from({ length: 7 }, (_, index) =>
      `D 12:00:01.${String(index).padStart(3, "0")} PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=测试随从 id=${100 + index} zone=PLAY cardId=TEST_MINION player=2] CardID=TEST_MINION`
    ).join("\n");
    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY id=70 zone=HAND cardId= player=2] tag=ZONE value=SECRET
${opponentBoard}
D 12:00:02.000 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=测试随从 id=80 zone=HAND cardId=TEST_MINION player=1] Target=0
D 12:00:02.100 PowerTaskList.DebugPrintPower() - BLOCK_END
`);

    expect(engine.getState().opponentSecrets?.[0].candidates).toContainEqual(expect.objectContaining({
      cardId: "CORE_EX1_294",
      status: "possible"
    }));
  });

  it("groups friendly hand cards from current entity zones", () => {
    const engine = new TrackerEngine({ deckText: "2x Fireball" });
    engine.setFriendlyController(1);

    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Fireball id=64 zone=DECK zonePos=1 cardId=CS2_029 player=1] tag=ZONE value=HAND
`);

    expect(engine.getState()).toMatchObject({
      friendlyHand: [{ name: "Fireball", count: 1, cardId: "CS2_029" }],
      friendlyOther: []
    });
  });

  it("moves a friendly card from hand to other when it is played", () => {
    const engine = new TrackerEngine({ deckText: "1x Fireball" });
    engine.setFriendlyController(1);

    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Fireball id=64 zone=DECK zonePos=1 cardId=CS2_029 player=1] tag=ZONE value=HAND
D 12:00:02.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Fireball id=64 zone=HAND zonePos=1 cardId=CS2_029 player=1] tag=ZONE value=PLAY
`);

    expect(engine.getState()).toMatchObject({
      friendlyHand: [],
      friendlyOther: [{ name: "Fireball", count: 1, cardId: "CS2_029" }]
    });
  });

  it("keeps a revealed hand card in hand when a different entity is created in play", () => {
    const richDb = createCardDatabase([
      { id: 1, cardId: "HAND_A", name: "手牌A", type: "MINION" },
      { id: 2, cardId: "HAND_B", name: "手牌B", type: "MINION" },
      { id: 3, cardId: "HAND_C", name: "手牌C", type: "MINION" },
      { id: 4, cardId: "HAND_D", name: "手牌D", type: "MINION" },
      { id: 5, cardId: "HAND_E", name: "手牌E", type: "MINION" },
      { id: 6, cardId: "TOY_375", name: "滑冰元素", type: "MINION" },
      { id: 7, cardId: "RLK_544t", name: "奥术防御者衍生物", type: "MINION" }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(2);

    engine.applyText(`
D 09:05:26.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=手牌A id=70 zone=DECK cardId=HAND_A player=2] tag=ZONE value=HAND
D 09:05:26.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=手牌B id=71 zone=DECK cardId=HAND_B player=2] tag=ZONE value=HAND
D 09:05:26.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=手牌C id=72 zone=DECK cardId=HAND_C player=2] tag=ZONE value=HAND
D 09:05:26.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=手牌D id=73 zone=DECK cardId=HAND_D player=2] tag=ZONE value=HAND
D 09:05:26.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=手牌E id=74 zone=DECK cardId=HAND_E player=2] tag=ZONE value=HAND
D 09:05:26.6659900 GameState.DebugPrintPower() - SHOW_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=59 zone=DECK zonePos=0 cardId= player=2] CardID=TOY_375
D 09:05:26.6659900 GameState.DebugPrintPower() -         tag=CONTROLLER value=2
D 09:05:26.6659900 GameState.DebugPrintPower() -         tag=ZONE value=HAND
`);

    const revealedState = engine.getState();
    expect(revealedState.friendlyHand?.reduce((total, card) => total + card.count, 0)).toBe(6);
    expect(revealedState.friendlyHand).toContainEqual(
      expect.objectContaining({ name: "滑冰元素", count: 1, cardId: "TOY_375" })
    );

    engine.applyText(`
D 09:05:32.4991480 GameState.DebugPrintPower() - FULL_ENTITY - Creating ID=156 CardID=RLK_544t
D 09:05:32.4991480 GameState.DebugPrintPower() -                 tag=CONTROLLER value=2
D 09:05:32.4991480 GameState.DebugPrintPower() -                 tag=ZONE value=PLAY
`);

    const createdState = engine.getState();
    expect(createdState.friendlyHand?.reduce((total, card) => total + card.count, 0)).toBe(6);
    expect(createdState.friendlyHand).toContainEqual(
      expect.objectContaining({ name: "滑冰元素", count: 1, cardId: "TOY_375" })
    );
    expect(createdState.friendlyOther).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "滑冰元素" })])
    );

    engine.applyLine(
      "D 09:05:33.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=滑冰元素 id=160 zone=PLAY cardId=TOY_375 player=2] tag=ZONE value=GRAVEYARD"
    );

    expect(engine.getState().friendlyHand).toContainEqual(
      expect.objectContaining({ name: "滑冰元素", count: 1, cardId: "TOY_375" })
    );
    expect(engine.getState().friendlyOther).toContainEqual(
      expect.objectContaining({ name: "滑冰元素", count: 1, cardId: "TOY_375" })
    );
  });

  it.each(["PLAY", "GRAVEYARD", "REMOVEDFROMGAME", "SECRET"])(
    "groups the %s zone under friendly other",
    (zone) => {
      const engine = new TrackerEngine({ deckText: "1x Fireball" });
      engine.setFriendlyController(1);

      engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Fireball id=64 zone=HAND zonePos=1 cardId=CS2_029 player=1] tag=ZONE value=${zone}
`);

      expect(engine.getState()).toMatchObject({
        friendlyHand: [],
        friendlyOther: [{ name: "Fireball", count: 1, cardId: "CS2_029" }]
      });
    }
  );

  it("aggregates distinct copies by card id without recounting duplicate log lines", () => {
    const engine = new TrackerEngine({ deckText: "2x Fireball" });
    engine.setFriendlyController(1);
    const firstDraw =
      "D 12:00:01.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Fireball id=64 zone=DECK zonePos=1 cardId=CS2_029 player=1] tag=ZONE value=HAND";

    engine.applyLine("D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME");
    engine.applyLine(firstDraw);
    engine.applyLine(firstDraw);
    engine.applyLine(
      "D 12:00:02.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Fireball id=65 zone=DECK zonePos=2 cardId=CS2_029 player=1] tag=ZONE value=HAND"
    );

    expect(engine.getState().friendlyHand).toEqual([{ name: "Fireball", count: 2, cardId: "CS2_029" }]);
  });

  it("counts unresolved friendly hand entities after replaying an in-progress game", () => {
    const engine = new TrackerEngine({ deckText: "1x Fireball" });
    engine.setFriendlyController(1);
    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME GameType=GT_RANKED
D 12:00:01.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating [entityName=UNKNOWN ENTITY [cardType=INVALID] id=64 zone=HAND zonePos=1 cardId= player=1] CardID=
D 12:00:01.000 PowerTaskList.DebugPrintPower() - tag=CONTROLLER value=1
D 12:00:01.000 PowerTaskList.DebugPrintPower() - tag=ZONE value=HAND
D 12:00:02.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Fireball id=65 zone=DECK zonePos=0 cardId=CS2_029 player=1] tag=ZONE value=HAND
`);
    expect(engine.getState().friendlyHand).toEqual([
      { name: "Fireball", count: 1, cardId: "CS2_029" },
      { name: "未识别手牌", count: 1 }
    ]);
  });

  it("uses card data for displayable entities and filters non-card entity types", () => {
    const richDb = createCardDatabase([
      { id: 1, cardId: "TOKEN_001", name: "Generated Token", type: "MINION", mana_cost: 1 },
      { id: 2, cardId: "HERO_001", name: "Friendly Hero", type: "HERO" },
      { id: 3, cardId: "POWER_001", name: "Friendly Hero Power", type: "HERO_POWER" },
      { id: 4, cardId: "ENCHANT_001", name: "Friendly Enchantment", type: "ENCHANTMENT" },
      { id: 5, cardId: "PLAYER_001", name: "Friendly Player", type: "PLAYER" }
    ]);
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.setFriendlyController(1);

    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Generated Token id=64 zone=HAND zonePos=1 cardId=TOKEN_001 player=1] tag=ZONE value=PLAY
D 12:00:02.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Friendly Hero id=65 zone=HAND zonePos=1 cardId=HERO_001 player=1] tag=ZONE value=PLAY
D 12:00:03.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Friendly Hero Power id=66 zone=HAND zonePos=1 cardId=POWER_001 player=1] tag=ZONE value=PLAY
D 12:00:04.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Friendly Enchantment id=67 zone=HAND zonePos=1 cardId=ENCHANT_001 player=1] tag=ZONE value=PLAY
D 12:00:05.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Friendly Player id=68 zone=HAND zonePos=1 cardId=PLAYER_001 player=1] tag=ZONE value=PLAY
`);

    expect(engine.getState().friendlyOther).toEqual([
      expect.objectContaining({
        name: "Generated Token",
        count: 1,
        cardId: "TOKEN_001",
        details: expect.objectContaining({ cardType: "随从", manaCost: 1 })
      })
    ]);
  });

  it("tracks draws and opponent plays from sample power lines", () => {
    const engine = new TrackerEngine({ deckText: "2x Fireball\n1x Miracle Salesman" });
    engine.setFriendlyController(1);

    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Fireball id=64 zone=DECK zonePos=1 cardId=CS2_029 player=1] tag=ZONE value=HAND
D 12:00:02.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Chillwind Yeti id=65 zone=HAND zonePos=1 cardId=CS2_182 player=2] tag=ZONE value=PLAY
`);

    const state = engine.getState();
    expect(state.deck.find((card) => card.name === "Fireball")).toMatchObject({ remaining: 1, drawn: 1 });
    expect(state.opponentPlayed.find((card) => card.name === "Chillwind Yeti")).toMatchObject({ played: 1 });
    expect(state.summary).toMatchObject({ totalCards: 3, remainingCards: 2, drawnCards: 1, opponentPlayedCount: 1 });
  });

  it("tracks card reveals from entity detail tags and ignores duplicate log copies", () => {
    const engine = new TrackerEngine({ deckText: "2x Fireball" });
    engine.setFriendlyController(1);

    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() -     SHOW_ENTITY - Updating Entity=[entityName=Fireball id=64 zone=DECK zonePos=0 cardId= player=1] CardID=CS2_029
D 12:00:01.000 PowerTaskList.DebugPrintPower() -         tag=CONTROLLER value=1
D 12:00:01.000 PowerTaskList.DebugPrintPower() -         tag=ZONE value=HAND
D 12:00:01.000 PowerTaskList.DebugPrintPower() -     SHOW_ENTITY - Updating Entity=[entityName=Fireball id=64 zone=DECK zonePos=0 cardId= player=1] CardID=CS2_029
D 12:00:01.000 PowerTaskList.DebugPrintPower() -         tag=CONTROLLER value=1
D 12:00:01.000 PowerTaskList.DebugPrintPower() -         tag=ZONE value=HAND
`);

    expect(engine.getState().deck[0]).toMatchObject({ name: "Fireball", remaining: 1, drawn: 1 });
  });

  it("waits for a split entity controller before applying its zone continuation", () => {
    const engine = new TrackerEngine();
    engine.setFriendlyController(1);

    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() -     SHOW_ENTITY - Updating Entity=[entityName=Chillwind Yeti id=65 zone=HAND zonePos=1 cardId=CS2_182] CardID=CS2_182
D 12:00:01.000 PowerTaskList.DebugPrintPower() -         tag=ZONE value=PLAY
`);

    expect(engine.getState().opponentPlayed).toEqual([]);

    engine.applyText(
      "D 12:00:01.000 PowerTaskList.DebugPrintPower() -         tag=CONTROLLER value=2"
    );

    expect(engine.getState().opponentPlayed).toEqual([
      expect.objectContaining({ name: "Chillwind Yeti", cardId: "CS2_182", played: 1 })
    ]);
  });

  it("returns a mulligan card to the deck when Hearthstone moves it from hand to deck", () => {
    const engine = new TrackerEngine({ deckText: "1x Fireball" });
    engine.setFriendlyController(1);

    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Fireball id=64 zone=DECK zonePos=0 cardId=CS2_029 player=1] tag=ZONE value=HAND
D 12:00:02.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Fireball id=64 zone=HAND zonePos=1 cardId=CS2_029 player=1] tag=ZONE value=DECK
`);

    expect(engine.getState().deck[0]).toMatchObject({ name: "Fireball", remaining: 1, drawn: 0 });
    expect(engine.getState().friendlyHand).toEqual([]);
    expect(engine.getState().friendlyOther).toEqual([]);
  });

  it("adds generated cards created directly in the friendly deck exactly once", () => {
    const richDb = createCardDatabase([
      { id: 105539, cardId: "MIS_707", name: "批量生产", type: "SPELL" }
    ]);
    const engine = new TrackerEngine({ deckText: "1x 批量生产", cardDatabase: richDb });
    engine.setFriendlyController(1);

    const generatedCopies = `
D 20:28:30.7028510 GameState.DebugPrintPower() -             FULL_ENTITY - Creating ID=234 CardID=
D 20:28:30.7028510 GameState.DebugPrintPower() -                 tag=ZONE value=DECK
D 20:28:30.7028510 GameState.DebugPrintPower() -                 tag=CONTROLLER value=1
D 20:28:30.7028510 GameState.DebugPrintPower() -                 tag=ENTITY_ID value=234
D 20:28:30.7028510 GameState.DebugPrintPower() -             TAG_CHANGE Entity=234 tag=DISPLAYED_CREATOR value=219
D 20:28:30.7028510 GameState.DebugPrintPower() -             SHOW_ENTITY - Updating Entity=234 CardID=MIS_707
D 20:28:30.7028510 GameState.DebugPrintPower() -                 tag=CONTROLLER value=1
D 20:28:30.7028510 GameState.DebugPrintPower() -                 tag=CARDTYPE value=SPELL
D 20:28:30.7028510 GameState.DebugPrintPower() -                 tag=ZONE value=DECK
D 20:28:30.7028510 GameState.DebugPrintPower() -             FULL_ENTITY - Creating ID=235 CardID=
D 20:28:30.7028510 GameState.DebugPrintPower() -                 tag=ZONE value=DECK
D 20:28:30.7028510 GameState.DebugPrintPower() -                 tag=CONTROLLER value=1
D 20:28:30.7028510 GameState.DebugPrintPower() -                 tag=ENTITY_ID value=235
D 20:28:30.7028510 GameState.DebugPrintPower() -             TAG_CHANGE Entity=235 tag=DISPLAYED_CREATOR value=219
D 20:28:30.7028510 GameState.DebugPrintPower() -             SHOW_ENTITY - Updating Entity=235 CardID=MIS_707
D 20:28:30.7028510 GameState.DebugPrintPower() -                 tag=CONTROLLER value=1
D 20:28:30.7028510 GameState.DebugPrintPower() -                 tag=CARDTYPE value=SPELL
D 20:28:30.7028510 GameState.DebugPrintPower() -                 tag=ZONE value=DECK
`;

    engine.applyLine("D 20:28:00.0000000 GameState.DebugPrintPower() - CREATE_GAME");
    engine.setFriendlyDeckSnapshot({ initialDeckSize: 30, remainingDeckSize: 30 });
    engine.applyLine(
      "D 20:28:20.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=MAIN_ACTION"
    );
    engine.applyText(`
${generatedCopies}
${generatedCopies.replaceAll("GameState", "PowerTaskList")}
`);

    expect(engine.getState().deck.find((card) => card.cardId === "MIS_707")).toMatchObject({
      count: 3,
      remaining: 3,
      drawn: 0
    });
    expect(engine.getState().summary).toMatchObject({
      totalCards: 32,
      remainingCards: 32,
      drawnCards: 0
    });
  });

  it("groups inserted deck cards by their source and decrements the remaining count when drawn", () => {
    const richDb = createCardDatabase([
      { id: 1, cardId: "SOURCE_001", name: "天空主母", type: "MINION" },
      { id: 2, cardId: "TOKEN_001", name: "星界碎片", type: "SPELL" }
    ]);
    const engine = new TrackerEngine({ deckText: "1x 基础牌", cardDatabase: richDb });
    engine.setFriendlyController(1);
    engine.applyLine("D 20:28:00.0000000 GameState.DebugPrintPower() - CREATE_GAME");
    engine.setFriendlyDeckSnapshot({ initialDeckSize: 1, remainingDeckSize: 1 });
    engine.applyLine(
      "D 20:28:20.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=MAIN_ACTION"
    );
    engine.applyLine(
      "D 20:28:21.0000000 GameState.DebugPrintPower() - FULL_ENTITY - Updating [entityName=天空主母 id=219 zone=PLAY zonePos=1 cardId=SOURCE_001 player=1] CardID=SOURCE_001"
    );

    const generated = Array.from({ length: 10 }, (_, index) => {
      const entityId = 300 + index;
      return `
D 20:28:22.0000000 GameState.DebugPrintPower() - FULL_ENTITY - Creating ID=${entityId} CardID=
D 20:28:22.0000000 GameState.DebugPrintPower() -     tag=ZONE value=DECK
D 20:28:22.0000000 GameState.DebugPrintPower() -     tag=CONTROLLER value=1
D 20:28:22.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=${entityId} tag=DISPLAYED_CREATOR value=219
D 20:28:22.0000000 GameState.DebugPrintPower() - SHOW_ENTITY - Updating Entity=${entityId} CardID=TOKEN_001
D 20:28:22.0000000 GameState.DebugPrintPower() -     tag=CONTROLLER value=1
D 20:28:22.0000000 GameState.DebugPrintPower() -     tag=ZONE value=DECK`;
    }).join("\n");
    engine.applyText(generated);

    expect(engine.getState().cardTracking.deckInsertions?.friendly.groups).toEqual([{
      sourceEntityId: "219",
      sourceName: "天空主母创建",
      remainingCount: 10
    }]);
    expect(engine.getState().deck.find((card) => card.cardId === "TOKEN_001")).toMatchObject({
      name: "星界碎片",
      remaining: 10
    });

    engine.applyLine(
      "D 20:28:23.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=星界碎片 id=300 zone=DECK zonePos=1 cardId=TOKEN_001 player=1] tag=ZONE value=HAND"
    );

    expect(engine.getState().cardTracking.deckInsertions?.friendly.groups[0]).toMatchObject({
      sourceName: "天空主母创建",
      remainingCount: 9
    });

    engine.applyLine(
      "D 20:28:24.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=星界碎片 id=301 zone=DECK zonePos=1 cardId=TOKEN_001 player=1] tag=ZONE value=HAND"
    );

    expect(engine.getState().cardTracking.deckInsertions?.friendly.groups[0]).toMatchObject({
      sourceName: "天空主母创建",
      remainingCount: 8
    });
  });

  it("tracks top and bottom insertions, then clears only their positions after a deck shuffle", () => {
    const richDb = createCardDatabase([
      { id: 1, cardId: "SOURCE_001", name: "天空主母", type: "MINION" },
      { id: 2, cardId: "TOKEN_001", name: "星界碎片", type: "SPELL" }
    ]);
    const engine = new TrackerEngine({ deckText: "1x 基础牌", cardDatabase: richDb });
    engine.setFriendlyController(1);
    engine.applyText(`
D 20:28:00.0000000 GameState.DebugPrintPower() - CREATE_GAME
D 20:28:20.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=MAIN_ACTION
D 20:28:21.0000000 GameState.DebugPrintPower() - FULL_ENTITY - Updating [entityName=天空主母 id=219 zone=PLAY zonePos=1 cardId=SOURCE_001 player=1] CardID=SOURCE_001
D 20:28:22.0000000 GameState.DebugPrintPower() - FULL_ENTITY - Creating ID=300 CardID=
D 20:28:22.0000000 GameState.DebugPrintPower() -     tag=ZONE value=DECK
D 20:28:22.0000000 GameState.DebugPrintPower() -     tag=CONTROLLER value=1
D 20:28:22.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=300 tag=DISPLAYED_CREATOR value=219
D 20:28:22.0000000 GameState.DebugPrintPower() - SHOW_ENTITY - Updating Entity=300 CardID=TOKEN_001
D 20:28:22.0000000 GameState.DebugPrintPower() -     tag=ZONE value=DECK
D 20:28:22.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=星界碎片 id=300 zone=DECK zonePos=0 cardId=TOKEN_001 player=1] tag=ZONE_POSITION value=1
D 20:28:23.0000000 GameState.DebugPrintPower() - FULL_ENTITY - Creating ID=301 CardID=
D 20:28:23.0000000 GameState.DebugPrintPower() -     tag=ZONE value=DECK
D 20:28:23.0000000 GameState.DebugPrintPower() -     tag=CONTROLLER value=1
D 20:28:23.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=301 tag=DISPLAYED_CREATOR value=219
D 20:28:23.0000000 GameState.DebugPrintPower() - SHOW_ENTITY - Updating Entity=301 CardID=TOKEN_001
D 20:28:23.0000000 GameState.DebugPrintPower() -     tag=ZONE value=DECK
D 20:28:23.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=星界碎片 id=301 zone=DECK zonePos=0 cardId=TOKEN_001 player=1] tag=ZONE_POSITION value=3
`);

    expect(engine.getState().cardTracking.deckInsertions?.friendly.placements).toEqual([
      expect.objectContaining({ entityId: "300", position: "top", cardName: "星界碎片" }),
      expect.objectContaining({ entityId: "301", position: "bottom", cardName: "星界碎片" })
    ]);

    engine.applyLine(
      "D 20:28:23.5000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=星界碎片 id=300 zone=DECK zonePos=1 cardId=TOKEN_001 player=1] tag=ZONE_POSITION value=2"
    );

    expect(engine.getState().cardTracking.deckInsertions?.friendly.placements).toEqual([
      expect.objectContaining({ entityId: "301", position: "bottom", cardName: "星界碎片" })
    ]);

    engine.applyLine("D 20:28:24.0000000 GameState.DebugPrintPower() - SHUFFLE_DECK PlayerID=1");

    expect(engine.getState().cardTracking.deckInsertions?.friendly).toMatchObject({
      groups: [{ sourceName: "天空主母创建", remainingCount: 2 }],
      placements: []
    });
  });

  it("keeps an unidentified inserted entity as one placeholder when it leaves and returns", () => {
    const engine = new TrackerEngine({ deckText: "1x Fireball" });
    engine.setFriendlyController(1);
    engine.applyLine("D 20:28:00.0000000 GameState.DebugPrintPower() - CREATE_GAME");
    engine.setFriendlyDeckSnapshot({ initialDeckSize: 30, remainingDeckSize: 30 });
    engine.applyText(`
D 20:28:20.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=MAIN_ACTION
D 20:28:30.7028510 GameState.DebugPrintPower() - FULL_ENTITY - Creating ID=234 CardID=
D 20:28:30.7028510 GameState.DebugPrintPower() -     tag=ZONE value=DECK
D 20:28:30.7028510 GameState.DebugPrintPower() -     tag=CONTROLLER value=1
D 20:28:30.7028510 GameState.DebugPrintPower() - TAG_CHANGE Entity=234 tag=DISPLAYED_CREATOR value=219
D 20:28:31.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=234 tag=ZONE value=HAND
D 20:28:32.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=234 tag=ZONE value=DECK
D 20:28:32.0000000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=234 tag=ZONE value=DECK
`);

    expect(engine.getState().deck.find((card) => card.name === "被塞入的未知牌")).toMatchObject({
      count: 1,
      remaining: 1,
      drawn: 0
    });
    expect(engine.getState().deck.some((card) => card.name === "234")).toBe(false);
    expect(engine.getState().summary).toMatchObject({
      totalCards: 31,
      remainingCards: 31,
      drawnCards: 0
    });
  });

  it("does not count setup-generated deck entities twice before the first action", () => {
    const engine = new TrackerEngine({
      collectionDecks: [
        createCollectionDeck("base-deck", "开局生成牌套牌", [
          { name: "Sample Singleton", count: 30, cardId: "TEST_001" }
        ])
      ]
    });
    engine.setFriendlyController(1);
    engine.applyLine("D 20:28:00.0000000 GameState.DebugPrintPower() - CREATE_GAME");
    engine.setFriendlyDeckSnapshot({ initialDeckSize: 32, remainingDeckSize: 32, baseDeckSize: 30 });
    expect(engine.activateCollectionDeck("base-deck")).toBe(true);

    engine.applyText(`
D 20:28:10.0000000 GameState.DebugPrintPower() - FULL_ENTITY - Creating ID=234 CardID=
D 20:28:10.0000000 GameState.DebugPrintPower() -     tag=ZONE value=DECK
D 20:28:10.0000000 GameState.DebugPrintPower() -     tag=CONTROLLER value=1
D 20:28:10.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=234 tag=DISPLAYED_CREATOR value=64
D 20:28:10.0000000 GameState.DebugPrintPower() - SHOW_ENTITY - Updating Entity=234 CardID=TEST_002
D 20:28:10.0000000 GameState.DebugPrintPower() -     tag=ZONE value=DECK
D 20:28:20.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=MAIN_ACTION
`);

    expect(engine.getState().summary).toMatchObject({
      totalCards: 32,
      remainingCards: 32,
      drawnCards: 0
    });
    expect(engine.getState().deck.find((card) => card.name === "对局生成的未知牌")).toMatchObject({
      count: 2,
      remaining: 2
    });
  });

  it("moves an unresolved Arena card out of and back into the deck for an unknown mulligan card", () => {
    const engine = new TrackerEngine();
    engine.loadDeckCards([
      { name: "Sample Singleton", count: 29, cardId: "TEST_001" },
      { name: "未解析竞技场牌", count: 1, unresolved: true }
    ], "竞技场牌库");
    engine.setFriendlyController(1);

    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Unknown Arena Card id=64 zone=DECK zonePos=0 cardId=UNKNOWN_001 player=1] tag=ZONE value=HAND
`);

    expect(engine.getState().summary).toMatchObject({ totalCards: 30, remainingCards: 29, drawnCards: 1 });
    expect(engine.getState().deck.find((card) => card.unresolved)).toMatchObject({ remaining: 0, drawn: 1 });

    engine.applyLine(
      "D 12:00:01.500 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Generated Unknown Card id=65 zone=DECK zonePos=0 cardId=UNKNOWN_002 player=1] tag=ZONE value=HAND"
    );
    expect(engine.getState().summary).toMatchObject({ totalCards: 30, remainingCards: 29, drawnCards: 1 });

    engine.applyLine(
      "D 12:00:02.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Unknown Arena Card id=64 zone=HAND zonePos=1 cardId=UNKNOWN_001 player=1] tag=ZONE value=DECK"
    );

    expect(engine.getState().summary).toMatchObject({ totalCards: 30, remainingCards: 30, drawnCards: 0 });
    expect(engine.getState().deck.find((card) => card.unresolved)).toMatchObject({ remaining: 1, drawn: 0 });
  });

  it("syncs an exact Arena deck without resetting the active match", () => {
    const engine = new TrackerEngine({ cardDatabase: cardDb });
    engine.loadDeckCards([
      { name: "Sample Singleton", count: 1, cardId: "TEST_001" },
      { name: "未解析竞技场牌", count: 3, unresolved: true }
    ], "竞技场牌库");
    engine.applyLine("D 12:00:00.000 GameState.DebugPrintPower() - CREATE_GAME");
    engine.setFriendlyController(1);
    engine.applyText([
      "D 12:00:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=TURN value=5",
      "D 12:00:02.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=本地玩家 id=1 zone=PLAY cardId= player=1] tag=CURRENT_PLAYER value=1",
      "D 12:00:03.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Sample Singleton id=64 zone=DECK zonePos=1 cardId=TEST_001 player=1] tag=ZONE value=HAND",
      "D 12:00:04.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Sample Pair id=65 zone=DECK zonePos=2 cardId=TEST_002 player=1] tag=ZONE value=HAND",
      "D 12:00:05.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Sample Multi id=66 zone=HAND zonePos=1 cardId=TEST_003 player=2] tag=ZONE value=PLAY"
    ].join("\n"));
    const before = engine.getState();

    engine.syncDeckCards([
      { name: "Sample Singleton", count: 1, cardId: "TEST_001" },
      { name: "Sample Pair", count: 2, cardId: "TEST_002" },
      { name: "Sample Multi", count: 1, cardId: "TEST_003" }
    ], "竞技场牌库");

    const state = engine.getState();
    expect(state.gameActive).toBe(true);
    expect(state.matchFlow).toEqual(before.matchFlow);
    expect((state.friendlyHand ?? []).reduce((total, card) => total + card.count, 0)).toBe(
      (before.friendlyHand ?? []).reduce((total, card) => total + card.count, 0)
    );
    expect(state.friendlyHand).toEqual(expect.arrayContaining([
      expect.objectContaining({ cardId: "TEST_001", count: 1 }),
      expect.objectContaining({ cardId: "TEST_002", count: 1 })
    ]));
    expect(state.opponentPlayed).toEqual(before.opponentPlayed);
    expect(state.events).toEqual(before.events);
    expect(state.deck.find((card) => card.cardId === "TEST_001")).toMatchObject({ count: 1, remaining: 0, drawn: 1 });
    expect(state.deck.find((card) => card.cardId === "TEST_002")).toMatchObject({ count: 2, remaining: 1, drawn: 1 });
    expect(state.deck.find((card) => card.cardId === "TEST_003")).toMatchObject({ count: 1, remaining: 1, drawn: 0 });
    expect(state.deck.some((card) => card.unresolved)).toBe(false);
    expect(state.summary).toMatchObject({ totalCards: 4, remainingCards: 2, drawnCards: 2, opponentPlayedCount: 1 });
  });

  it("keeps one generated deck card across repeated exact Arena deck syncs", () => {
    const richDb = createCardDatabase([
      { id: 1, cardId: "BASE_001", name: "竞技场基础牌", type: "MINION" },
      { id: 2, cardId: "SOURCE_001", name: "生成来源", type: "MINION" },
      { id: 3, cardId: "TOKEN_001", name: "生成牌", type: "SPELL" }
    ]);
    const exactDeck = [{ name: "竞技场基础牌", count: 2, cardId: "BASE_001" }];
    const engine = new TrackerEngine({ cardDatabase: richDb });
    engine.loadDeckCards(exactDeck, "竞技场牌库");
    engine.setFriendlyController(1);
    engine.applyText(`
D 20:28:00.0000000 GameState.DebugPrintPower() - CREATE_GAME
D 20:28:20.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=MAIN_ACTION
D 20:28:21.0000000 GameState.DebugPrintPower() - FULL_ENTITY - Updating [entityName=生成来源 id=219 zone=PLAY zonePos=1 cardId=SOURCE_001 player=1] CardID=SOURCE_001
D 20:28:22.0000000 GameState.DebugPrintPower() - FULL_ENTITY - Creating ID=300 CardID=
D 20:28:22.0000000 GameState.DebugPrintPower() -     tag=ZONE value=DECK
D 20:28:22.0000000 GameState.DebugPrintPower() -     tag=CONTROLLER value=1
D 20:28:22.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=300 tag=DISPLAYED_CREATOR value=219
D 20:28:22.0000000 GameState.DebugPrintPower() - SHOW_ENTITY - Updating Entity=300 CardID=TOKEN_001
D 20:28:22.0000000 GameState.DebugPrintPower() -     tag=CONTROLLER value=1
D 20:28:22.0000000 GameState.DebugPrintPower() -     tag=ZONE value=DECK
`);

    expect(engine.getState().deck.find((card) => card.cardId === "TOKEN_001")).toMatchObject({
      count: 1,
      remaining: 1,
      drawn: 0
    });

    engine.syncDeckCards(exactDeck, "竞技场牌库");
    expect(engine.getState().deck.find((card) => card.cardId === "TOKEN_001")).toMatchObject({
      count: 1,
      remaining: 1,
      drawn: 0
    });

    engine.applyLine(
      "D 20:28:23.0000000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=生成牌 id=300 zone=DECK zonePos=1 cardId=TOKEN_001 player=1] tag=ZONE value=HAND"
    );
    engine.syncDeckCards(exactDeck, "竞技场牌库");

    const state = engine.getState();
    const generatedRows = state.deck.filter((card) => card.cardId === "TOKEN_001");
    expect(generatedRows).toHaveLength(1);
    expect(generatedRows[0]).toMatchObject({ count: 1, remaining: 0, drawn: 1 });
    expect(state.gameActive).toBe(true);
  });

  it("clears friendly zone cards across game, import, and reset boundaries", () => {
    const engine = new TrackerEngine({ deckText: "1x Fireball" });
    engine.setFriendlyController(1);
    const draw =
      "D 12:00:01.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Fireball id=64 zone=DECK zonePos=1 cardId=CS2_029 player=1] tag=ZONE value=HAND";

    engine.applyLine("D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME");
    engine.applyLine(draw);
    expect(engine.getState().friendlyHand).toHaveLength(1);

    engine.applyLine("D 12:01:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME");
    expect(engine.getState().friendlyHand).toEqual([]);

    engine.applyLine(draw);
    engine.importDeck("1x Frostbolt");
    expect(engine.getState().friendlyHand).toEqual([]);

    engine.applyLine("D 12:02:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME");
    engine.applyLine(
      "D 12:02:01.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Frostbolt id=65 zone=DECK zonePos=1 cardId=CS2_024 player=1] tag=ZONE value=HAND"
    );
    engine.applyLine("D 12:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=Friendly tag=PLAYSTATE value=WON");
    expect(engine.getState().friendlyHand).toEqual([]);
    expect(engine.getState().friendlyOther).toEqual([]);
  });

  it("keeps the current deck ready for the next game when Hearthstone reports a result", () => {
    const engine = new TrackerEngine({ deckText: "2x Fireball" });
    engine.setFriendlyController(1);

    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Fireball id=64 zone=DECK zonePos=1 cardId=CS2_029 player=1] tag=ZONE value=HAND
D 12:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=本地玩家 tag=PLAYSTATE value=LOST
`);

    expect(engine.getState()).toMatchObject({
      gameActive: false,
      autoMatchedDeckId: undefined,
      deck: [
        {
          name: "Fireball",
          count: 2,
          remaining: 2,
          drawn: 0,
          played: 0
        }
      ],
      friendlyHand: [],
      friendlyOther: [],
      opponentPlayed: [],
      events: [],
      summary: { totalCards: 2, remainingCards: 2, drawnCards: 0, opponentPlayedCount: 0 }
    });

    engine.applyText(`
D 12:10:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME
D 12:10:01.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Fireball id=65 zone=DECK zonePos=1 cardId=CS2_029 player=1] tag=ZONE value=HAND
`);

    expect(engine.getState()).toMatchObject({
      gameActive: true,
      deck: [{ name: "Fireball", count: 2, remaining: 1, drawn: 1, played: 0 }],
      summary: { totalCards: 2, remainingCards: 1, drawnCards: 1 }
    });
  });

  it("keeps the confirmed collection deck identity between games", () => {
    const engine = new TrackerEngine({
      collectionDecks: [
        createCollectionDeck("selected-deck", "当前构筑套牌", [
          { name: "Sample Singleton", count: 1, cardId: "TEST_001" },
          { name: "Sample Pair", count: 2, cardId: "TEST_002" }
        ])
      ]
    });

    expect(engine.previewCollectionDeck("selected-deck", { source: "decks-log" })).toBe(true);
    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Sample Singleton id=64 zone=DECK zonePos=1 cardId=TEST_001 player=1] tag=ZONE value=HAND
D 12:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=本地玩家 tag=PLAYSTATE value=WON
`);

    expect(engine.getState()).toMatchObject({
      gameActive: false,
      deckName: "当前构筑套牌",
      autoMatchedDeckId: "selected-deck",
      deckIdentity: {
        status: "confirmed",
        source: "decks-log",
        deckId: "selected-deck"
      },
      summary: { totalCards: 3, remainingCards: 3, drawnCards: 0 }
    });
  });

  it("keeps the arena deck between arena games", () => {
    const engine = new TrackerEngine();
    engine.loadDeckCards(
      [
        { name: "Sample Singleton", count: 1, cardId: "TEST_001" },
        { name: "Sample Pair", count: 2, cardId: "TEST_002" }
      ],
      "竞技场牌库"
    );

    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Sample Pair id=64 zone=DECK zonePos=1 cardId=TEST_002 player=1] tag=ZONE value=HAND
D 12:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=本地玩家 tag=PLAYSTATE value=LOST
`);

    expect(engine.getState()).toMatchObject({
      gameActive: false,
      deckName: "竞技场牌库",
      summary: { totalCards: 3, remainingCards: 3, drawnCards: 0 }
    });
  });

  it("drops a temporary unmatched placeholder after the game ends", () => {
    const engine = new TrackerEngine();
    engine.applyLine("D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME");
    engine.setFriendlyDeckSnapshot({ initialDeckSize: 30, remainingDeckSize: 27 });
    expect(engine.useUnmatchedDeckSnapshot()).toBe(true);

    engine.applyLine(
      "D 12:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=本地玩家 tag=PLAYSTATE value=LOST"
    );

    expect(engine.getState()).toMatchObject({
      gameActive: false,
      deckName: undefined,
      deck: [],
      summary: { totalCards: 0, remainingCards: 0, drawnCards: 0 }
    });
  });

  it("removes opening generated placeholders while keeping the selected base deck", () => {
    const engine = new TrackerEngine({
      collectionDecks: [
        createCollectionDeck("generated-deck", "带开局生成牌的套牌", [
          { name: "Sample Singleton", count: 1, cardId: "TEST_001" },
          { name: "Sample Pair", count: 2, cardId: "TEST_002" }
        ])
      ]
    });
    engine.applyLine("D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME");
    engine.setFriendlyDeckSnapshot({
      baseDeckSize: 3,
      initialDeckSize: 4,
      remainingDeckSize: 4
    });
    expect(engine.activateCollectionDeck("generated-deck")).toBe(true);
    expect(engine.getState().summary.totalCards).toBe(4);
    expect(engine.getState().deck).toContainEqual(
      expect.objectContaining({ name: "对局生成的未知牌", count: 1 })
    );

    engine.applyLine(
      "D 12:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=本地玩家 tag=PLAYSTATE value=WON"
    );

    expect(engine.getState()).toMatchObject({
      deckName: "带开局生成牌的套牌",
      autoMatchedDeckId: "generated-deck",
      summary: { totalCards: 3, remainingCards: 3, drawnCards: 0 }
    });
    expect(engine.getState().deck.find((card) => card.name === "对局生成的未知牌")).toBeUndefined();
  });

  it("shows an inferred deck between games but releases it when the next game starts", () => {
    const engine = new TrackerEngine({
      cardDatabase: cardDb,
      collectionDecks: [
        createCollectionDeck("deck-a", "自动套牌 A", [
          { name: "Sample Singleton", count: 1, cardId: "TEST_001" },
          { name: "Sample Pair", count: 2, cardId: "TEST_002" }
        ]),
        createCollectionDeck("deck-b", "自动套牌 B", [
          { name: "Sample Singleton", count: 1, cardId: "TEST_001" },
          { name: "Sample Multi", count: 2, cardId: "TEST_003" }
        ])
      ]
    });
    engine.setFriendlyController(1);
    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Sample Singleton id=64 zone=DECK cardId=TEST_001 player=1] tag=ZONE value=HAND
D 12:00:02.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Sample Pair id=65 zone=DECK cardId=TEST_002 player=1] tag=ZONE value=HAND
D 12:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=本地玩家 tag=PLAYSTATE value=WON
`);

    expect(engine.getState()).toMatchObject({
      gameActive: false,
      deckName: "自动套牌 A",
      autoMatchedDeckId: "deck-a",
      summary: { totalCards: 3, remainingCards: 3, drawnCards: 0 }
    });

    engine.applyText(`
D 12:10:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME
D 12:10:01.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Sample Singleton id=74 zone=DECK cardId=TEST_001 player=1] tag=ZONE value=HAND
D 12:10:02.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Sample Multi id=75 zone=DECK cardId=TEST_003 player=1] tag=ZONE value=HAND
`);

    expect(engine.getState()).toMatchObject({
      gameActive: true,
      deckName: "自动套牌 B",
      autoMatchedDeckId: "deck-b",
      summary: { totalCards: 3, remainingCards: 1, drawnCards: 2 }
    });
  });

  it("handles duplicate game results without changing the retained deck", () => {
    const engine = new TrackerEngine({ deckText: "2x Fireball" });
    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME
D 12:05:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=本地玩家 tag=PLAYSTATE value=WON
D 12:05:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=GameEntity tag=STEP value=FINAL_GAMEOVER
`);

    expect(engine.getState()).toMatchObject({
      gameActive: false,
      deck: [{ name: "Fireball", count: 2, remaining: 2, drawn: 0, played: 0 }],
      summary: { totalCards: 2, remainingCards: 2, drawnCards: 0 }
    });
  });

  it("keeps a manual import but clears a collection deck at a new log-session boundary", () => {
    const imported = new TrackerEngine({ deckText: "2x Fireball" });
    imported.resetForLogSession();
    expect(imported.getState()).toMatchObject({
      deck: [{ name: "Fireball", count: 2, remaining: 2, drawn: 0 }],
      summary: { totalCards: 2, remainingCards: 2, drawnCards: 0 }
    });

    const selected = new TrackerEngine({
      collectionDecks: [
        createCollectionDeck("old-session-deck", "旧会话套牌", [
          { name: "Sample Singleton", count: 1, cardId: "TEST_001" }
        ])
      ]
    });
    expect(selected.previewCollectionDeck("old-session-deck")).toBe(true);
    selected.resetForLogSession();
    expect(selected.getState()).toMatchObject({
      deckName: undefined,
      autoMatchedDeckId: undefined,
      deck: [],
      summary: { totalCards: 0, remainingCards: 0, drawnCards: 0 }
    });
  });

  it("tracks draws by card id when the log has no card name", () => {
    const deckCode = encodeDeckString([0, 1, 2, 1, 7, 1, 1001, 0, 0]);
    const engine = new TrackerEngine({ deckText: deckCode, cardDatabase: cardDb });
    engine.setFriendlyController(1);

    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=64 zone=DECK zonePos=1 cardId=TEST_001 player=1] tag=ZONE value=HAND
`);

    const state = engine.getState();
    expect(state.deck.find((card) => card.name === "Sample Singleton")).toMatchObject({
      cardId: "TEST_001",
      remaining: 0,
      drawn: 1
    });
    expect(state.events[0]).toMatchObject({ kind: "draw", cardName: "Sample Singleton", cardId: "TEST_001" });
  });

  it("attaches card details to a manually named row after the log reveals its card id", () => {
    const richDb = createCardDatabase([
      {
        id: 315,
        cardId: "CS2_029",
        name: "火球术",
        type: 5,
        mana_cost: 4,
        text: "造成 6点伤害。",
        image: "https://example.test/fireball.png",
        crop_image: "https://example.test/fireball-crop.png"
      }
    ]);
    const engine = new TrackerEngine({ deckText: "2x Fireball", cardDatabase: richDb });
    engine.setFriendlyController(1);

    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Fireball id=64 zone=DECK zonePos=1 cardId=CS2_029 player=1] tag=ZONE value=HAND
`);

    expect(engine.getState().deck[0]).toMatchObject({
      cardId: "CS2_029",
      details: { name: "火球术", manaCost: 4, isSpell: true, text: "造成 6点伤害。" }
    });
  });

  it("resolves opponent card names from card ids when no deck is imported", () => {
    const engine = new TrackerEngine({ cardDatabase: cardDb });
    engine.setFriendlyController(1);

    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=65 zone=HAND zonePos=1 cardId=TEST_002 player=2] tag=ZONE value=PLAY
`);

    const state = engine.getState();
    expect(state.opponentPlayed).toEqual([
      expect.objectContaining({ name: "Sample Pair", cardId: "TEST_002", played: 1 })
    ]);
  });

  it("auto matches a collection deck from friendly draw observations", () => {
    const engine = new TrackerEngine({
      cardDatabase: cardDb,
      collectionDecks: [
        createCollectionDeck("deck-a", "自动套牌 A", [
          { name: "Sample Singleton", count: 1, cardId: "TEST_001" },
          { name: "Sample Pair", count: 2, cardId: "TEST_002" }
        ]),
        createCollectionDeck("deck-b", "自动套牌 B", [
          { name: "Sample Singleton", count: 1, cardId: "TEST_001" },
          { name: "Sample Multi", count: 2, cardId: "TEST_003" }
        ])
      ]
    });
    engine.setFriendlyController(1);

    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=64 zone=DECK zonePos=1 cardId=TEST_001 player=1] tag=ZONE value=HAND
`);

    expect(engine.getState().autoMatchedDeckId).toBeUndefined();

    engine.applyText(
      "D 12:00:02.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=65 zone=DECK zonePos=2 cardId=TEST_002 player=1] tag=ZONE value=HAND"
    );

    const state = engine.getState();
    expect(state.autoMatchedDeckId).toBe("deck-a");
    expect(state.deckIdentity).toEqual({
      status: "confirmed",
      source: "inferred",
      deckId: "deck-a",
      observedDistinctCards: 2,
      candidateCount: 1,
      bestScore: 6,
      scoreLead: 6
    });
    expect(state.deckName).toBe("自动套牌 A");
    expect(state.summary).toMatchObject({ totalCards: 3, remainingCards: 1, drawnCards: 2 });
    expect(state.deck.find((card) => card.cardId === "TEST_001")).toMatchObject({ remaining: 0, drawn: 1 });
    expect(state.deck.find((card) => card.cardId === "TEST_002")).toMatchObject({ remaining: 1, drawn: 1 });

    engine.applyText(
      "D 12:00:03.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=66 zone=DECK zonePos=1 cardId=TEST_002 player=2] tag=ZONE value=HAND\n" +
      "D 12:00:04.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=67 zone=HAND zonePos=1 cardId=TEST_002 player=2] tag=ZONE value=PLAY"
    );

    expect(engine.getState().summary.drawnCards).toBe(2);
    expect(engine.getState().opponentPlayed.find((card) => card.cardId === "TEST_002")).toMatchObject({ played: 1 });
  });

  it("uses Hearthstone's selected collection deck immediately after a game begins", () => {
    const engine = new TrackerEngine({
      collectionDecks: [
        createCollectionDeck("deck-a", "自动套牌 A", [
          { name: "Sample Singleton", count: 1, cardId: "TEST_001" },
          { name: "Sample Pair", count: 2, cardId: "TEST_002" }
        ])
      ]
    });

    engine.applyLine("D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME");
    expect(engine.activateCollectionDeck("deck-a")).toBe(true);

    const state = engine.getState();
    expect(state).toMatchObject({
      deckName: "自动套牌 A",
      autoMatchedDeckId: "deck-a",
      deckIdentity: {
        status: "confirmed",
        source: "decks-log",
        deckId: "deck-a",
        observedDistinctCards: 0,
        candidateCount: 1,
        bestScore: 0,
        scoreLead: 0
      },
      summary: { totalCards: 3, remainingCards: 3, drawnCards: 0 }
    });
  });

  it("does not count a card twice when its card id arrives after the name", () => {
    const engine = new TrackerEngine({
      collectionDecks: [
        createCollectionDeck("deck-a", "唯一候选", [
          { name: "Sample Singleton", count: 1, cardId: "TEST_001" },
          { name: "Sample Pair", count: 1, cardId: "TEST_002" }
        ])
      ]
    });
    engine.setFriendlyController(1);

    engine.applyText([
      "D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME",
      "D 12:00:01.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Sample Singleton id=64 zone=DECK zonePos=1 cardId= player=1] tag=ZONE value=HAND",
      "D 12:00:02.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Sample Singleton id=64 zone=HAND zonePos=1 cardId=TEST_001 player=1] tag=ZONE value=PLAY"
    ].join("\n"));

    expect(engine.getState()).toMatchObject({
      autoMatchedDeckId: undefined,
      deckIdentity: {
        status: "probable",
        observedDistinctCards: 1,
        candidateCount: 1
      }
    });
  });

  it("previews a collection deck before the match starts", () => {
    const engine = new TrackerEngine({
      collectionDecks: [
        createCollectionDeck("preview-deck", "偷取牌库", [
          { name: "Sample Singleton", count: 1, cardId: "TEST_001" },
          { name: "Sample Pair", count: 2, cardId: "TEST_002" }
        ])
      ]
    });

    expect(engine.previewCollectionDeck("preview-deck")).toBe(true);
    expect(engine.getState()).toEqual(
      expect.objectContaining({
        deckName: "偷取牌库",
        autoMatchedDeckId: "preview-deck",
        deckIdentity: {
          status: "confirmed",
          source: "screen",
          deckId: "preview-deck",
          observedDistinctCards: 0,
          candidateCount: 1,
          bestScore: 0,
          scoreLead: 0
        },
        summary: expect.objectContaining({ totalCards: 3, remainingCards: 3 })
      })
    );
  });

  it("accepts an explicit preview source while keeping old preview calls compatible", () => {
    const engine = new TrackerEngine({
      collectionDecks: [
        createCollectionDeck("preview-deck", "日志套牌", [
          { name: "Sample Singleton", count: 1, cardId: "TEST_001" }
        ])
      ]
    });

    expect(engine.previewCollectionDeck("preview-deck", { source: "decks-log" })).toBe(true);
    expect(engine.getState().deckIdentity).toMatchObject({
      status: "confirmed",
      source: "decks-log",
      deckId: "preview-deck"
    });

    expect(engine.previewCollectionDeck("preview-deck", "screen")).toBe(true);
    expect(engine.getState().deckIdentity).toMatchObject({
      status: "confirmed",
      source: "decks-log",
      deckId: "preview-deck"
    });
  });

  it("keeps the selected collection deck when the live game begins", () => {
    const engine = new TrackerEngine({
      collectionDecks: [
        createCollectionDeck("preview-deck", "偷取牌库", [
          { name: "Sample Singleton", count: 1, cardId: "TEST_001" },
          { name: "Sample Pair", count: 2, cardId: "TEST_002" }
        ])
      ]
    });
    engine.setFriendlyController(1);

    expect(engine.previewCollectionDeck("preview-deck")).toBe(true);
    engine.applyText([
      "D 12:00:00.000 GameState.DebugPrintPower() - CREATE_GAME",
      "D 12:00:01.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Sample Singleton id=64 zone=DECK zonePos=1 cardId=TEST_001 player=1] tag=ZONE value=HAND"
    ].join("\n"));

    expect(engine.getState()).toMatchObject({
      gameActive: true,
      deckName: "偷取牌库",
      autoMatchedDeckId: "preview-deck",
      summary: { totalCards: 3, remainingCards: 2, drawnCards: 1 }
    });
  });

  it("clears a collection deck preview before the match starts", () => {
    const engine = new TrackerEngine({
      collectionDecks: [
        createCollectionDeck("preview-deck", "预览套牌", [
          { name: "Sample Singleton", count: 1, cardId: "TEST_001" }
        ])
      ]
    });

    expect(engine.previewCollectionDeck("preview-deck")).toBe(true);
    expect(engine.clearCollectionDeckPreview()).toBe(true);
    expect(engine.getState()).toMatchObject({
      deckName: undefined,
      autoMatchedDeckId: undefined,
      deck: [],
      summary: { totalCards: 0, remainingCards: 0, drawnCards: 0 }
    });
  });

  it("does not clear an active collection deck", () => {
    const engine = new TrackerEngine({
      collectionDecks: [
        createCollectionDeck("active-deck", "对局套牌", [
          { name: "Sample Singleton", count: 1, cardId: "TEST_001" }
        ])
      ]
    });
    engine.applyLine("D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME");
    expect(engine.activateCollectionDeck("active-deck")).toBe(true);

    expect(engine.clearCollectionDeckPreview()).toBe(false);
    expect(engine.getState()).toMatchObject({
      deckName: "对局套牌",
      autoMatchedDeckId: "active-deck",
      summary: { totalCards: 1, remainingCards: 1 }
    });
  });

  it("rejects a selected collection deck when Power.log reports a different real deck size", () => {
    const engine = new TrackerEngine({
      collectionDecks: [
        createCollectionDeck("stale-20", "旧的 20 张套牌", [{ name: "Sample Singleton", count: 20, cardId: "TEST_001" }])
      ]
    });

    engine.applyLine("D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME");
    engine.setFriendlyDeckSnapshot({ initialDeckSize: 40, remainingDeckSize: 34 });

    expect(engine.activateCollectionDeck("stale-20")).toBe(false);
    engine.useUnmatchedDeckSnapshot();

    expect(engine.getState()).toMatchObject({
      deckName: "等待精确识别",
      autoMatchedDeckId: undefined,
      summary: { totalCards: 40, remainingCards: 34, drawnCards: 6 }
    });
  });

  it("accepts Hearthstone's explicit selected deck even when the deck code is missing cards", () => {
    const engine = new TrackerEngine({
      collectionDecks: [
        createCollectionDeck("explicit-20", "偷取牌库", [{ name: "Sample Singleton", count: 20, cardId: "TEST_001" }])
      ]
    });

    engine.applyLine("D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME");
    engine.setFriendlyDeckSnapshot({ initialDeckSize: 30, remainingDeckSize: 27 });

    expect(engine.activateExplicitCollectionDeck("explicit-20")).toBe(true);
    expect(engine.getState()).toMatchObject({
      deckName: "偷取牌库",
      autoMatchedDeckId: "explicit-20",
      deckIdentity: {
        status: "confirmed",
        source: "decks-log",
        deckId: "explicit-20"
      },
      summary: { totalCards: 30, remainingCards: 27, drawnCards: 3 }
    });
    expect(engine.getState().deck.find((card) => card.name === "日志缺失的收藏牌")).toMatchObject({
      count: 10
    });
  });

  it("accepts the selected base deck when game-start effects add extra unknown cards", () => {
    const engine = new TrackerEngine({
      collectionDecks: [
        createCollectionDeck("base-deck", "已选套牌", [
          { name: "Sample Singleton", count: 1, cardId: "TEST_001" },
          { name: "Sample Pair", count: 1, cardId: "TEST_002" }
        ])
      ]
    });
    engine.setFriendlyController(2);
    engine.applyLine("D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME");
    engine.setFriendlyDeckSnapshot({ initialDeckSize: 4, remainingDeckSize: 3, baseDeckSize: 2 });

    expect(engine.activateCollectionDeck("base-deck")).toBe(true);
    expect(engine.getState()).toMatchObject({
      deckName: "已选套牌",
      autoMatchedDeckId: "base-deck",
      summary: { totalCards: 4, remainingCards: 3, drawnCards: 1 }
    });
    expect(engine.getState().deck.find((card) => card.name === "对局生成的未知牌")).toMatchObject({
      count: 2,
      remaining: 1,
      drawn: 1
    });

    engine.applyLine(
      "D 12:00:01.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Sample Multi id=64 zone=DECK zonePos=1 cardId=TEST_003 player=2] tag=ZONE value=HAND"
    );

    expect(engine.getState()).toMatchObject({ summary: { totalCards: 4, remainingCards: 2, drawnCards: 2 } });
    expect(engine.getState().deck.find((card) => card.name === "对局生成的未知牌")).toMatchObject({ remaining: 0, drawn: 2 });
  });

  it("lets Hearthstone's selected deck override an earlier automatic guess", () => {
    const engine = new TrackerEngine({
      collectionDecks: [
        createCollectionDeck("deck-a", "猜测套牌", [{ name: "Sample Singleton", count: 1, cardId: "TEST_001" }]),
        createCollectionDeck("deck-b", "已选套牌", [{ name: "Sample Pair", count: 2, cardId: "TEST_002" }])
      ]
    });

    engine.applyLine("D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME");
    expect(engine.activateCollectionDeck("deck-a")).toBe(true);
    expect(engine.activateCollectionDeck("deck-b")).toBe(true);

    expect(engine.getState()).toMatchObject({
      deckName: "已选套牌",
      autoMatchedDeckId: "deck-b",
      summary: { totalCards: 2, remainingCards: 2, drawnCards: 0 }
    });
  });

  it("waits for two distinct friendly cards before auto matching a unique collection deck", () => {
    const engine = new TrackerEngine({
      cardDatabase: cardDb,
      collectionDecks: [
        createCollectionDeck("deck-a", "自动套牌 A", [
          { name: "Sample Singleton", count: 1, cardId: "TEST_001" },
          { name: "Sample Pair", count: 1, cardId: "TEST_002" }
        ])
      ]
    });
    engine.setFriendlyController(1);

    engine.applyLine(
      "D 12:00:00.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=64 zone=DECK zonePos=1 cardId=TEST_001 player=2] tag=ZONE value=HAND"
    );
    expect(engine.getState().autoMatchedDeckId).toBeUndefined();

    engine.applyLine("D 12:00:01.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME");
    engine.applyLine(
      "D 12:00:02.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=65 zone=DECK zonePos=1 cardId=TEST_001 player=1] tag=ZONE value=HAND"
    );
    expect(engine.getState().autoMatchedDeckId).toBeUndefined();

    engine.applyLine(
      "D 12:00:03.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=66 zone=DECK zonePos=2 cardId=TEST_002 player=1] tag=ZONE value=HAND"
    );
    expect(engine.getState().autoMatchedDeckId).toBe("deck-a");
  });

  it("does not auto match when the same friendly card is observed twice", () => {
    const engine = new TrackerEngine({
      cardDatabase: cardDb,
      collectionDecks: [
        createCollectionDeck("deck-a", "自动套牌 A", [
          { name: "Sample Pair", count: 2, cardId: "TEST_002" },
          { name: "Sample Multi", count: 1, cardId: "TEST_003" }
        ])
      ]
    });
    engine.setFriendlyController(1);

    engine.applyText([
      "D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME",
      "D 12:00:01.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=64 zone=DECK zonePos=1 cardId=TEST_002 player=1] tag=ZONE value=HAND",
      "D 12:00:02.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=65 zone=DECK zonePos=2 cardId=TEST_002 player=1] tag=ZONE value=HAND"
    ].join("\n"));

    expect(engine.getState().autoMatchedDeckId).toBeUndefined();
  });

  it("publishes waiting and probable evidence without activating a slightly leading similar deck", () => {
    const engine = new TrackerEngine({
      cardDatabase: cardDb,
      collectionDecks: [
        createCollectionDeck("deck-a", "精确候选", [
          { name: "Sample Singleton", count: 1, cardId: "TEST_001" },
          { name: "Sample Pair", count: 1, cardId: "TEST_002" }
        ]),
        createCollectionDeck("deck-b", "相似候选", [
          { name: "Sample Singleton", count: 1, cardId: "TEST_001" },
          { name: "Sample Pair", count: 1, cardId: "ALT_TEST_002" }
        ])
      ]
    });
    engine.setFriendlyController(1);

    engine.applyText([
      "D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME",
      "D 12:00:01.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=64 zone=DECK zonePos=1 cardId=TEST_001 player=1] tag=ZONE value=HAND"
    ].join("\n"));

    expect(engine.getState()).toMatchObject({
      autoMatchedDeckId: undefined,
      deckIdentity: {
        status: "waiting",
        source: "inferred",
        observedDistinctCards: 1,
        candidateCount: 2,
        bestScore: 3,
        scoreLead: 0
      }
    });
    expect(engine.getState().deckIdentity?.deckId).toBeUndefined();

    engine.applyLine(
      "D 12:00:02.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=65 zone=DECK zonePos=2 cardId=TEST_002 player=1] tag=ZONE value=HAND"
    );

    expect(engine.getState()).toMatchObject({
      autoMatchedDeckId: undefined,
      deckName: undefined,
      deckIdentity: {
        status: "probable",
        source: "inferred",
        deckId: "deck-a",
        observedDistinctCards: 2,
        candidateCount: 2,
        bestScore: 6,
        scoreLead: 2
      }
    });
  });

  it("waits for the friendly controller before classifying controller 1 plays without collection decks", () => {
    const engine = new TrackerEngine();

    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Pending Card id=64 zone=DECK zonePos=1 cardId=PENDING_CARD player=1] tag=ZONE value=HAND
D 12:00:02.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Pending Card id=64 zone=HAND zonePos=1 cardId=PENDING_CARD player=1] tag=ZONE value=PLAY
D 12:00:03.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=Pending Card id=64 zone=HAND zonePos=1 cardId=PENDING_CARD player=1] CardID=PENDING_CARD
`);

    expect(engine.getState().opponentPlayed).toEqual([]);

    engine.setFriendlyController(2);

    const state = engine.getState();
    expect(state.opponentPlayed).toEqual([
      expect.objectContaining({ name: "Pending Card", cardId: "PENDING_CARD", played: 1 })
    ]);
    expect(state.events
      .filter((event) => event.cardId === "PENDING_CARD")
      .reverse()
      .map((event) => ({ kind: event.kind, fromZone: event.fromZone, toZone: event.toZone })))
      .toEqual([
        { kind: "zone-change", fromZone: "DECK", toZone: "HAND" },
        { kind: "opponent-play", fromZone: "HAND", toZone: "PLAY" }
      ]);

    engine.setFriendlyController(2);
    expect(engine.getState().opponentPlayed).toEqual([
      expect.objectContaining({ name: "Pending Card", cardId: "PENDING_CARD", played: 1 })
    ]);
  });

  it("replays mixed friendly and opponent plays once after controller identity arrives", () => {
    const engine = new TrackerEngine({ deckText: "1x Friendly Loaded Card" });

    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Friendly Loaded Card id=64 zone=HAND zonePos=1 cardId=FRIENDLY_LOADED player=1] tag=ZONE value=PLAY
D 12:00:02.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Opponent Pending Card id=65 zone=HAND zonePos=1 cardId=OPPONENT_PENDING player=2] tag=ZONE value=PLAY
`);

    expect(engine.getState().opponentPlayed).toEqual([]);

    engine.setFriendlyController(1);

    const state = engine.getState();
    expect(state.deck.find((card) => card.name === "Friendly Loaded Card")).toMatchObject({ played: 1 });
    expect(state.opponentPlayed).toEqual([
      expect.objectContaining({ name: "Opponent Pending Card", cardId: "OPPONENT_PENDING", played: 1 })
    ]);
    expect(state.events.filter((event) => event.kind === "friendly-play")).toHaveLength(1);
    expect(state.events.filter((event) => event.kind === "opponent-play")).toHaveLength(1);
  });

  it("waits for controllerless zone changes that inherit an existing entity controller", () => {
    const engine = new TrackerEngine({ deckText: "1x Controllerless Card" });

    engine.applyText(`
D 12:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME
D 12:00:01.000 PowerTaskList.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=Controllerless Card id=64 zone=SETASIDE zonePos=1 cardId=CONTROLLERLESS player=1] CardID=CONTROLLERLESS
D 12:00:02.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Controllerless Card id=64 zone=SETASIDE zonePos=1 cardId=CONTROLLERLESS player=1] tag=ZONE value=HAND
D 12:00:03.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=Controllerless Card id=64 zone=HAND zonePos=1 cardId=CONTROLLERLESS] tag=ZONE value=PLAY
`);

    expect(engine.getState()).toMatchObject({ friendlyHand: [], friendlyOther: [], opponentPlayed: [] });

    engine.setFriendlyController(1);

    const state = engine.getState();
    expect(state.friendlyHand).toEqual([]);
    expect(state.friendlyOther).toEqual([
      expect.objectContaining({ name: "Controllerless Card", cardId: "CONTROLLERLESS", count: 1 })
    ]);
    expect(state.events
      .filter((event) => event.cardId === "CONTROLLERLESS")
      .reverse()
      .map((event) => ({ fromZone: event.fromZone, toZone: event.toZone })))
      .toEqual([
        { fromZone: "SETASIDE", toZone: "HAND" },
        { fromZone: "HAND", toZone: "PLAY" }
      ]);
  });

  it("waits for a delayed local id and keeps same-name opponent cards separate", () => {
    const engine = new TrackerEngine({
      collectionDecks: [
        createCollectionDeck("same-name", "同名测试套牌", [
          { name: "Twin Card", count: 1, cardId: "CARD_A" },
          { name: "Twin Card", count: 1, cardId: "CARD_B" },
          { name: "Second Friendly Card", count: 1, cardId: "CARD_C" }
        ])
      ]
    });

    engine.applyLine("D 12:00:00.000 PowerTaskList.DebugPrintPower() -     CREATE_GAME");
    engine.applyLine(
      "D 12:00:01.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Twin Card id=64 zone=DECK zonePos=1 cardId=CARD_B player=2] tag=ZONE value=HAND"
    );
    engine.setFriendlyController(1);
    engine.applyLine(
      "D 12:00:02.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Twin Card id=65 zone=DECK zonePos=1 cardId=CARD_A player=1] tag=ZONE value=HAND"
    );
    engine.applyLine(
      "D 12:00:02.500 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Second Friendly Card id=67 zone=DECK zonePos=2 cardId=CARD_C player=1] tag=ZONE value=HAND"
    );
    engine.applyLine(
      "D 12:00:03.000 PowerTaskList.DebugPrintPower() -     TAG_CHANGE Entity=[entityName=Twin Card id=66 zone=HAND zonePos=1 cardId=CARD_B player=2] tag=ZONE value=PLAY"
    );

    const state = engine.getState();
    expect(state.autoMatchedDeckId).toBe("same-name");
    expect(state.deck).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Twin Card", cardId: "CARD_A", drawn: 1, remaining: 0 }),
      expect.objectContaining({ name: "Twin Card", cardId: "CARD_B", drawn: 0, remaining: 1 }),
      expect.objectContaining({ name: "Second Friendly Card", cardId: "CARD_C", drawn: 1, remaining: 0 })
    ]));
    expect(state.opponentPlayed).toEqual([
      expect.objectContaining({ name: "Twin Card", cardId: "CARD_B", played: 1 })
    ]);
  });

  describe("public card lifecycle tracking", () => {
    it("records friendly, opponent, duplicate, hidden, and late-revealed PLAY actions once", () => {
      const engine = createLifecycleEngine();
      engine.applyText(`
D 12:00:00.000 GameState.DebugPrintPower() - CREATE_GAME
D 12:00:01.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=友方使用牌 id=51 zone=HAND cardId=FRIEND_USE player=1]
D 12:00:01.100 GameState.DebugPrintPower() - BLOCK_END
D 12:00:01.000 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=友方使用牌 id=51 zone=HAND cardId=FRIEND_USE player=1]
D 12:00:01.100 PowerTaskList.DebugPrintPower() - BLOCK_END
D 12:00:02.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=对手使用牌 id=61 zone=HAND cardId=OPP_USE player=2]
D 12:00:02.100 GameState.DebugPrintPower() - BLOCK_END
D 12:00:03.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=UNKNOWN ENTITY id=71 zone=HAND cardId= player=1]
D 12:00:03.100 GameState.DebugPrintPower() - BLOCK_END
D 12:00:04.000 GameState.DebugPrintPower() - BLOCK_START BlockType=POWER Entity=[entityName=古神子法术 id=81 zone=PLAY cardId=AUTO_SPELL player=1]
D 12:00:04.100 GameState.DebugPrintPower() - BLOCK_END
`);

      const beforeReveal = engine.getState().cardTracking!;
      expect(beforeReveal.friendly.used.totalCount).toBe(2);
      expect(beforeReveal.opponent.used.totalCount).toBe(1);
      expect(beforeReveal.friendly.used.items.find((item) => item.entityId === "71")).toMatchObject({
        confidence: "confirmed"
      });
      expect(beforeReveal.friendly.used.items.find((item) => item.entityId === "71")?.card).toBeUndefined();
      expect(beforeReveal.friendly.used.items.find((item) => item.entityId === "51")?.id)
        .toMatch(/^game-1:use:\d+$/);

      engine.applyLine(
        "D 12:00:05.000 GameState.DebugPrintPower() - SHOW_ENTITY - Updating Entity=[entityName=晚揭示使用牌 id=71 zone=PLAY cardId= player=1] CardID=LATE_USE"
      );

      const afterReveal = engine.getState().cardTracking!;
      expect(afterReveal.friendly.used.totalCount).toBe(2);
      expect(afterReveal.friendly.used.items.find((item) => item.entityId === "71")).toMatchObject({
        card: expect.objectContaining({ cardId: "LATE_USE", name: "晚揭示使用牌" })
      });
      expect(() => parsePublicTrackerState(engine.getState())).not.toThrow();
    });

    it("creates a new usageId only after the same entity truly returns to hand", () => {
      const engine = createLifecycleEngine();
      engine.applyText(`
D 13:00:00.000 GameState.DebugPrintPower() - CREATE_GAME
D 13:00:01.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=友方使用牌 id=90 zone=HAND cardId=FRIEND_USE player=1]
D 13:00:01.100 GameState.DebugPrintPower() - BLOCK_END
D 13:00:01.000 PowerTaskList.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=友方使用牌 id=90 zone=HAND cardId=FRIEND_USE player=1]
D 13:00:01.100 PowerTaskList.DebugPrintPower() - BLOCK_END
D 13:00:02.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=友方使用牌 id=90 zone=PLAY cardId=FRIEND_USE player=1] tag=ZONE value=HAND
D 13:00:03.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=友方使用牌 id=90 zone=HAND cardId=FRIEND_USE player=1]
D 13:00:03.100 GameState.DebugPrintPower() - BLOCK_END
`);

      const used = engine.getState().cardTracking!.friendly.used;
      expect(used.totalCount).toBe(2);
      expect(used.items.map((item) => item.entityId)).toEqual(["90", "90"]);
      expect(new Set(used.items.map((item) => item.id)).size).toBe(2);
      expect(used.items.map((item) => item.sequence)).toEqual([2, 1]);
    });

    it("records a named PLAY missing from the database and does not duplicate it after a late reveal", () => {
      const engine = createLifecycleEngine();
      engine.applyText(`
D 13:30:00.000 GameState.DebugPrintPower() - CREATE_GAME
D 13:30:01.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=数据库外卡牌 id=91 zone=HAND cardId=OUTSIDE_DB player=1]
D 13:30:01.100 GameState.DebugPrintPower() - BLOCK_END
`);

      expectSingleOutsideDatabaseUse(engine);

      engine.setCardDatabase(createCardDatabase([
        { id: 91, cardId: "OUTSIDE_DB", name: "数据库外卡牌", type: "SPELL" }
      ]));
      expectSingleOutsideDatabaseUse(engine);

      engine.applyLine(
        "D 13:30:02.000 GameState.DebugPrintPower() - SHOW_ENTITY - Updating Entity=[entityName=数据库外卡牌 id=91 zone=PLAY cardId= player=1] CardID=OUTSIDE_DB"
      );

      expectSingleOutsideDatabaseUse(engine);
    });

    it("records an inferred burn once, updates all physical zones, and allows a later real reburn", () => {
      const engine = createLifecycleEngine("2x 烧毁测试牌");
      engine.applyText([
        "D 14:00:00.000 GameState.DebugPrintPower() - CREATE_GAME",
        ...createHandEntityLines(10, 1),
        "D 14:00:20.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=烧毁测试牌 id=43 zone=DECK cardId=BURNED_CARD player=1] tag=ZONE value=GRAVEYARD",
        "D 14:00:20.000 PowerTaskList.DebugPrintPower() - TAG_CHANGE Entity=[entityName=烧毁测试牌 id=43 zone=DECK cardId=BURNED_CARD player=1] tag=ZONE value=GRAVEYARD"
      ].join("\n"));

      const first = engine.getState().cardTracking!;
      expect(first.friendly.current.deck.totalCount).toBe(1);
      expect(first.friendly.current.hand.totalCount).toBe(10);
      expect(first.friendly.current.graveyard).toMatchObject({
        totalCount: 1,
        cards: [expect.objectContaining({ cardId: "BURNED_CARD", name: "烧毁测试牌", count: 1 })]
      });
      expect(first.friendly.burned).toMatchObject({
        totalCount: 1,
        items: [expect.objectContaining({
          id: expect.stringMatching(/^game-1:burn:\d+$/),
          entityId: "43",
          confidence: "inferred"
        })]
      });
      expect(first.friendly.used.totalCount).toBe(0);

      engine.applyText(`
D 14:01:00.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=烧毁测试牌 id=43 zone=GRAVEYARD cardId=BURNED_CARD player=1] tag=ZONE value=DECK
D 14:01:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=烧毁测试牌 id=43 zone=DECK cardId=BURNED_CARD player=1] tag=ZONE value=GRAVEYARD
`);
      const second = engine.getState().cardTracking!;
      expect(second.friendly.burned.totalCount).toBe(2);
      expect(new Set(second.friendly.burned.items.map((item) => item.id)).size).toBe(2);
    });

    it("keeps a hidden burn action and fills its identity without adding another event", () => {
      const engine = createLifecycleEngine("1x 烧毁测试牌");
      engine.applyText([
        "D 15:00:00.000 GameState.DebugPrintPower() - CREATE_GAME",
        ...createHandEntityLines(10, 1),
        "D 15:00:20.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY id=44 zone=DECK cardId= player=1] tag=ZONE value=GRAVEYARD"
      ].join("\n"));

      expect(engine.getState().cardTracking!.friendly.burned).toMatchObject({
        totalCount: 1,
        items: [expect.objectContaining({ entityId: "44" })]
      });
      expect(engine.getState().cardTracking!.friendly.burned.items[0]?.card).toBeUndefined();

      engine.applyLine(
        "D 15:00:21.000 GameState.DebugPrintPower() - SHOW_ENTITY - Updating Entity=[entityName=烧毁测试牌 id=44 zone=GRAVEYARD cardId= player=1] CardID=BURNED_CARD"
      );
      expect(engine.getState().cardTracking!.friendly.burned).toMatchObject({
        totalCount: 1,
        items: [expect.objectContaining({
          entityId: "44",
          card: expect.objectContaining({ cardId: "BURNED_CARD", name: "烧毁测试牌" })
        })]
      });
    });

    it("does not count an attached enchantment as the tenth hand card", () => {
      const engine = createLifecycleEngine("1x 烧毁测试牌");
      engine.applyText([
        "D 16:00:00.000 GameState.DebugPrintPower() - CREATE_GAME",
        ...createHandEntityLines(9, 1),
        "D 16:00:10.000 GameState.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=附属测试实体 id=199 zone=HAND cardId=ATTACHMENT player=1] CardID=ATTACHMENT",
        "D 16:00:10.100 GameState.DebugPrintPower() - tag=ATTACHED value=100",
        "D 16:00:20.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=烧毁测试牌 id=45 zone=DECK cardId=BURNED_CARD player=1] tag=ZONE value=GRAVEYARD"
      ].join("\n"));

      const tracking = engine.getState().cardTracking!;
      expect(tracking.friendly.current.hand.totalCount).toBe(9);
      expect(tracking.friendly.burned.totalCount).toBe(0);
      expect(tracking.friendly.current.graveyard.totalCount).toBe(1);
    });

    it("does not infer a burn from a plain nine-card hand", () => {
      const engine = createLifecycleEngine("1x 烧毁测试牌");
      engine.applyText([
        "D 16:30:00.000 GameState.DebugPrintPower() - CREATE_GAME",
        ...createHandEntityLines(9, 1),
        "D 16:30:20.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=烧毁测试牌 id=45 zone=DECK cardId=BURNED_CARD player=1] tag=ZONE value=GRAVEYARD"
      ].join("\n"));

      const tracking = engine.getState().cardTracking!;
      expect(tracking.friendly.current.hand.totalCount).toBe(9);
      expect(tracking.friendly.current.graveyard.totalCount).toBe(1);
      expect(tracking.friendly.burned.totalCount).toBe(0);
    });

    it("counts only physical public zones and never invents hidden opponent cards or histories", () => {
      const engine = createLifecycleEngine("2x 友方使用牌");
      engine.applyText([
        "D 16:40:00.000 GameState.DebugPrintPower() - CREATE_GAME",
        "D 16:40:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=友方使用牌 id=501 zone=DECK cardId=FRIEND_USE player=1] tag=ZONE value=HAND",
        "D 16:40:02.000 GameState.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=烧毁测试牌 id=502 zone=GRAVEYARD cardId=BURNED_CARD player=1] CardID=BURNED_CARD",
        "D 16:40:03.000 GameState.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=友方使用牌 id=503 zone=SETASIDE cardId=FRIEND_USE player=1] CardID=FRIEND_USE",
        "D 16:40:04.000 GameState.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=友方使用牌 id=504 zone=UNKNOWN cardId=FRIEND_USE player=1] CardID=FRIEND_USE",
        "D 16:40:05.000 GameState.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY id=601 zone=DECK cardId= player=2] CardID=",
        "D 16:40:06.000 GameState.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY id=602 zone=HAND cardId= player=2] CardID="
      ].join("\n"));

      const tracking = engine.getState().cardTracking!;
      expect(tracking.friendly.current.deck).toMatchObject({
        status: "known",
        knownCount: 1,
        totalCount: 1
      });
      expect(tracking.friendly.current.hand.cards).toEqual([
        expect.objectContaining({ cardId: "FRIEND_USE", count: 1 })
      ]);
      expect(tracking.friendly.current.graveyard.totalCount).toBe(1);
      expect(tracking.friendly.current.graveyard.cards).toEqual([
        expect.objectContaining({ cardId: "BURNED_CARD", count: 1 })
      ]);
      expect(tracking.opponent.current.deck).toMatchObject({
        status: "partial",
        knownCount: 0,
        totalCount: 1,
        cards: []
      });
      expect(tracking.opponent.current.hand).toMatchObject({
        status: "partial",
        knownCount: 0,
        totalCount: 1,
        cards: []
      });
      expect(Object.values(tracking.friendly.current)
        .reduce((total, group) => total + (group.totalCount ?? 0), 0)).toBe(3);
      expect(Object.values(tracking.friendly.current)
        .flatMap((group) => group.cards)
        .some((card) => card.cardId === "FRIEND_USE" && card.count > 1)).toBe(false);
      expect(Object.keys(tracking.detailsByCardKey)).toEqual(
        expect.arrayContaining(["id:friend_use", "id:burned_card"])
      );
      expect(tracking.friendly.used.totalCount).toBe(0);
      expect(tracking.friendly.burned.totalCount).toBe(0);
    });

    it("publishes the newest 30 use and burn actions while preserving whole-game totals", () => {
      const engine = createLifecycleEngine();
      engine.applyText([
        "D 16:50:00.000 GameState.DebugPrintPower() - CREATE_GAME",
        ...createHandEntityLines(10, 1, 700),
        ...Array.from({ length: 31 }, (_, index) => [
          `D 16:51:${String(index + 1).padStart(2, "0")}.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=友方使用牌 id=${1001 + index} zone=HAND cardId=FRIEND_USE player=1]`,
          `D 16:51:${String(index + 1).padStart(2, "0")}.100 GameState.DebugPrintPower() - BLOCK_END`
        ]).flat(),
        ...Array.from({ length: 31 }, (_, index) =>
          `D 16:52:${String(index + 1).padStart(2, "0")}.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=烧毁测试牌 id=${2001 + index} zone=DECK cardId=BURNED_CARD player=1] tag=ZONE value=GRAVEYARD`
        )
      ].join("\n"));

      const tracking = engine.getState().cardTracking!;
      expect(tracking.friendly.used).toMatchObject({
        totalCount: 31,
        truncated: true
      });
      expect(tracking.friendly.used.items).toHaveLength(30);
      expect(tracking.friendly.used.items.map((item) => item.entityId)).toEqual(
        Array.from({ length: 30 }, (_, index) => String(1031 - index))
      );
      expect(tracking.friendly.burned).toMatchObject({
        totalCount: 31,
        truncated: true
      });
      expect(tracking.friendly.burned.items).toHaveLength(30);
      expect(tracking.friendly.burned.items.map((item) => item.entityId)).toEqual(
        Array.from({ length: 30 }, (_, index) => String(2031 - index))
      );
    });

    it("fills only missing history identity fields and keeps the recorded name", () => {
      const engine = createLifecycleEngine();
      engine.applyText([
        "D 16:55:00.000 GameState.DebugPrintPower() - CREATE_GAME",
        "D 16:55:01.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=记录时名称 id=801 zone=HAND cardId= player=1]",
        "D 16:55:01.100 GameState.DebugPrintPower() - BLOCK_END",
        "D 16:55:02.000 GameState.DebugPrintPower() - SHOW_ENTITY - Updating Entity=[entityName=晚揭示使用牌 id=801 zone=PLAY cardId= player=1] CardID=LATE_USE"
      ].join("\n"));

      expect(engine.getState().cardTracking!.friendly.used.items[0]?.card).toEqual({
        cardKey: "id:late_use",
        cardId: "LATE_USE",
        name: "记录时名称"
      });
    });

    it("reads secret slots once and keeps slot count separate from candidates", () => {
      const secretDatabase = createCardDatabase(
        Array.from({ length: 5 }, (_, index) => ({
          id: 3000 + index,
          cardId: `SECRET_${index + 1}`,
          name: `测试奥秘${index + 1}`,
          collectible: 1,
          type: "SPELL",
          mechanics: ["SECRET"]
        }))
      );
      const emptyEngine = new TrackerEngine({ cardDatabase: secretDatabase });
      emptyEngine.setFriendlyController(1);
      expect(emptyEngine.getState().cardTracking!.opponent.current.secret).toMatchObject({
        status: "known",
        knownCount: 0,
        totalCount: 0,
        cards: []
      });

      const engine = new TrackerEngine({ cardDatabase: secretDatabase });
      engine.setFriendlyController(1);
      engine.applyText([
        "D 16:56:00.000 GameState.DebugPrintPower() - CREATE_GAME",
        "D 16:56:01.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=UNKNOWN ENTITY id=901 zone=HAND cardId= player=2] tag=ZONE value=SECRET"
      ].join("\n"));
      const secretTracker = Reflect.get(engine, "secretTracker") as { getSlots: () => unknown };
      const getSlots = vi.spyOn(secretTracker, "getSlots");

      const tracking = engine.getState().cardTracking!;

      expect(getSlots).toHaveBeenCalledTimes(1);
      expect(tracking.opponentSecretSlots).toHaveLength(1);
      expect(tracking.opponentSecretSlots[0]?.candidates).toHaveLength(5);
      expect(tracking.opponentSecretSlots[0]?.candidates.filter(
        (candidate) => candidate.cardId === "SECRET_1"
      )).toHaveLength(1);
      expect(tracking.opponent.current.secret).toMatchObject({
        status: "partial",
        knownCount: 0,
        totalCount: 1,
        cards: []
      });
    });

    it("deduplicates duplicate CREATE_GAME records", () => {
      const engine = createLifecycleEngine("1x 烧毁测试牌");
      seedResetSensitiveLifecycle(engine);
      const first = engine.getState().cardTracking!;
      expect(first.friendly.used.totalCount).toBe(2);
      expect(first.friendly.burned.totalCount).toBe(1);

      engine.applyLine("D 17:00:00.000 PowerTaskList.DebugPrintPower() - CREATE_GAME");
      const duplicateStart = engine.getState().cardTracking!;
      expect(duplicateStart.gameKey).toBe(first.gameKey);
      expect(duplicateStart.friendly.used.totalCount).toBe(2);
      expect(duplicateStart.friendly.burned.totalCount).toBe(1);
      expect(findLatestAncientOutcomeSections(engine)).toHaveLength(1);
    });

    it("resetForGame clears use, burn, and ancient outcome deduplication before replay", () => {
      const engine = createLifecycleEngine("1x 烧毁测试牌");
      seedResetSensitiveLifecycle(engine);
      const oldGameKey = engine.getState().cardTracking!.gameKey;

      engine.resetForGame();

      expect(engine.getState().cardTracking).toMatchObject({
        friendly: { used: { totalCount: 0 }, burned: { totalCount: 0 } }
      });
      expect(engine.getState().cardTracking!.gameKey).not.toBe(oldGameKey);
      engine.applyLine(
        "D 17:00:30.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=匣中古神 id=60 zone=DECK cardId=TOY_372 player=1] tag=ZONE value=HAND"
      );
      expect(findLatestAncientOutcomeSections(engine)).toBeUndefined();
      engine.applyLine(
        "D 17:00:30.500 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=匣中古神 id=60 zone=HAND cardId=TOY_372 player=1] tag=ZONE value=DECK"
      );

      expectResetSensitiveLifecycleCanReplay(engine);
    });

    it("resetAfterGame clears use, burn, and ancient outcome state", () => {
      const engine = createLifecycleEngine("1x 烧毁测试牌");
      seedResetSensitiveLifecycle(engine);

      engine.resetAfterGame();

      expect(engine.getState().cardTracking).toMatchObject({
        gameKey: "no-game",
        friendly: { used: { totalCount: 0 }, burned: { totalCount: 0 } }
      });
      engine.loadDeckCards([{ name: "匣中古神", count: 1, cardId: "TOY_372" }], "重置检查牌库");
      expect(findLatestAncientOutcomeSections(engine)).toBeUndefined();

      resumeLifecycleRecordingWithoutAnotherReset(engine);
      expectResetSensitiveLifecycleCanReplay(engine);
    });

    it("clearArenaDeck clears use, burn, and ancient outcome state", () => {
      const engine = createLifecycleEngine();
      engine.loadDeckCards([
        { name: "烧毁测试牌", count: 1, cardId: "BURNED_CARD" },
        { name: "匣中古神", count: 1, cardId: "TOY_372" }
      ], "竞技场牌库");
      seedResetSensitiveLifecycle(engine);

      engine.clearArenaDeck();

      expect(engine.getState().cardTracking).toMatchObject({
        gameKey: "no-game",
        friendly: { used: { totalCount: 0 }, burned: { totalCount: 0 } }
      });
      expect(findLatestAncientOutcomeSections(engine)).toBeUndefined();

      resumeLifecycleRecordingWithoutAnotherReset(engine);
      prepareRetainedArenaEntitiesForReplay(engine);
      expectResetSensitiveLifecycleCanReplay(engine, createRetainedArenaPreBurnLines());
    });
  });
});

function createLifecycleEngine(deckText?: string) {
  const cardDatabase = createCardDatabase([
    { id: 1, cardId: "FRIEND_USE", name: "友方使用牌", type: "SPELL" },
    { id: 2, cardId: "OPP_USE", name: "对手使用牌", type: "MINION" },
    { id: 3, cardId: "LATE_USE", name: "晚揭示使用牌", type: "SPELL" },
    { id: 4, cardId: "AUTO_SPELL", name: "古神子法术", type: "SPELL" },
    { id: 5, cardId: "BURNED_CARD", name: "烧毁测试牌", type: "SPELL" },
    { id: 6, cardId: "ATTACHMENT", name: "附属测试实体", type: "ENCHANTMENT" },
    {
      id: 7,
      cardId: "TOY_372",
      name: "匣中古神",
      type: "SPELL",
      text: "随机施放5个法术。"
    },
    { id: 8, cardId: "RESET_OUTCOME", name: "重置结果法术", type: "SPELL" }
  ]);
  const engine = new TrackerEngine({ cardDatabase, deckText });
  engine.setFriendlyController(1);
  return engine;
}

function createOutcomeBindingEngine() {
  const cardDatabase = createCardDatabase([
    {
      id: 103270,
      cardId: "TOY_372",
      name: "匣中古神",
      collectible: 1,
      type: "SPELL",
      text: "随机施放5个法术。"
    },
    ...Array.from({ length: 6 }, (_, index) => ({
      id: 9200 + index,
      cardId: `SPELL_${index + 1}`,
      name: `第${index + 1}张法术`,
      collectible: 1,
      type: "SPELL"
    })),
    {
      id: 9300,
      cardId: "NORMAL_SPELL",
      name: "普通法术",
      collectible: 1,
      type: "SPELL"
    }
  ]);
  const engine = new TrackerEngine({ cardDatabase });
  engine.setFriendlyController(1);
  return engine;
}

function renderRandomSpellCapture(input: {
  readonly source: "GameState" | "PowerTaskList";
  readonly time: string;
  readonly sourceEntityId: number;
  readonly resultEntityStart: number;
  readonly resultCardIds: readonly string[];
  readonly controller: number;
}) {
  const prefix = (suffix: string) =>
    `D ${input.time}.${suffix} ${input.source}.DebugPrintPower() -`;
  return [
    `${prefix("000")} BLOCK_START BlockType=PLAY Entity=[entityName=匣中古神 id=${input.sourceEntityId} zone=HAND cardId=TOY_372 player=${input.controller}]`,
    `${prefix("100")}     BLOCK_START BlockType=POWER Entity=[entityName=匣中古神 id=${input.sourceEntityId} zone=PLAY cardId=TOY_372 player=${input.controller}]`,
    ...input.resultCardIds.map((cardId, index) =>
      `${prefix(`2${String(index).padStart(2, "0")}`)}         FULL_ENTITY - Creating ID=${input.resultEntityStart + index} CardID=${cardId}`
    ),
    `${prefix("800")}     BLOCK_END`,
    `${prefix("900")} BLOCK_END`
  ];
}

function seedResetSensitiveLifecycle(engine: TrackerEngine) {
  engine.applyText([
    "D 17:00:00.000 GameState.DebugPrintPower() - CREATE_GAME",
    ...createResetSensitiveLifecycleLines()
  ].join("\n"));
  expect(engine.getState().cardTracking!.friendly).toMatchObject({
    used: { totalCount: 2 },
    burned: { totalCount: 1 }
  });
  expect(findLatestAncientOutcomeSections(engine)).toHaveLength(1);
}

function expectResetSensitiveLifecycleCanReplay(
  engine: TrackerEngine,
  preBurnLines = createResetSensitivePreBurnLines()
) {
  engine.applyText(preBurnLines.join("\n"));
  expect(engine.getState().cardTracking!.friendly.current.hand.totalCount).toBe(10);

  engine.applyLine(createResetSensitiveBurnLine());
  expect(engine.getState().cardTracking!.friendly.burned.totalCount).toBe(1);

  engine.applyText(createResetSensitiveOutcomeLines().join("\n"));
  expect(engine.getState().cardTracking!.friendly).toMatchObject({
    used: { totalCount: 2 },
    burned: { totalCount: 1 }
  });
  expect(findLatestAncientOutcomeSections(engine)).toHaveLength(1);
}

function createResetSensitiveLifecycleLines() {
  return [
    ...createResetSensitivePreBurnLines(),
    createResetSensitiveBurnLine(),
    ...createResetSensitiveOutcomeLines()
  ];
}

function createResetSensitivePreBurnLines() {
  return [
    "D 17:00:01.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=友方使用牌 id=51 zone=HAND cardId=FRIEND_USE player=1]",
    "D 17:00:01.100 GameState.DebugPrintPower() - BLOCK_END",
    ...createHandEntityLines(10, 1, 300)
  ];
}

function createRetainedArenaPreBurnLines() {
  return [
    "D 17:00:01.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=友方使用牌 id=51 zone=HAND cardId=FRIEND_USE player=1]",
    "D 17:00:01.100 GameState.DebugPrintPower() - BLOCK_END",
    ...Array.from({ length: 10 }, (_, index) =>
      `D 17:00:39.${String(index).padStart(3, "0")} GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=填充手牌${index + 1} id=${300 + index} zone=REMOVEDFROMGAME cardId=FILLER_${300 + index} player=1] tag=ZONE value=HAND`
    )
  ];
}

function createResetSensitiveBurnLine() {
  return "D 17:00:20.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=烧毁测试牌 id=46 zone=DECK cardId=BURNED_CARD player=1] tag=ZONE value=GRAVEYARD";
}

function createResetSensitiveOutcomeLines() {
  return [
    "D 17:00:30.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=匣中古神 id=60 zone=DECK cardId=TOY_372 player=1] tag=ZONE value=HAND",
    "D 17:00:31.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=匣中古神 id=60 zone=HAND cardId=TOY_372 player=1]",
    "D 17:00:32.000 GameState.DebugPrintPower() - BLOCK_START BlockType=POWER Entity=[entityName=匣中古神 id=60 zone=PLAY cardId=TOY_372 player=1]",
    "D 17:00:33.000 GameState.DebugPrintPower() - FULL_ENTITY - Creating ID=71 CardID=RESET_OUTCOME",
    "D 17:00:34.000 GameState.DebugPrintPower() - BLOCK_END",
    "D 17:00:35.000 GameState.DebugPrintPower() - BLOCK_END"
  ];
}

function resumeLifecycleRecordingWithoutAnotherReset(engine: TrackerEngine) {
  Reflect.set(engine, "gameActive", true);
}

function prepareRetainedArenaEntitiesForReplay(engine: TrackerEngine) {
  engine.applyText([
    ...Array.from({ length: 10 }, (_, index) =>
      `D 17:00:36.${String(index).padStart(3, "0")} GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=填充手牌${index + 1} id=${300 + index} zone=HAND cardId=FILLER_${300 + index} player=1] tag=ZONE value=REMOVEDFROMGAME`
    ),
    "D 17:00:37.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=匣中古神 id=60 zone=HAND cardId=TOY_372 player=1] tag=ZONE value=DECK",
    "D 17:00:38.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=烧毁测试牌 id=46 zone=GRAVEYARD cardId=BURNED_CARD player=1] tag=ZONE value=DECK"
  ].join("\n"));
}

function findLatestAncientOutcomeSections(engine: TrackerEngine) {
  return engine.getState().cardTracking?.friendly.used.items
    .find((item) => item.card?.cardId === "TOY_372")
    ?.outcomeSections;
}

function expectSingleOutsideDatabaseUse(engine: TrackerEngine) {
  expect(engine.getState().cardTracking!.friendly.used).toMatchObject({
    totalCount: 1,
    items: [
      expect.objectContaining({
        entityId: "91",
        card: expect.objectContaining({ cardId: "OUTSIDE_DB", name: "数据库外卡牌" })
      })
    ]
  });
}

function createHandEntityLines(count: number, controller: number, startId = 100) {
  return Array.from({ length: count }, (_, index) =>
    `D 11:00:${String(index + 1).padStart(2, "0")}.000 GameState.DebugPrintPower() - FULL_ENTITY - Updating Entity=[entityName=填充手牌${index + 1} id=${startId + index} zone=HAND cardId=FILLER_${startId + index} player=${controller}] CardID=FILLER_${startId + index}`
  );
}

function createCollectionDeck(id: string, name: string, cards: readonly DeckCard[]): CollectionDeck {
  return {
    id,
    name,
    cards,
    rawText: name,
    sourcePath: "/tmp/Decks.log",
    updatedAt: "2026-07-10T00:00:00.000Z",
    warnings: []
  };
}

function encodeDeckString(values: readonly number[]): string {
  return Buffer.from(values.flatMap(encodeUnsignedVarint)).toString("base64");
}

function encodeUnsignedVarint(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value;

  do {
    let byte = remaining % 128;
    remaining = Math.floor(remaining / 128);

    if (remaining > 0) {
      byte += 128;
    }

    bytes.push(byte);
  } while (remaining > 0);

  return bytes;
}
