import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardLibraryPanel } from "../src/renderer/components/CardLibraryPanel";

describe("card library sources", () => {
  it("audit regression: reveals source authorization without hiding the card result", () => {
    render(<CardLibraryPanel
      cards={[{ dbfId: 7, name: "测试卡牌", isSpell: true, relatedCards: [] }]}
      total={1}
      filters={{ heroClass: "", cardType: "", heroClasses: [], cardTypes: [] }}
      query="" loading={false} page={{ current: 1, totalPages: 1 }}
      sources={[{ id: "official", label: "炉石官网", urls: ["https://hs.blizzard.cn/cards/"], authorization: { status: "pending-confirmation", note: "分发范围待确认。" } }]}
      onSearch={vi.fn()} onClassChange={vi.fn()} onTypeChange={vi.fn()} onPageChange={vi.fn()} onSelectCard={vi.fn()}
    />);

    expect(screen.getByLabelText("查看 测试卡牌 详情")).toBeInTheDocument();
    fireEvent.click(screen.getByText("数据来源"));
    expect(screen.getByText("炉石官网")).toBeInTheDocument();
    expect(screen.getByText("授权待确认")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "官网链接" })).toHaveAttribute("href", "https://hs.blizzard.cn/cards/");
  });
});
