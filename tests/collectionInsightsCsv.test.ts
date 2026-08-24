import { describe, expect, it } from "vitest";
import { parseCollectionCsv } from "../src/shared/collectionInsights";

const header = "type,id,name,normal,golden,set,openedAt,rarity,packId";

describe("parseCollectionCsv", () => {
  it("parses quoted cards, cosmetics, and grouped pack cards", () => {
    const snapshot = parseCollectionCsv([
      header,
      'card,CARD_1,"Fireball, Prime",2,1,,,,',
      'card_back,BACK_1,"Red, Gold",,,,,,',
      "hero_skin,HERO_1,Jaina,,,,,,",
      "coin,COIN_1,Arcane Coin,,,,,,",
      "pack_card,CARD_L,Legendary,,false,SET_A,2026-08-22T10:00:00.000Z,legendary,PACK_1",
      "pack_card,CARD_C,Common,,true,SET_A,2026-08-22T10:00:00.000Z,common,PACK_1"
    ].join("\r\n"));

    expect(snapshot).toMatchObject({
      source: "import",
      cards: [{ cardId: "CARD_1", name: "Fireball, Prime", normal: 2, golden: 1 }],
      cardBacks: [{ id: "BACK_1", name: "Red, Gold" }],
      heroSkins: [{ id: "HERO_1", name: "Jaina" }],
      coins: [{ id: "COIN_1", name: "Arcane Coin" }],
      pity: [],
      packs: [{
        id: "PACK_1",
        set: "SET_A",
        openedAt: "2026-08-22T10:00:00.000Z",
        cards: [
          { cardId: "CARD_L", name: "Legendary", rarity: "legendary", golden: false },
          { cardId: "CARD_C", name: "Common", rarity: "common", golden: true }
        ]
      }]
    });
    expect(Number.isFinite(Date.parse(snapshot.updatedAt))).toBe(true);
  });

  it.each([
    ["missing header", "type,id\ncard,A"],
    ["unknown type", `${header}\nweapon,A,Blade,0,0,,,,`],
    ["negative count", `${header}\ncard,A,Card,-1,0,,,,`],
    ["bad date", `${header}\npack_card,A,Card,,false,SET,bad,rare,P1`],
    ["bad rarity", `${header}\npack_card,A,Card,,false,SET,2026-08-22T10:00:00.000Z,mythic,P1`],
    ["bad boolean", `${header}\npack_card,A,Card,,yes,SET,2026-08-22T10:00:00.000Z,rare,P1`],
    ["unclosed quote", `${header}\ncard,A,"Card,2,0,,,,`]
  ])("rejects %s", (_label, csv) => {
    expect(() => parseCollectionCsv(csv)).toThrow();
  });
});
