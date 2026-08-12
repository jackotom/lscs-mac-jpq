import { describe, expect, it } from "vitest";
import { createCardDatabase, type CardDatabase } from "../src/shared/cardDatabase";
import { TrackerEngine } from "../src/shared/trackerEngine";
import { parsePublicTrackerState } from "../src/renderer/runtimeValidation";

interface SmartCounterSnapshot {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly target?: number;
  readonly cardId?: string;
}

function smartCounters(engine: TrackerEngine): readonly SmartCounterSnapshot[] {
  return (engine.getState() as unknown as { readonly smartCounters?: readonly SmartCounterSnapshot[] })
    .smartCounters ?? [];
}

function dragonDatabase(target: 5 | 8): CardDatabase {
  return createCardDatabase([
    {
      id: 100,
      cardId: "TOY_385",
      name: "时空扭曲者扎里米",
      type: "MINION",
      collectible: 1,
      text: `战吼：如果你在本局对战中使用过${target}张其他龙牌，获得一个额外回合。`
    },
    {
      id: 101,
      cardId: "TEST_DRAGON_A",
      name: "测试雏龙甲",
      type: "MINION",
      collectible: 1,
      minion_type_id: 24
    },
    {
      id: 102,
      cardId: "TEST_DRAGON_B",
      name: "测试雏龙乙",
      type: "MINION",
      collectible: 1,
      races: ["DRAGON"]
    }
  ]);
}

