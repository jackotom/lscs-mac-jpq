import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardLibraryPanel, type CardLibraryCard, type CardLibraryFilters } from "../src/renderer/components/CardLibraryPanel";
import { createCardDatabase, listCardLibrary } from "../src/shared/cardDatabase";

const filters: CardLibraryFilters = {
  heroClass: "",
  cardType: "",
  heroClasses: ["中立", "法师"],
  cardTypes: ["随从", "法术"]
};

const cards: CardLibraryCard[] = [
  {
    dbfId: 315,
    name: "火球术",
    manaCost: 4,
    cardType: "法术",
    cardTypeId: 5,
    heroClass: "法师",
    text: "造成 6 点伤害。",
    isSpell: true,
    relatedCards: [
      { dbfId: 621, name: "炎爆术", manaCost: 10, cardType: "法术", text: "造成 10 点伤害。" }
    ]
  },
  {
    dbfId: 1001,
    name: "碧蓝幼龙",
    manaCost: 5,
    attack: 4,
    health: 4,
    cardType: "随从",
    heroClass: "中立",
    text: "法术伤害 +1。战吼：抽一张牌。",
    isSpell: false,
    relatedCards: []
  }
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof CardLibraryPanel>> = {}) {
  const callbacks = {
    onSearch: vi.fn(),
    onClassChange: vi.fn(),
    onTypeChange: vi.fn(),
    onPageChange: vi.fn(),
    onSelectCard: vi.fn()
  };

  render(
    <CardLibraryPanel
      cards={cards}
      total={2431}
      filters={filters}
      query=""
      loading={false}
      page={{ current: 1, totalPages: 4 }}
      {...callbacks}
      {...overrides}
    />
  );

  return callbacks;
}

describe("CardLibraryPanel", () => {
  it("renders filterable card results and routes controls to the host", () => {
    const callbacks = renderPanel();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索卡牌" }), { target: { value: "火球" } });
    fireEvent.change(screen.getByLabelText("职业筛选"), { target: { value: "法师" } });
    fireEvent.change(screen.getByLabelText("类型筛选"), { target: { value: "法术" } });
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));

    expect(screen.getByText("火球术")).toBeInTheDocument();
    expect(screen.getByText("碧蓝幼龙")).toBeInTheDocument();
    expect(screen.getByLabelText("共 2,431 张卡牌")).toBeInTheDocument();
    expect(callbacks.onSearch).toHaveBeenCalledWith("火球");
    expect(callbacks.onClassChange).toHaveBeenCalledWith("法师");
    expect(callbacks.onTypeChange).toHaveBeenCalledWith("法术");
    expect(callbacks.onPageChange).toHaveBeenCalledWith(2);
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
  });

  it("opens the shared card detail flow from hover and selection", () => {
    const callbacks = renderPanel();
    const fireball = screen.getByRole("button", { name: "查看 火球术 详情" });

    fireEvent.mouseEnter(fireball);
    expect(screen.getByRole("tooltip")).toHaveTextContent("造成 6 点伤害。");
    expect(screen.getByRole("tooltip")).toHaveTextContent("炎爆术");

    fireEvent.click(fireball);
    expect(callbacks.onSelectCard).toHaveBeenCalledWith(cards[0]);
    expect(screen.getByLabelText("已选卡牌：火球术")).toHaveTextContent("造成 6 点伤害。");
  });

  it("uses the current full card image before a stale cropped thumbnail", () => {
    renderPanel({
      cards: [{
        ...cards[0],
        cropImageUrl: "https://cards.example.test/crop/fireball.jpg",
        imageUrl: "https://cards.example.test/full/fireball.jpg"
      }]
    });

    const fullImage = document.querySelector<HTMLImageElement>(".card-library-art img");
    expect(fullImage).toHaveAttribute("src", "https://cards.example.test/full/fireball.jpg");

    fireEvent.error(fullImage!);

    expect(document.querySelector<HTMLImageElement>(".card-library-art img")).toHaveAttribute(
      "src",
      "https://cards.example.test/crop/fireball.jpg"
    );
  });

  it("shows one accessible missing-image state after both artwork URLs fail", () => {
    renderPanel({
      cards: [{
        ...cards[0],
        cropImageUrl: "https://cards.example.test/crop/fireball.jpg",
        imageUrl: "https://cards.example.test/full/fireball.jpg"
      }]
    });

    fireEvent.error(document.querySelector<HTMLImageElement>(".card-library-art img")!);

    const croppedImage = document.querySelector<HTMLImageElement>(".card-library-art img");
    expect(croppedImage).toHaveAttribute("src", "https://cards.example.test/crop/fireball.jpg");
    fireEvent.error(croppedImage!);

    expect(document.querySelector(".card-library-art")).toHaveClass("is-empty");
    expect(document.querySelector(".card-library-art")).toHaveAccessibleName("卡图不可用");
  });

  it("renders derived artwork for a legacy card record without official image fields", () => {
    const database = createCardDatabase([
      {
        dbfId: 69622,
        cardId: "CORE_EX1_144",
        name: "暗影步",
        collectible: true,
        cardType: "法术"
      }
    ]);
    const result = listCardLibrary(database);

    renderPanel({ cards: result.items });

    expect(document.querySelector<HTMLImageElement>(".card-library-art img")).toHaveAttribute(
      "src",
      "https://art.hearthstonejson.com/v1/render/latest/zhCN/256x/CORE_EX1_144.png"
    );
    expect(screen.queryByLabelText("卡图不可用")).not.toBeInTheDocument();
  });

  it("shows loading, error, and empty states without a broken grid", () => {
    const { rerender } = render(
      <CardLibraryPanel
        cards={[]}
        total={0}
        filters={filters}
        query=""
        loading
        page={{ current: 1, totalPages: 1 }}
        onSearch={vi.fn()}
        onClassChange={vi.fn()}
        onTypeChange={vi.fn()}
        onPageChange={vi.fn()}
        onSelectCard={vi.fn()}
      />
    );

    expect(screen.getByText("正在读取卡牌数据库")).toBeInTheDocument();

    rerender(
      <CardLibraryPanel
        cards={[]}
        total={0}
        filters={filters}
        query=""
        loading={false}
        error="本地缓存不可用"
        page={{ current: 1, totalPages: 1 }}
        onSearch={vi.fn()}
        onClassChange={vi.fn()}
        onTypeChange={vi.fn()}
        onPageChange={vi.fn()}
        onSelectCard={vi.fn()}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("本地缓存不可用");

    rerender(
      <CardLibraryPanel
        cards={[]}
        total={0}
        filters={filters}
        query="虚空"
        loading={false}
        page={{ current: 1, totalPages: 1 }}
        onSearch={vi.fn()}
        onClassChange={vi.fn()}
        onTypeChange={vi.fn()}
        onPageChange={vi.fn()}
        onSelectCard={vi.fn()}
      />
    );
    expect(screen.getByText("没有匹配的卡牌")).toBeInTheDocument();
  });

  it("keeps stale results visible while clearly reporting a refresh failure", () => {
    renderPanel({ error: "本地缓存被占用" });

    expect(screen.getByRole("alert")).toHaveTextContent("刷新失败，已保留上次结果：本地缓存被占用");
    expect(screen.getByRole("button", { name: "查看 火球术 详情" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看 碧蓝幼龙 详情" })).toBeInTheDocument();
  });
});
