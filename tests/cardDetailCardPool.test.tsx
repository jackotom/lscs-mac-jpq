import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CardDetailBody } from "../src/renderer/components/CardDetailBody";
import type { CardDetails } from "../src/shared/cardDatabase";

const yoggInTheBox: CardDetails = {
  dbfId: 103270,
  cardId: "TOY_372",
  name: "匣中古神",
  manaCost: 7,
  cardType: "法术",
  text: "随机施放5个法术。如果你的牌库里没有随从牌，则这些法术的法力值消耗大于或等于（5）点。",
  isSpell: true,
  relatedCards: [],
  cardPoolSections: [
    {
      key: "random-spells",
      title: "卡库可见的随机法术候选",
      emptyText: "当前卡牌资料里没有可用法术",
      cards: [
        { dbfId: 315, cardId: "CS2_029", name: "火球术", manaCost: 4, cardType: "法术" },
        { dbfId: 621, cardId: "EX1_279", name: "炎爆术", manaCost: 10, cardType: "法术" }
      ]
    },
    {
      key: "random-spells-min-cost-5",
      title: "牌库无随从时：卡库可见的5费及以上候选",
      emptyText: "当前卡牌资料里没有5费及以上法术",
      cards: [
        { dbfId: 621, cardId: "EX1_279", name: "炎爆术", manaCost: 10, cardType: "法术" }
      ]
    }
  ]
};