describe("smart card counters", () => {
  it.each([5, 8] as const)(
    "reads a %i-dragon goal from the payoff card text instead of hard-coding it",
    (target) => {
      const engine = new TrackerEngine({
        deckText: "1x 时空扭曲者扎里米\n1x 测试雏龙甲\n1x 测试雏龙乙",
        cardDatabase: dragonDatabase(target)
      });
      engine.setFriendlyController(1);
      expect(smartCounters(engine)).toContainEqual(expect.objectContaining({
        id: "friendly-dragons-played",
        value: 0,
        target
      }));
      engine.applyText(`
D 12:00:00.000 GameState.DebugPrintPower() - CREATE_GAME
D 12:00:01.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=测试雏龙甲 id=51 zone=HAND cardId=TEST_DRAGON_A player=1]
D 12:00:01.100 GameState.DebugPrintPower() - BLOCK_END
D 12:00:02.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=测试雏龙乙 id=52 zone=HAND cardId=TEST_DRAGON_B player=1]
D 12:00:02.100 GameState.DebugPrintPower() - BLOCK_END
`);

      expect(smartCounters(engine)).toContainEqual(expect.objectContaining({
        id: "friendly-dragons-played",
        label: expect.stringMatching(/龙/),
        value: 2,
        target,
        cardId: "TOY_385"
      }));
    }
  );

  it("counts every opponent JAIL_732 use, including the same card played again", () => {
    const database = createCardDatabase([
      {
        id: 126662,
        cardId: "JAIL_732",
        name: "虚空灵魂",
        type: "SPELL",
        collectible: 1,
        text: "随机召唤一个法力值消耗为（1）的恶魔。提升你此后的虚空灵魂效果。"
      }
    ]);
    const engine = new TrackerEngine({ cardDatabase: database });
    engine.setFriendlyController(1);
    expect(smartCounters(engine).find((counter) => counter.id === "opponent-void-souls"))
      .toBeUndefined();
    engine.applyText(`
D 13:00:00.000 GameState.DebugPrintPower() - CREATE_GAME
D 13:00:01.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=虚空灵魂 id=61 zone=HAND cardId=JAIL_732 player=2]
D 13:00:01.100 GameState.DebugPrintPower() - BLOCK_END
D 13:00:02.000 GameState.DebugPrintPower() - TAG_CHANGE Entity=[entityName=虚空灵魂 id=61 zone=PLAY cardId=JAIL_732 player=2] tag=ZONE value=HAND
D 13:00:03.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=虚空灵魂 id=61 zone=HAND cardId=JAIL_732 player=2]
D 13:00:03.100 GameState.DebugPrintPower() - BLOCK_END
`);

    expect(smartCounters(engine)).toContainEqual(expect.objectContaining({
      id: "opponent-void-souls",
      label: expect.stringMatching(/虚空灵魂/),
      value: 2,
      cardId: "JAIL_732"
    }));
  });

  it("does not enable a deck-related dragon counter without its payoff card", () => {
    const database = dragonDatabase(5);
    const engine = new TrackerEngine({
      deckText: "1x 测试雏龙甲\n1x 测试雏龙乙",
      cardDatabase: database
    });
    engine.setFriendlyController(1);
    engine.applyText(`
D 12:30:00.000 GameState.DebugPrintPower() - CREATE_GAME
D 12:30:01.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=测试雏龙甲 id=58 zone=HAND cardId=TEST_DRAGON_A player=1]
D 12:30:01.100 GameState.DebugPrintPower() - BLOCK_END
`);

    expect(smartCounters(engine).find((counter) => counter.id === "friendly-dragons-played"))
      .toBeUndefined();
  });

  it("does not mistake random spell-casting text for a played-spells progress requirement", () => {
    const database = createCardDatabase([
      {
        id: 103270,
        cardId: "TOY_372",
        name: "匣中古神",
        type: "SPELL",
        collectible: 1,
        text: "随机施放10个法术。"
      }
    ]);
    const engine = new TrackerEngine({
      deckText: "1x 匣中古神",
      cardDatabase: database
    });

    expect(smartCounters(engine)).toEqual([]);
  });

  it("does not apply whole-game spell-school progress to a hand-only payoff", () => {
    const database = createCardDatabase([{
      id: 110001,
      cardId: "VAC_449",
      name: "歌唱明星卡瑞斯",
      type: "MINION",
      collectible: 1,
      text: "此牌在你的手牌中时，使用两种不同派系的法术牌即可变形。"
    }]);
    const engine = new TrackerEngine({
      deckText: "1x 歌唱明星卡瑞斯",
      cardDatabase: database
    });

    expect(smartCounters(engine)).toEqual([]);
  });

  it("publishes safe ids for per-card same-name counters", () => {
    const database = createCardDatabase([{
      id: 89801,
      cardId: "BOT_283",
      name: "蹦蹦兔",
      type: "MINION",
      collectible: 1,
      text: "战吼：在本局对战中，你每使用过一张其他蹦蹦兔，便获得+2/+2。"
    }]);
    const engine = new TrackerEngine({ deckText: "2x 蹦蹦兔", cardDatabase: database });
    const counter = smartCounters(engine).find((item) => item.label === "蹦蹦兔");

    expect(counter?.id).toMatch(/^[a-z0-9][a-z0-9-]{0,127}$/u);
    expect(() => parsePublicTrackerState(engine.getState())).not.toThrow();
  });

  it("drops all smart-counter progress at the next game boundary", () => {
    const database = createCardDatabase([
      { id: 126662, cardId: "JAIL_732", name: "虚空灵魂", type: "SPELL", collectible: 1 }
    ]);
    const engine = new TrackerEngine({ cardDatabase: database });
    engine.setFriendlyController(1);
    engine.applyText(`
D 14:00:00.000 GameState.DebugPrintPower() - CREATE_GAME
D 14:00:01.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=虚空灵魂 id=71 zone=HAND cardId=JAIL_732 player=2]
D 14:00:01.100 GameState.DebugPrintPower() - BLOCK_END
`);
    expect(smartCounters(engine).find((counter) => counter.id === "opponent-void-souls")?.value).toBe(1);

    engine.applyLine("D 14:10:00.000 GameState.DebugPrintPower() - CREATE_GAME");

    expect(smartCounters(engine).find((counter) => counter.id === "opponent-void-souls"))
      .toBeUndefined();
  });

  it("counts only played dragons, treats ALL and 全部 as dragons, and excludes the payoff itself", () => {
    const database = createCardDatabase([
      {
        id: 100,
        cardId: "TOY_385",
        name: "时空扭曲者扎里米",
        type: "MINION",
        collectible: 1,
        minion_type_id: 24,
        text: "战吼：如果你在本局对战中使用过5张其他龙牌，获得一个额外回合。"
      },
      {
        id: 103,
        cardId: "TEST_ALL_EN",
        name: "英文全种族",
        type: "MINION",
        minion_type_id: 26
      },
      {
        id: 104,
        cardId: "TEST_ALL_ZH",
        name: "中文全种族",
        type: "MINION",
        races: ["全部"]
      },
      {
        id: 105,
        cardId: "TEST_SUMMONED_DRAGON",
        name: "被召唤的龙",
        type: "MINION",
        minion_type_id: 24
      }
    ]);
    const engine = new TrackerEngine({
      deckText: "1x 时空扭曲者扎里米\n1x 英文全种族\n1x 中文全种族",
      cardDatabase: database
    });
    engine.setFriendlyController(1);
    engine.applyText(`
D 15:00:00.000 GameState.DebugPrintPower() - CREATE_GAME
D 15:00:01.000 GameState.DebugPrintPower() - FULL_ENTITY - Creating ID=81 CardID=TEST_SUMMONED_DRAGON
D 15:00:01.010 GameState.DebugPrintPower() -     tag=CONTROLLER value=1
D 15:00:01.020 GameState.DebugPrintPower() -     tag=ZONE value=PLAY
D 15:00:02.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=英文全种族 id=82 zone=HAND cardId=TEST_ALL_EN player=1]
D 15:00:02.100 GameState.DebugPrintPower() - BLOCK_END
D 15:00:03.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=中文全种族 id=83 zone=HAND cardId=TEST_ALL_ZH player=1]
D 15:00:03.100 GameState.DebugPrintPower() - BLOCK_END
D 15:00:04.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=时空扭曲者扎里米 id=84 zone=HAND cardId=TOY_385 player=1]
D 15:00:04.100 GameState.DebugPrintPower() - BLOCK_END
`);

    expect(smartCounters(engine)).toContainEqual(expect.objectContaining({
      id: "friendly-dragons-played",
      value: 2,
      target: 5
    }));
  });

  it("backfills a dragon use when an unknown PLAY is identified by SHOW_ENTITY", () => {
    const engine = new TrackerEngine({
      deckText: "1x 时空扭曲者扎里米\n1x 测试雏龙甲",
      cardDatabase: dragonDatabase(5)
    });
    engine.setFriendlyController(1);
    engine.applyText(`
D 16:00:00.000 GameState.DebugPrintPower() - CREATE_GAME
D 16:00:01.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=91 zone=HAND cardId= player=1]
D 16:00:01.100 GameState.DebugPrintPower() - BLOCK_END
`);
    expect(smartCounters(engine).find((counter) => counter.id === "friendly-dragons-played")?.value)
      .toBe(0);

    engine.applyLine(
      "D 16:00:02.000 GameState.DebugPrintPower() - SHOW_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=91 zone=PLAY cardId= player=1] CardID=TEST_DRAGON_A"
    );

    expect(smartCounters(engine).find((counter) => counter.id === "friendly-dragons-played")?.value)
      .toBe(1);
  });

  it("backfills an opponent Void Soul use when SHOW_ENTITY reveals JAIL_732", () => {
    const database = createCardDatabase([
      { id: 126662, cardId: "JAIL_732", name: "虚空灵魂", type: "SPELL", collectible: 1 }
    ]);
    const engine = new TrackerEngine({ cardDatabase: database });
    engine.setFriendlyController(1);
    engine.applyText(`
D 17:00:00.000 GameState.DebugPrintPower() - CREATE_GAME
D 17:00:01.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=101 zone=HAND cardId= player=2]
D 17:00:01.100 GameState.DebugPrintPower() - BLOCK_END
`);
    expect(smartCounters(engine).find((counter) => counter.id === "opponent-void-souls"))
      .toBeUndefined();

    engine.applyLine(
      "D 17:00:02.000 GameState.DebugPrintPower() - SHOW_ENTITY - Updating Entity=[entityName=UNKNOWN ENTITY [cardType=INVALID] id=101 zone=PLAY cardId= player=2] CardID=JAIL_732"
    );

    expect(smartCounters(engine)).toContainEqual(expect.objectContaining({
      id: "opponent-void-souls",
      value: 1
    }));
  });

  it("never includes friendly Void Soul plays in the opponent counter", () => {
    const database = createCardDatabase([
      { id: 126662, cardId: "JAIL_732", name: "虚空灵魂", type: "SPELL", collectible: 1 }
    ]);
    const engine = new TrackerEngine({ cardDatabase: database });
    engine.setFriendlyController(1);
    engine.applyText(`
D 18:00:00.000 GameState.DebugPrintPower() - CREATE_GAME
D 18:00:01.000 GameState.DebugPrintPower() - BLOCK_START BlockType=PLAY Entity=[entityName=虚空灵魂 id=111 zone=HAND cardId=JAIL_732 player=1]
D 18:00:01.100 GameState.DebugPrintPower() - BLOCK_END
`);

    expect(smartCounters(engine).find((counter) => counter.id === "opponent-void-souls"))
      .toBeUndefined();
  });
});
