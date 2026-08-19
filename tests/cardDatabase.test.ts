import { describe, expect, it } from "vitest";
import {
  cardArtworkSources,
  createCardDatabase,
  getCardInfo,
  inferCardSynergies,
  listCardLibrary,
  toCardDetails
} from "../src/shared/cardDatabase";

describe("card database details", () => {
  it("normalizes official metadata and resolves related cards", () => {
    const database = createCardDatabase([
      {
        id: 2001,
        name: "测试战吼随从",
        cardId: "TEST_MINION",
        mana_cost: 4,
        attack: 3,
        health: 5,
        type: 4,
        rarity_id: 4,
        text: "<b>战吼：</b><br>抽一张牌。",
        image: "https://example.test/minion.png",
        crop_image: "https://example.test/minion-crop.png",
        child_ids: [2002]
      },
      {
        id: 2002,
        name: "测试法术",
        cardId: "TEST_SPELL",
        mana_cost: 2,
        card_type_id: 5,
        rarity: "RARE",
        text: "造成 3 点伤害。"
      }
    ]);

    const card = getCardInfo(database, 2001);
    expect(card).toMatchObject({
      dbfId: 2001,
      manaCost: 4,
      attack: 3,
      health: 5,
      cardType: "随从",
      rarity: "EPIC",
      text: "战吼：\n抽一张牌。",
      imageUrl: "https://example.test/minion.png",
      cropImageUrl: "https://example.test/minion-crop.png",
      relatedCardIds: [2002]
    });

    expect(toCardDetails(database, card!)).toMatchObject({
      isSpell: false,
      relatedCards: [{ dbfId: 2002, name: "测试法术", cardId: "TEST_SPELL", rarity: "RARE" }]
    });
  });

  it("lists collectible spells for cards that cast random spells without explicit child ids", () => {
    const database = createCardDatabase([
      {
        id: 103270,
        cardId: "TOY_372",
        name: "匣中古神",
        collectible: 1,
        card_type_id: 5,
        mana_cost: 7,
        text: "随机施放5个法术。如果你的牌库里没有随从牌，则这些法术的法力值消耗大于或等于（5）点。"
      },
      {
        id: 9001,
        cardId: "TEST_LOW_COST_SPELL",
        name: "低费法术",
        collectible: 1,
        card_type_id: 5,
        mana_cost: 2
      },
      {
        id: 9002,
        cardId: "TEST_HIGH_COST_SPELL",
        name: "高费法术",
        collectible: 1,
        card_type_id: 5,
        mana_cost: 6
      },
      {
        id: 9003,
        cardId: "TEST_MINION",
        name: "测试随从",
        collectible: 1,
        card_type_id: 4,
        mana_cost: 6
      },
      {
        id: 9004,
        cardId: "TEST_TOKEN_SPELL",
        name: "不可收藏法术",
        collectible: 0,
        card_type_id: 5,
        mana_cost: 6
      }
    ]);

    const details = toCardDetails(database, getCardInfo(database, 103270)!);
    expect(details).toMatchObject({
      relatedCards: [],
      cardPoolSections: [
        {
          key: "random-spells",
          title: "卡库可见的随机法术候选",
          cards: [
            expect.objectContaining({ dbfId: 9001, name: "低费法术" }),
            expect.objectContaining({ dbfId: 9002, name: "高费法术" })
          ]
        },
        {
          key: "random-spells-min-cost-5",
          title: "牌库无随从时：卡库可见的5费及以上候选",
          cards: [
            expect.objectContaining({ dbfId: 9002, name: "高费法术" })
          ]
        }
      ]
    });
    expect(toCardDetails(database, getCardInfo(database, 103270)!).cardPoolSections)
      .toBe(details.cardPoolSections);
  });

  it("lists exact-cost collectible minions for random summons without explicit child ids", () => {
    const database = createCardDatabase([
      {
        id: 124079,
        cardId: "JAIL_912",
        name: "预言师",
        collectible: true,
        type: "MINION",
        cost: 7,
        text: "预备。嘲讽。亡语：为你的英雄恢复6点生命值。随机召唤一个法力值消耗为（6）的随从。"
      },
      { id: 9101, cardId: "SIX_COST_MINION", name: "六费候选随从", collectible: true, type: "MINION", cost: 6 },
      { id: 9102, cardId: "FIVE_COST_MINION", name: "五费随从", collectible: true, type: "MINION", cost: 5 },
      { id: 9103, cardId: "SIX_COST_SPELL", name: "六费法术", collectible: true, type: "SPELL", cost: 6 },
      { id: 9104, cardId: "SIX_COST_TOKEN", name: "不可收藏六费随从", collectible: false, type: "MINION", cost: 6 }
    ]);

    expect(toCardDetails(database, getCardInfo(database, 124079)!).cardPoolSections).toEqual([
      {
        key: "random-minions-exact-6",
        title: "卡库可见的6费随从候选",
        emptyText: "当前卡牌库没有6费随从",
        cards: [expect.objectContaining({ dbfId: 9101, name: "六费候选随从" })]
      }
    ]);
  });

  it("narrows visible random-spell candidates by explicit cost, class, school, and deck-dependent conditions", () => {
    const database = createCardDatabase([
      {
        id: 8101,
        cardId: "COST_POOL",
        name: "低费随机施法",
        collectible: 1,
        type: "SPELL",
        text: "随机施放一个法力值消耗小于或等于（3）点的法术。"
      },
      {
        id: 8102,
        cardId: "CLASS_POOL",
        name: "德鲁伊随机施法",
        collectible: 1,
        type: "MINION",
        text: "随机施放8个德鲁伊法术。"
      },
      {
        id: 8103,
        cardId: "SCHOOL_POOL",
        name: "自然随机施法",
        collectible: 1,
        type: "MINION",
        text: "随机施放2个自然法术。"
      },
      {
        id: 8104,
        cardId: "DECK_POOL",
        name: "牌库随机施法",
        collectible: 1,
        type: "MINION",
        text: "从你的牌库中随机施放一个法力值消耗小于或等于（2）点的法术。"
      },
      { id: 8201, cardId: "MAGE_FIRE_TWO", name: "法师火焰二费", collectible: 1, card_type_id: 5, class_id: 4, spellSchoolId: 2, mana_cost: 2 },
      { id: 8202, cardId: "DRUID_NATURE_TWO", name: "德鲁伊自然二费", collectible: 1, card_type_id: 5, class_id: 2, spellSchoolId: 4, mana_cost: 2 },
      { id: 8203, cardId: "DRUID_NATURE_FIVE", name: "德鲁伊自然五费", collectible: 1, card_type_id: 5, class_id: 2, spellSchoolId: 4, mana_cost: 5 }
    ]);

    expect(toCardDetails(database, getCardInfo(database, 8101)!).cardPoolSections?.[0]).toMatchObject({
      title: "卡库可见的3费及以下法术候选",
      cards: expect.arrayContaining([
        expect.objectContaining({ cardId: "MAGE_FIRE_TWO" }),
        expect.objectContaining({ cardId: "DRUID_NATURE_TWO" })
      ])
    });
    expect(toCardDetails(database, getCardInfo(database, 8102)!).cardPoolSections?.[0]).toMatchObject({
      title: "卡库可见的德鲁伊法术候选",
      cards: [
        expect.objectContaining({ cardId: "DRUID_NATURE_TWO" }),
        expect.objectContaining({ cardId: "DRUID_NATURE_FIVE" })
      ]
    });
    expect(toCardDetails(database, getCardInfo(database, 8103)!).cardPoolSections?.[0]).toMatchObject({
      title: "卡库可见的自然法术候选",
      cards: [
        expect.objectContaining({ cardId: "DRUID_NATURE_TWO" }),
        expect.objectContaining({ cardId: "DRUID_NATURE_FIVE" })
      ]
    });
    expect(toCardDetails(database, getCardInfo(database, 8104)!).cardPoolSections?.[0]?.title)
      .toBe("卡库可见的2费及以下法术候选（实际按当时牌库缩小）");
  });

  it("maps official minion_type_id values to race names without waiting for a cache refresh", () => {
    const types = [
      [2, "DRAENEI"],
      [11, "UNDEAD"],
      [14, "MURLOC"],
      [15, "DEMON"],
      [17, "MECHANICAL"],
      [18, "ELEMENTAL"],
      [20, "BEAST"],
      [21, "TOTEM"],
      [23, "PIRATE"],
      [24, "DRAGON"],
      [26, "ALL"],
      [43, "QUILBOAR"],
      [92, "NAGA"]
    ] as const;
    const database = createCardDatabase(types.map(([minionTypeId], index) => ({
      id: 3000 + index,
      cardId: minionTypeId === 15 ? "JAIL_399" : `TYPE_${minionTypeId}`,
      name: minionTypeId === 15 ? "小鬼马仔" : `类型 ${minionTypeId}`,
      card_type_id: 4,
      minion_type_id: minionTypeId
    })));

    expect(types.map(([minionTypeId]) => getCardInfo(database, 3000 + types.findIndex(([id]) => id === minionTypeId))?.races))
      .toEqual(types.map(([, race]) => [race]));
  });

  it("infers bidirectional complementary synergies through a full real card name", () => {
    const database = createCardDatabase([
      {
        id: 6001,
        name: "测试衍生物",
        collectible: 1,
        card_type_id: 4,
        text: "<b>亡语：</b>对一个敌人造成2点伤害。",
        image: "https://example.test/token.png"
      },
      {
        id: 6002,
        cardId: "TEST_PRODUCER",
        name: "寒霜工坊",
        collectible: 1,
        card_type_id: 5,
        text: "召唤两个测试衍生物。",
        image: "https://example.test/producer.png"
      },
      {
        id: 6003,
        cardId: "TEST_CONSUMER",
        name: "灵魂收割者",
        collectible: 1,
        card_type_id: 4,
        text: "<b>战吼：</b>复活你的测试衍生物。",
        image: "https://example.test/consumer.png"
      },
      {
        id: 6004,
        cardId: "CORE_TEST_PRODUCER",
        name: "寒霜工坊",
        text: "召唤两个测试衍生物。"
      },
      {
        id: 6005,
        cardId: "CORE_TEST_CONSUMER",
        name: "灵魂收割者",
        text: "复活你的测试衍生物。"
      }
    ]);
    const producer = getCardInfo(database, 6002)!;
    const consumer = getCardInfo(database, 6003)!;

    expect(inferCardSynergies(database, producer)).toEqual([
      expect.objectContaining({
        dbfId: 6003,
        name: "灵魂收割者",
        reason: "共同关联「测试衍生物」：召唤 ↔ 复活"
      })
    ]);
    expect(inferCardSynergies(database, consumer)).toEqual([
      expect.objectContaining({
        dbfId: 6002,
        name: "寒霜工坊",
        reason: "共同关联「测试衍生物」：复活 ↔ 召唤"
      })
    ]);
    expect(toCardDetails(database, producer)).toMatchObject({
      relatedCards: [],
      synergyCards: [expect.objectContaining({ dbfId: 6003, name: "灵魂收割者" })]
    });
    expect(toCardDetails(database, getCardInfo(database, 6004)!)).toMatchObject({
      synergyCards: [expect.objectContaining({ dbfId: 6003, name: "灵魂收割者" })]
    });
    expect(toCardDetails(database, getCardInfo(database, 6005)!)).toMatchObject({
      synergyCards: [expect.objectContaining({ dbfId: 6002, name: "寒霜工坊" })]
    });
  });

  it("requires verified full names and complementary actions", () => {
    const database = createCardDatabase([
      {
        id: 7001,
        name: "测试衍生物",
        collectible: 1,
        card_type_id: 4,
        text: "亡语：造成2点伤害。",
        image: "https://example.test/token.png"
      },
      {
        id: 7002,
        name: "第一工坊",
        collectible: 1,
        card_type_id: 5,
        text: "召唤一个测试衍生物。",
        image: "https://example.test/producer-one.png"
      },
      {
        id: 7003,
        name: "第二工坊",
        collectible: 1,
        card_type_id: 5,
        text: "召唤两个测试衍生物。",
        image: "https://example.test/producer-two.png"
      },
      {
        id: 7004,
        name: "部分名称利用者",
        collectible: 1,
        card_type_id: 4,
        text: "复活你的衍生物。",
        image: "https://example.test/partial-consumer.png"
      },
      {
        id: 7005,
        name: "法术伤害",
        collectible: 1,
        card_type_id: 5
      },
      {
        id: 7006,
        name: "奥术供给者",
        collectible: 1,
        card_type_id: 4,
        text: "获得法术伤害。",
        image: "https://example.test/generic-producer.png"
      },
      {
        id: 7007,
        name: "奥术利用者",
        collectible: 1,
        card_type_id: 4,
        text: "如果你拥有法术伤害，抽一张牌。",
        image: "https://example.test/generic-consumer.png"
      },
      {
        id: 7008,
        name: "无图生成者",
        collectible: 1,
        card_type_id: 5,
        text: "召唤一个测试衍生物。"
      }
    ]);

    expect(inferCardSynergies(database, getCardInfo(database, 7002)!)).toEqual([]);
    expect(inferCardSynergies(database, getCardInfo(database, 7004)!)).toEqual([]);
    expect(inferCardSynergies(database, getCardInfo(database, 7006)!)).toEqual([]);
    expect(inferCardSynergies(database, getCardInfo(database, 7008)!)).toEqual([]);
  });

  it("does not treat a shorter card name inside a longer card name as the same reference", () => {
    const database = createCardDatabase([
      {
        id: 7501,
        name: "测试衍生物",
        collectible: 1,
        card_type_id: 4,
        text: "亡语：造成2点伤害。",
        image: "https://example.test/short-token.png"
      },
      {
        id: 7502,
        name: "测试衍生物王",
        collectible: 1,
        card_type_id: 4,
        text: "亡语：造成4点伤害。",
        image: "https://example.test/long-token.png"
      },
      {
        id: 7503,
        name: "长名生成者",
        collectible: 1,
        card_type_id: 5,
        text: "召唤一个测试衍生物王。",
        image: "https://example.test/long-producer.png"
      },
      {
        id: 7504,
        name: "短名利用者",
        collectible: 1,
        card_type_id: 4,
        text: "复活你的测试衍生物。",
        image: "https://example.test/short-consumer.png"
      }
    ]);

    expect(inferCardSynergies(database, getCardInfo(database, 7503)!)).toEqual([]);
    expect(inferCardSynergies(database, getCardInfo(database, 7504)!)).toEqual([]);
  });

  it("deduplicates inferred cards by name and returns at most six", () => {
    const consumers = Array.from({ length: 8 }, (_, index) => ({
      id: 8010 + index,
      name: `利用随从${index}号`,
      collectible: 1,
      card_type_id: 4,
      text: "复活你的测试衍生物。",
      image: `https://example.test/consumer-${index}.png`
    }));
    const database = createCardDatabase([
      {
        id: 8001,
        name: "测试衍生物",
        collectible: 1,
        card_type_id: 4,
        text: "亡语：造成2点伤害。",
        image: "https://example.test/token.png"
      },
      {
        id: 8002,
        name: "批量生成者",
        collectible: 1,
        card_type_id: 5,
        text: "召唤一个测试衍生物。",
        image: "https://example.test/producer.png"
      },
      ...consumers,
      {
        ...consumers[0],
        id: 8099,
        image: "https://example.test/duplicate-consumer.png"
      }
    ]);

    const synergies = inferCardSynergies(database, getCardInfo(database, 8002)!);
    expect(synergies).toHaveLength(6);
    expect(new Set(synergies.map((card) => card.name)).size).toBe(6);
  });

  it("recognizes legacy spell type names", () => {
    const database = createCardDatabase([{ dbfId: 2003, id: "TEST_LEGACY_SPELL", name: "旧法术", type: "SPELL" }]);
    const card = getCardInfo(database, 2003);

    expect(toCardDetails(database, card!)).toMatchObject({ cardType: "法术", isSpell: true });
  });

  it("drops the known official crop placeholder so callers fall back to the full card image", () => {
    const database = createCardDatabase([
      {
        id: 2826,
        name: "奥蕾莉亚·风行者",
        image: "https://cards.example.test/alleria.png",
        crop_image: "https://hs.res.netease.com/pc/zt/20250225182549/static/img/8a60b28b4a9bb70748ce68815582bbde7a0c2ebfdf70988adb51da88c5d655fc.png"
      }
    ]);

    expect(getCardInfo(database, 2826)).toMatchObject({ imageUrl: "https://cards.example.test/alleria.png", cropImageUrl: undefined });
  });

  it("derives safe artwork fallbacks for legacy collectible cards without official images", () => {
    const database = createCardDatabase([
      {
        dbfId: 69622,
        cardId: "CORE_EX1_144",
        name: "暗影步",
        collectible: true,
        cardType: "法术"
      }
    ]);

    expect(cardArtworkSources(getCardInfo(database, 69622)!)).toEqual([
      "https://art.hearthstonejson.com/v1/tiles/CORE_EX1_144.jpg",
      "https://art.hearthstonejson.com/v1/render/latest/zhCN/256x/CORE_EX1_144.png"
    ]);
  });

  it("does not turn an invalid card id into an artwork URL", () => {
    const database = createCardDatabase([
      {
        dbfId: 99001,
        cardId: "../../not-a-card",
        name: "异常卡牌编号",
        collectible: true,
        cardType: "法术"
      }
    ]);

    expect(cardArtworkSources(getCardInfo(database, 99001)!)).toEqual([]);
  });

  it("preserves mixed-case card ids required by the artwork service", () => {
    const database = createCardDatabase([
      {
        dbfId: 99002,
        cardId: "VAN_tt_010",
        name: "法术偏转",
        collectible: true,
        cardType: "法术"
      }
    ]);

    expect(cardArtworkSources(getCardInfo(database, 99002)!)).toEqual([
      "https://art.hearthstonejson.com/v1/tiles/VAN_tt_010.jpg",
      "https://art.hearthstonejson.com/v1/render/latest/zhCN/256x/VAN_tt_010.png"
    ]);
  });

  it("normalizes card classes from official and legacy metadata", () => {
    const database = createCardDatabase([
      { dbfId: 3001, cardId: "MAGE_CARD", name: "法师卡", playerClass: "mage", type: "SPELL" },
      { dbfId: 3002, cardId: "MULTI_CARD", name: "多职业卡", classes: ["ROGUE", "Shaman"], type: "MINION" },
      { dbfId: 3003, cardId: "NEUTRAL_CARD", name: "中立卡", card_class: "NEUTRAL", type: "MINION" }
    ]);

    expect(getCardInfo(database, 3001)).toMatchObject({ heroClass: "法师", heroClasses: ["法师"] });
    expect(getCardInfo(database, 3002)).toMatchObject({ heroClass: "盗贼 / 萨满祭司", heroClasses: ["盗贼", "萨满祭司"] });
    expect(getCardInfo(database, 3003)).toMatchObject({ heroClass: "中立", heroClasses: ["中立"] });
  });

  it("filters, sorts, and paginates full card details with bounded input", () => {
    const database = createCardDatabase([
      { dbfId: 4003, collectible: true, cardId: "MAGE_MINION", name: "寒冰学徒", playerClass: "MAGE", cost: 3, attack: 2, health: 4, type: "MINION", text: "战吼：冻结一个敌人。", image: "https://example.test/a.png" },
      { dbfId: 4001, collectible: 1, cardId: "MAGE_SPELL", name: "奥术飞弹", playerClass: "MAGE", cost: 1, type: "SPELL", text: "造成 3 点伤害。", image: "https://example.test/b.png" },
      { dbfId: 4002, collectible: true, cardId: "ROGUE_SPELL", name: "暗影步", playerClass: "ROGUE", cost: 0, type: "SPELL", text: "将一个友方随从移回手牌。" }
    ]);

    const firstPage = listCardLibrary(database, { heroClass: "mage", cardType: "spell", page: 0, pageSize: 1 });
    expect(firstPage).toMatchObject({ page: 1, pageSize: 1, total: 1, heroClasses: ["盗贼", "法师"], cardTypes: ["法术", "随从"] });
    expect(firstPage.items).toEqual([
      expect.objectContaining({ dbfId: 4001, name: "奥术飞弹", heroClass: "法师", cardType: "法术", isSpell: true, imageUrl: "https://example.test/b.png" })
    ]);

    const searched = listCardLibrary(database, { query: "敌人", page: 1, pageSize: 9999 });
    expect(searched).toMatchObject({ page: 1, pageSize: 100, total: 1 });
    expect(searched.items).toEqual([expect.objectContaining({ dbfId: 4003, attack: 2, health: 4, text: "战吼：冻结一个敌人。" })]);
  });

  it("omits internal placeholder cards from the browseable database", () => {
    const database = createCardDatabase([
      { dbfId: 5001, collectible: true, cardId: "REAL_CARD", name: "真实卡牌", type: "SPELL" },
      { dbfId: 5002, collectible: true, cardId: "PLACEHOLDER", name: "？ ？ ？", type: "SPELL" },
      { dbfId: 5003, collectible: true, cardId: "HERO_POWER", name: "英雄技能占位", type: "HERO_POWER" },
      { dbfId: 5004, collectible: false, cardId: "NON_COLLECTIBLE", name: "衍生卡", type: "SPELL" }
    ]);

    expect(listCardLibrary(database)).toMatchObject({
      total: 1,
      items: [expect.objectContaining({ name: "真实卡牌" })]
    });
  });
});