describe("CardDetailBody card pools", () => {
  it("shows the first twelve theoretical candidates in summary mode while keeping actual results complete", () => {
    const actualCards = Array.from({ length: 25 }, (_, index) => ({
      key: `actual-${index}`,
      card: {
        dbfId: 40_000 + index,
        cardId: `ACTUAL_${index}`,
        name: `实际结果 ${index + 1}`,
        cardType: "法术"
      }
    }));

    render(
      <CardDetailBody
        details={{
          ...yoggInTheBox,
          cardOutcomeSections: [{
            key: "cast-1",
            title: "本次实际施放",
            emptyText: "本次尚未确认施放结果",
            cards: actualCards
          }]
        }}
        mode="summary"
      />
    );

    const pool = screen.getByRole("region", { name: "卡库可见的随机法术候选，共 2 张，当前显示 2 张" });
    expect(within(pool).getByText("火球术")).toBeVisible();
    expect(within(pool).getByText("炎爆术")).toBeVisible();
    expect(screen.queryByText("暂无生成或关联法术资料")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /继续显示/ })).not.toBeInTheDocument();
    expect(screen.getAllByText(/^实际结果 \d+$/)).toHaveLength(25);
  });

  it("includes inferred synergy cards in the visible related-card section", () => {
    render(
      <CardDetailBody
        details={{
          ...yoggInTheBox,
          cardPoolSections: [],
          synergyCards: [{
            dbfId: 1234,
            cardId: "RELATED_PARTNER",
            name: "关联搭档",
            cardType: "随从",
            reason: "共同关联测试衍生物"
          }]
        }}
        mode="summary"
      />
    );

    expect(screen.getByRole("region", { name: "生成/关联法术，共 1 张" })).toHaveTextContent("关联搭档");
  });

  it("starts interactive theoretical pools collapsed and reveals twelve cards per batch", () => {
    const cards = Array.from({ length: 25 }, (_, index) => ({
      dbfId: 50_000 + index,
      cardId: `POOL_BATCH_${index}`,
      name: `古神候选 ${index + 1}`,
      cardType: "法术"
    }));

    const { container } = render(
      <CardDetailBody
        details={{
          ...yoggInTheBox,
          cardPoolSections: [{
            key: "random-spells",
            title: "古神随机法术候选",
            emptyText: "当前没有候选牌",
            cards
          }]
        }}
        mode="interactive"
      />
    );

    const disclosure = container.querySelector(".card-pool-section");
    expect(disclosure?.tagName).toBe("DETAILS");
    expect(disclosure).not.toHaveAttribute("open");

    fireEvent.click(screen.getByText("古神随机法术候选（25）"));
    const pool = screen.getByRole("region", { name: "古神随机法术候选，共 25 张" });
    expect(within(pool).getAllByRole("listitem")).toHaveLength(12);
    expect(within(pool).getByText("古神候选 12")).toBeVisible();
    expect(within(pool).queryByText("古神候选 13")).not.toBeInTheDocument();

    fireEvent.click(within(pool).getByRole("button", { name: "继续显示 12 张（剩余 13 张）" }));
    expect(within(pool).getAllByRole("listitem")).toHaveLength(24);
    expect(within(pool).getByText("古神候选 24")).toBeVisible();
  });

  it("shows every card-pool section with its title, exact count, and visible cards", () => {
    const { container } = render(<CardDetailBody details={yoggInTheBox} mode="interactive" />);
    const sections = container.querySelectorAll(".card-pool-section");

    expect(sections).toHaveLength(2);
    expect(within(sections[0] as HTMLElement).getByText("卡库可见的随机法术候选（2）")).toBeInTheDocument();
    fireEvent.click(within(sections[0] as HTMLElement).getByText("卡库可见的随机法术候选（2）"));
    expect(within(sections[0] as HTMLElement).getByText("火球术")).toBeVisible();
    expect(within(sections[0] as HTMLElement).getByText("炎爆术")).toBeVisible();
    expect(within(sections[1] as HTMLElement).getByText("牌库无随从时：卡库可见的5费及以上候选（1）")).toBeInTheDocument();
    fireEvent.click(within(sections[1] as HTMLElement).getByText("牌库无随从时：卡库可见的5费及以上候选（1）"));
    expect(within(sections[1] as HTMLElement).getByText("炎爆术")).toBeVisible();
  });

  it("shows the section-specific empty state when a known pool has no cards", () => {
    render(
      <CardDetailBody
        mode="interactive"
        details={{
          ...yoggInTheBox,
          cardPoolSections: [{
            key: "random-spells",
            title: "卡库可见的随机法术候选",
            emptyText: "当前卡牌资料里没有可用法术",
            cards: []
          }]
        }}
      />
    );

    expect(screen.getByText("卡库可见的随机法术候选（0）")).toBeInTheDocument();
    fireEvent.click(screen.getByText("卡库可见的随机法术候选（0）"));
    expect(screen.getByText("当前卡牌资料里没有可用法术")).toBeVisible();
  });

  it("renders a 145-card theoretical pool in batches while keeping the exact total visible", () => {
    const cards = Array.from({ length: 145 }, (_, index) => ({
      dbfId: 10_000 + index,
      cardId: `POOL_${index}`,
      name: `候选法术 ${index + 1}`,
      manaCost: index % 11,
      cardType: "法术"
    }));

    render(
      <CardDetailBody
        mode="interactive"
        details={{
          ...yoggInTheBox,
          cardPoolSections: [{
            key: "random-spells",
            title: "卡库可见的随机法术候选",
            emptyText: "当前卡牌资料里没有可用法术",
            cards
          }]
        }}
      />
    );

    const pool = screen.getByRole("region", { name: "卡库可见的随机法术候选，共 145 张" });
    fireEvent.click(screen.getByText("卡库可见的随机法术候选（145）"));
    expect(within(pool).getAllByRole("listitem")).toHaveLength(12);
    expect(within(pool).getByText("候选法术 12")).toBeVisible();
    expect(within(pool).queryByText("候选法术 13")).not.toBeInTheDocument();

    fireEvent.click(within(pool).getByRole("button", { name: "继续显示 12 张（剩余 133 张）" }));

    expect(within(pool).getAllByRole("listitem")).toHaveLength(24);
    expect(within(pool).getByText("候选法术 24")).toBeVisible();
    expect(within(pool).queryByText("候选法术 25")).not.toBeInTheDocument();
  });

  it("does not batch ordinary related cards or actual outcome cards", () => {
    const relatedCards = Array.from({ length: 145 }, (_, index) => ({
      dbfId: 20_000 + index,
      cardId: `RELATED_${index}`,
      name: `关联法术 ${index + 1}`,
      cardType: "法术"
    }));
    const outcomeCards = Array.from({ length: 145 }, (_, index) => ({
      key: `outcome-${index}`,
      card: {
        dbfId: 30_000 + (index % 73),
        cardId: `OUTCOME_${index % 73}`,
        name: `实际法术 ${(index % 73) + 1}`,
        cardType: "法术"
      }
    }));

    render(
      <CardDetailBody
        mode="interactive"
        details={{
          ...yoggInTheBox,
          relatedCards,
          cardPoolSections: [],
          cardOutcomeSections: [{
            key: "cast-1",
            title: "本次实际施放",
            emptyText: "本次尚未确认施放结果",
            cards: outcomeCards
          }]
        }}
      />
    );

    const related = screen.getByRole("region", { name: "生成/关联法术，共 145 张" });
    const outcome = screen.getByRole("region", { name: "本次实际施放，共 145 张" });
    expect(within(related).getAllByRole("listitem")).toHaveLength(145);
    expect(within(outcome).getAllByRole("listitem")).toHaveLength(145);
    expect(within(outcome).getAllByText("实际法术 1")).toHaveLength(2);
    expect(within(related).queryByRole("button", { name: /继续显示/ })).not.toBeInTheDocument();
    expect(within(outcome).queryByRole("button", { name: /继续显示/ })).not.toBeInTheDocument();
  });
});
