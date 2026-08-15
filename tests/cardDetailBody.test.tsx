import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardDetailBody } from "../src/renderer/components/CardDetailBody";
import type { CardDetails } from "../src/shared/cardDatabase";

const cardHoverStyles = readFileSync(join(process.cwd(), "src/renderer/cardHoverStyles.css"), "utf8");

const baseDetails: CardDetails = {
  dbfId: 119566,
  cardId: "VAC_520",
  name: "匣中古神",
  manaCost: 7,
  cardType: "法术",
  text: "随机施放5个法术。",
  isSpell: true,
  relatedCards: []
};

describe("CardDetailBody related cards", () => {
  it("shows an explicit empty state instead of silently omitting the related-card section", () => {
    render(<CardDetailBody details={baseDetails} mode="interactive" />);

    expect(screen.getByText("生成/关联法术（0）")).toBeInTheDocument();
    expect(screen.getByText("暂无生成或关联法术资料")).toBeInTheDocument();
  });

  it("shows the full related-card count and keeps entries in a dedicated full-width list", () => {
    const relatedCards = Array.from({ length: 24 }, (_, index) => ({
      dbfId: 2000 + index,
      cardId: `RELATED_${index}`,
      name: `关联法术 ${index + 1}`,
      manaCost: index % 10,
      cardType: "法术"
    }));

    const { container } = render(
      <CardDetailBody details={{ ...baseDetails, relatedCards }} mode="interactive" />
    );

    const section = container.querySelector(".card-detail-related");
    expect(section).not.toBeNull();
    expect(section).toHaveTextContent("生成/关联法术（24）");
    expect(within(section as HTMLElement).getAllByText(/^关联法术 \d+$/)).toHaveLength(24);
    expect(section?.querySelector(".card-related-cards")).toHaveAttribute("role", "list");
  });

  it("keeps duplicate entries visible without React duplicate-key warnings", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <CardDetailBody
        mode="interactive"
        details={{
          ...baseDetails,
          relatedCards: [
            { dbfId: 315, cardId: "CS2_029", name: "火球术", manaCost: 4, cardType: "法术" },
            { dbfId: 315, cardId: "CS2_029", name: "火球术", manaCost: 4, cardType: "法术" }
          ]
        }}
      />
    );

    expect(screen.getAllByText("火球术")).toHaveLength(2);
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("same key");
    consoleError.mockRestore();
  });

  it("renders a visible placeholder for related cards without artwork", () => {
    render(
      <CardDetailBody
        mode="interactive"
        details={{
          ...baseDetails,
          relatedCards: [
            { dbfId: 621, cardId: "EX1_279", name: "炎爆术", manaCost: 10, cardType: "法术" }
          ]
        }}
      />
    );

    expect(screen.getByLabelText("炎爆术无卡图")).toHaveTextContent("无图");
  });

  it("uses the card id as a fallback for the main card image", () => {
    render(<CardDetailBody details={baseDetails} mode="interactive" />);

    const artwork = screen.getByRole("img", { name: "匣中古神 卡牌图" });
    expect(artwork).toHaveAttribute(
      "src",
      "https://art.hearthstonejson.com/v1/render/latest/zhCN/256x/VAC_520.png"
    );

    fireEvent.error(artwork);
    expect(artwork).toHaveAttribute(
      "src",
      "https://art.hearthstonejson.com/v1/tiles/VAC_520.jpg"
    );

    fireEvent.error(artwork);
    expect(screen.getByText("无图片")).toBeInTheDocument();
  });

  it("keeps the theoretical pool separate from the five spells actually cast this game", () => {
    render(
      <CardDetailBody
        mode="interactive"
        details={{
          ...baseDetails,
          relatedCards: [
            { dbfId: 3, cardId: "RELATED_1", name: "关联法术", manaCost: 4, cardType: "法术" }
          ],
          cardPoolSections: [{
            key: "random-spells",
            title: "随机法术池",
            emptyText: "当前卡牌库没有可匹配的法术",
            cards: [
              { dbfId: 1, cardId: "POOL_1", name: "候选法术一", manaCost: 5, cardType: "法术" },
              { dbfId: 2, cardId: "POOL_2", name: "候选法术二", manaCost: 6, cardType: "法术" }
            ]
          }],
          playedSpellsThisGame: [
            { dbfId: 10, cardId: "CAST_1", name: "实际法术一", manaCost: 5, cardType: "法术" },
            { dbfId: 11, cardId: "CAST_2", name: "实际法术二", manaCost: 6, cardType: "法术" },
            { dbfId: 10, cardId: "CAST_1", name: "实际法术一", manaCost: 5, cardType: "法术" },
            { dbfId: 12, cardId: "CAST_3", name: "实际法术三", manaCost: 7, cardType: "法术" },
            { dbfId: 13, cardId: "CAST_4", name: "实际法术四", manaCost: 8, cardType: "法术" }
          ]
        }}
      />
    );

    const pool = screen.getByRole("region", { name: "随机法术池，共 2 张" });
    const actual = screen.getByRole("region", { name: "本局已施放 5 个法术" });
    const related = screen.getByRole("region", { name: "生成/关联法术，共 1 张" });
    expect(pool).toHaveTextContent("候选法术一");
    expect(pool).not.toHaveTextContent("实际法术一");
    expect(within(actual).getAllByText("实际法术一")).toHaveLength(2);
    expect(within(actual).getAllByRole("listitem")).toHaveLength(5);
    expect(actual.compareDocumentPosition(related) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(actual.compareDocumentPosition(pool) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the trusted spell total, incomplete progress, and only recognized names grouped by cost", () => {
    const details = {
      ...baseDetails,
      playedSpellsThisGame: [
        { dbfId: 21, name: "五费甲", manaCost: 5, cardType: "法术" },
        { dbfId: 22, name: "二费甲", manaCost: 2, cardType: "法术" },
        { dbfId: 23, name: "五费乙", manaCost: 5, cardType: "法术" },
        { dbfId: 24, name: "二费乙", manaCost: 2, cardType: "法术" }
      ],
      playedSpellsThisGameCount: 7,
      playedSpellsThisGameIncomplete: true
    } as typeof baseDetails & {
      playedSpellsThisGame: readonly {
        dbfId: number;
        name: string;
        manaCost: number;
        cardType: string;
      }[];
      playedSpellsThisGameCount: number;
      playedSpellsThisGameIncomplete: boolean;
    };

    render(<CardDetailBody mode="interactive" details={details} />);

    const actual = screen.getByRole("region", { name: "本局已施放 7 个法术" });
    expect(actual).toHaveTextContent("本局已施放 7 个法术");
    expect(actual).toHaveTextContent("已识别 4/7");
    expect(within(actual).getByText("2费")).toBeInTheDocument();
    expect(within(actual).getByText("5费")).toBeInTheDocument();
    expect(within(actual).getAllByRole("listitem")).toHaveLength(4);
    expect(actual).not.toHaveTextContent("未知法术");
  });

  it("shows a trusted total even when no spell names were recognized", () => {
    const details = {
      ...baseDetails,
      playedSpellsThisGameCount: 7,
      playedSpellsThisGameIncomplete: true
    } as typeof baseDetails & {
      playedSpellsThisGameCount: number;
      playedSpellsThisGameIncomplete: boolean;
    };

    render(<CardDetailBody mode="interactive" details={details} />);

    const actual = screen.getByRole("region", { name: "本局已施放 7 个法术" });
    expect(actual).toHaveTextContent("已识别 0/7");
    expect(actual).toHaveTextContent("本局还没有识别到法术名单");
  });

  it("uses the real empty-state copy when the trusted spell total is zero", () => {
    const details = {
      ...baseDetails,
      playedSpellsThisGame: [],
      playedSpellsThisGameCount: 0
    } as typeof baseDetails & {
      playedSpellsThisGame: readonly [];
      playedSpellsThisGameCount: number;
    };

    render(<CardDetailBody mode="interactive" details={details} />);

    expect(screen.getByRole("region", { name: "本局已施放 0 个法术" }))
      .toHaveTextContent("本局还没有施放过法术");
  });

  it("does not invent a total when an incomplete list has no trusted count", () => {
    const details = {
      ...baseDetails,
      playedSpellsThisGame: [{ dbfId: 21, name: "已识别法术", manaCost: 5 }],
      playedSpellsThisGameIncomplete: true
    } as typeof baseDetails & {
      playedSpellsThisGame: readonly { dbfId: number; name: string; manaCost: number }[];
      playedSpellsThisGameIncomplete: boolean;
    };

    render(<CardDetailBody mode="interactive" details={details} />);

    const actual = screen.getByRole("region", { name: "本局已识别 1 个法术" });
    expect(actual).toHaveTextContent("完整数量未知");
    expect(actual).not.toHaveTextContent("1/1");
    expect(actual).not.toHaveTextContent("本局已施放 1 个法术");
  });

  it("shows a clear zero-result state for the actual spells without hiding the theoretical pool", () => {
    render(
      <CardDetailBody
        mode="interactive"
        details={{
          ...baseDetails,
          cardPoolSections: [{
            key: "random-spells",
            title: "随机法术池",
            emptyText: "当前卡牌库没有可匹配的法术",
            cards: [{ dbfId: 1, cardId: "POOL_1", name: "候选法术", manaCost: 5, cardType: "法术" }]
          }],
          playedSpellsThisGame: []
        }}
      />
    );

    expect(screen.getByRole("region", { name: "随机法术池，共 1 张" })).toHaveTextContent("候选法术");
    expect(screen.getByRole("region", { name: "本局已施放 0 个法术" }))
      .toHaveTextContent("本局还没有施放过法术");
  });

  it("shows all ten actual casts and preserves duplicates when the effect is doubled", () => {
    const doubledSpells = Array.from({ length: 10 }, (_, index) => ({
      dbfId: 100 + (index % 5),
      cardId: `CAST_${index % 5}`,
      name: `实际法术${(index % 5) + 1}`,
      manaCost: 5 + (index % 5),
      cardType: "法术"
    }));

    render(
      <CardDetailBody
        mode="interactive"
        details={{
          ...baseDetails,
          playedSpellsThisGame: doubledSpells
        }}
      />
    );

    const actual = screen.getByRole("region", { name: "本局已施放 10 个法术" });
    expect(within(actual).getAllByRole("listitem")).toHaveLength(10);
    expect(within(actual).getAllByText("实际法术1")).toHaveLength(2);
    for (let index = 1; index <= 5; index += 1) {
      expect(within(actual).getAllByText(`实际法术${index}`)).toHaveLength(2);
    }
  });

  it("keeps detail lists in the preview shell's single scroll area", () => {
    expect(cardHoverStyles).toMatch(
      /:is\(\.card-pool-section,\s*\.card-game-context\) \.card-related-cards\s*\{[^}]*max-height:\s*none;[^}]*overflow:\s*visible;/
    );
    expect(cardHoverStyles).toMatch(
      /\.card-outcome-section > \.card-outcome-tree\s*\{[^}]*max-height:\s*none;[^}]*overflow:\s*visible;/
    );
    expect(cardHoverStyles).not.toMatch(
      /\.card-outcome-section > \.card-outcome-tree\s*\{[^}]*overflow-y:\s*auto;/
    );
    expect(cardHoverStyles).toMatch(
      /\.card-outcome-children\s*\{[\s\S]*?border-left:/
    );
  });

  it("shows a doubled outcome as ten ordered root cards and preserves repeats", () => {
    const cards = Array.from({ length: 10 }, (_, index) => ({
      key: `cast-${index + 1}`,
      card: {
        dbfId: 100 + (index % 5),
        cardId: `CAST_${index % 5}`,
        name: `实际法术${(index % 5) + 1}`,
        manaCost: 5 + (index % 5),
        cardType: "法术"
      }
    }));
    const { container } = render(
      <CardDetailBody
        mode="interactive"
        details={{
          ...baseDetails,
          cardOutcomeSections: [{
            key: "cast-1",
            title: "本次实际施放",
            emptyText: "本次尚未确认施放结果",
            cards
          }]
        }}
      />
    );

    const section = screen.getByRole("region", { name: "本次实际施放，共 10 张" });
    const roots = container.querySelectorAll(
      ".card-outcome-section > .card-outcome-tree > .card-outcome-node"
    );
    expect(roots).toHaveLength(10);
    expect(within(section).getAllByText("实际法术1")).toHaveLength(2);
    expect([...section.querySelectorAll(".card-outcome-node > .card-related-card strong")].map((item) => item.textContent))
      .toEqual(cards.map((node) => node.card.name));
  });

  it("keeps separate use outcome sections scoped instead of mixing same-card results", () => {
    render(
      <CardDetailBody
        mode="interactive"
        details={{
          ...baseDetails,
          cardOutcomeSections: [
            {
              key: "use-1",
              title: "第1次实际施放",
              emptyText: "本次尚未确认施放结果",
              cards: [
                {
                  key: "use-1-fireball-1",
                  card: { dbfId: 315, cardId: "CS2_029", name: "火球术", manaCost: 4, cardType: "法术" }
                },
                {
                  key: "use-1-fireball-2",
                  card: { dbfId: 315, cardId: "CS2_029", name: "火球术", manaCost: 4, cardType: "法术" }
                }
              ]
            },
            {
              key: "use-2",
              title: "第2次实际施放",
              emptyText: "本次尚未确认施放结果",
              cards: [{
                key: "use-2-pyroblast",
                card: { dbfId: 621, cardId: "EX1_279", name: "炎爆术", manaCost: 10, cardType: "法术" }
              }]
            }
          ]
        }}
      />
    );

    const firstUse = screen.getByRole("region", { name: "第1次实际施放，共 2 张" });
    const secondUse = screen.getByRole("region", { name: "第2次实际施放，共 1 张" });
    expect(within(firstUse).getAllByText("火球术")).toHaveLength(2);
    expect(within(firstUse).queryByText("炎爆术")).not.toBeInTheDocument();
    expect(within(secondUse).getByText("炎爆术")).toBeVisible();
    expect(within(secondUse).queryByText("火球术")).not.toBeInTheDocument();
  });

  it("shows nested Yogg outcomes as a readable trigger hierarchy instead of one flat list", () => {
    const { container } = render(
      <CardDetailBody
        mode="interactive"
        details={{
          ...baseDetails,
          cardPoolSections: [{
            key: "random-spells",
            title: "随机法术池",
            emptyText: "当前卡牌库没有可匹配的法术",
            cards: [{ dbfId: 103270, cardId: "TOY_372", name: "匣中古神", manaCost: 7, cardType: "法术" }]
          }],
          cardOutcomeSections: [{
            key: "cast-1",
            title: "本次实际施放",
            emptyText: "本次尚未确认施放结果",
            cards: [{
              key: "root-yogg",
              card: { dbfId: 103270, cardId: "TOY_372", name: "匣中古神", manaCost: 7, cardType: "法术" },
              children: [
                {
                  key: "nested-fireball",
                  card: { dbfId: 315, cardId: "CS2_029", name: "火球术", manaCost: 4, cardType: "法术" }
                },
                {
                  key: "nested-yogg",
                  card: { dbfId: 103270, cardId: "TOY_372", name: "匣中古神", manaCost: 7, cardType: "法术" },
                  children: [
                    {
                      key: "deep-fireball",
                      card: { dbfId: 315, cardId: "CS2_029", name: "火球术", manaCost: 4, cardType: "法术" }
                    }
                  ]
                }
              ]
            }]
          }]
        }}
      />
    );

    expect(screen.getByRole("region", { name: "随机法术池，共 1 张" })).toBeInTheDocument();
    const outcome = screen.getByRole("region", { name: "本次实际施放，共 1 张" });
    expect(within(outcome).getByText("由「匣中古神」触发（2）")).toBeVisible();
    expect(within(outcome).getByText("由「匣中古神」触发（1）")).toBeVisible();
    expect(within(outcome).getAllByText("匣中古神")).toHaveLength(2);
    expect(within(outcome).getAllByText("火球术")).toHaveLength(2);
    expect(container.querySelectorAll(".card-outcome-children")).toHaveLength(2);
    expect(container.querySelectorAll(".card-outcome-section .card-related-cards")).toHaveLength(0);
  });

  it("shows the outcome-specific empty state without hiding the theoretical pool", () => {
    render(
      <CardDetailBody
        mode="interactive"
        details={{
          ...baseDetails,
          cardPoolSections: [{
            key: "random-spells",
            title: "随机法术池",
            emptyText: "当前卡牌库没有可匹配的法术",
            cards: [{ dbfId: 315, cardId: "CS2_029", name: "火球术", manaCost: 4, cardType: "法术" }]
          }],
          cardOutcomeSections: [{
            key: "cast-1",
            title: "本次实际施放",
            emptyText: "本次尚未确认施放结果",
            cards: []
          }]
        }}
      />
    );

    expect(screen.getByRole("region", { name: "随机法术池，共 1 张" })).toHaveTextContent("火球术");
    expect(screen.getByRole("region", { name: "本次实际施放，共 0 张" }))
      .toHaveTextContent("本次尚未确认施放结果");
  });

  it("shows that Kel'Thuzad's resurrection count is unknown instead of keeping a blank placeholder", () => {
    render(
      <CardDetailBody
        mode="interactive"
        details={{
          dbfId: 79767,
          cardId: "REV_514",
          name: "天定之灾克尔苏加德",
          manaCost: 8,
          cardType: "随从",
          text: "战吼：复活你的不稳定的骷髅。\n战场上放不下的骷髅会立即爆炸。（ 复活   个 ）",
          isSpell: false,
          relatedCards: []
        }}
      />
    );

    expect(screen.getByText(/复活数量未知/)).toBeInTheDocument();
    expect(screen.queryByText(/复活\s*个/)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /会复活/ })).not.toBeInTheDocument();
  });

  it("shows Kel'Thuzad's logged resurrection count and fills the blank card-text placeholder", () => {
    render(
      <CardDetailBody
        mode="interactive"
        details={{
          dbfId: 79767,
          cardId: "REV_514",
          name: "天定之灾克尔苏加德",
          manaCost: 8,
          cardType: "随从",
          text: "战吼：复活你的不稳定的骷髅。战场上放不下的骷髅会立即爆炸。（复活 个）",
          isSpell: false,
          relatedCards: [],
          gameContextSections: [{
            key: "kelthuzad-resurrection-count",
            title: "会复活",
            emptyText: "数量来自对局日志",
            cards: [],
            totalCount: 5
          }]
        }}
      />
    );

    expect(screen.getByText(/复活 5 个/)).toBeInTheDocument();
    expect(screen.queryByText(/复活\s*个/)).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "会复活，共 5 张" }))
      .toHaveTextContent("会复活（5）");
  });

  it("keeps Kel'Thuzad's known zero resurrection count", () => {
    render(
      <CardDetailBody
        mode="interactive"
        details={{
          dbfId: 79767,
          cardId: "REV_514",
          name: "天定之灾克尔苏加德",
          manaCost: 8,
          cardType: "随从",
          text: "战吼：复活你的不稳定的骷髅。（复活 个）",
          isSpell: false,
          relatedCards: [],
          gameContextSections: [{
            key: "kelthuzad-resurrection-count",
            title: "会复活",
            emptyText: "本局还没有不稳定的骷髅死亡",
            cards: [],
            totalCount: 0
          }]
        }}
      />
    );

    expect(screen.getByText(/复活 0 个/)).toBeInTheDocument();
    expect(screen.queryByText(/复活数量未知/)).not.toBeInTheDocument();
  });

  it("shows the friendly opening hand without a misleading empty related-card section", () => {
    render(
      <CardDetailBody
        mode="interactive"
        details={{
          dbfId: 140706,
          cardId: "TIME_706",
          name: "超时空鳍侠",
          manaCost: 2,
          cardType: "随从",
          text: "战吼：将你的手牌替换为你的起始手牌。在你的回合结束时换回。",
          isSpell: false,
          relatedCards: [],
          gameContextSections: [{
            key: "friendly-opening-hand",
            title: "我的起始手牌",
            emptyText: "本局起始手牌尚未识别",
            cards: [
              { dbfId: 1, cardId: "START_A", name: "起手牌甲", manaCost: 1, cardType: "法术" },
              { dbfId: 2, cardId: "START_C", name: "起手牌乙", manaCost: 3, cardType: "武器" },
              { dbfId: 3, cardId: "START_D", name: "换入的起手牌", manaCost: 4, cardType: "法术" }
            ]
          }]
        }}
      />
    );

    const openingHand = screen.getByRole("region", { name: "我的起始手牌，共 3 张" });
    expect(openingHand).toHaveTextContent("起手牌甲");
    expect(openingHand).toHaveTextContent("起手牌乙");
    expect(openingHand).toHaveTextContent("换入的起手牌");
    expect(screen.queryByRole("region", { name: "关联牌，共 0 张" })).not.toBeInTheDocument();
    expect(screen.queryByText("暂无关联牌资料")).not.toBeInTheDocument();
  });
});
