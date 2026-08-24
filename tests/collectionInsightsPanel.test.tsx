import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CollectionInsightsPanel } from "../src/renderer/components/CollectionInsightsPanel";

describe("collection insights panel", () => {
  it("shows real collection snapshot facts with source and update time", () => {
    render(<CollectionInsightsPanel loading={false} result={{
      status: "ok",
      source: "import",
      updatedAt: "2026-08-22T12:00:00.000Z",
      cards: [{ cardId: "A", name: "火球术", normal: 2, golden: 1 }],
      packs: [{ id: "pack-1", set: "标准包", openedAt: "2026-08-22T11:00:00.000Z", cards: [{ rarity: "legendary" }] }],
      pity: [{ set: "标准包", packsSinceLegendary: 4, partial: true }],
      cardBacks: [{ id: "back-1", name: "火焰卡背" }],
      heroSkins: [{ id: "skin-1", name: "吉安娜" }],
      coins: [{ id: "coin-1", name: "奥术硬币" }]
    }} />);

    const panel = screen.getByLabelText("收藏中心");
    expect(panel).toHaveTextContent("完成度");
    expect(panel).toHaveTextContent("从本次记录起");
    expect(panel).toHaveTextContent("火焰卡背");
    expect(panel).toHaveTextContent("导入");
    expect(panel.querySelector(".collection-insights-pity-partial")).toHaveTextContent("从本次记录起");
  });

  it("shows empty and error states without inventing collection data", () => {
    const preview = render(<CollectionInsightsPanel loading={false} result={{ status: "ok", source: "manual", updatedAt: "2026-08-22T12:00:00.000Z", cards: [], packs: [], pity: [], cardBacks: [], heroSkins: [], coins: [] }} />);
    expect(screen.getByRole("status")).toHaveTextContent("暂无收藏记录");
    preview.rerender(<CollectionInsightsPanel loading={false} error="读取收藏失败" />);
    expect(screen.getByRole("alert")).toHaveTextContent("读取收藏失败");
  });

  it("keeps refresh under caller control", () => {
    const onRefresh = vi.fn();
    render(<CollectionInsightsPanel loading={false} onRefresh={onRefresh} result={{ status: "ok", source: "manual", updatedAt: "2026-08-22T12:00:00.000Z", cards: [], packs: [], pity: [], cardBacks: [], heroSkins: [], coins: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: "刷新收藏记录" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("shows only verifiable completion and sends structured local writes", async () => {
    const onImportSnapshot = vi.fn();
    const onRecordPack = vi.fn();
    const onUpdateCosmetics = vi.fn();
    const onImportCsv = vi.fn();
    render(<CollectionInsightsPanel loading={false} onImportSnapshot={onImportSnapshot} onImportCsv={onImportCsv} onRecordPack={onRecordPack} onUpdateCosmetics={onUpdateCosmetics} result={{
      status: "ok", source: "manual", updatedAt: "2026-08-22T12:00:00.000Z",
      cards: [{ cardId: "missing", normal: 0, golden: 0 }], packs: [], pity: [{ set: "标准包", packsSinceLegendary: 1, partial: true }], cardBacks: [], heroSkins: [], coins: []
    }} />);
    expect(screen.getByLabelText("完成度")).toHaveTextContent("已记录");
    expect(screen.getByText("缺卡列表")).toBeInTheDocument();
    expect(screen.getByText("missing")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("收藏快照 JSON"), { target: { value: '{"cards":[],"packs":[],"pity":[],"cardBacks":[],"heroSkins":[],"coins":[],"updatedAt":"2026-08-22T12:00:00.000Z","source":"manual"}' } });
    fireEvent.click(screen.getByRole("button", { name: "导入收藏快照" }));
    await waitFor(() => expect(onImportSnapshot).toHaveBeenCalledWith(expect.objectContaining({ source: "manual" })));
    fireEvent.change(screen.getByLabelText("收藏快照 JSON"), { target: { value: "cardId,name,normal,golden\nA,火球术,2,0" } });
    fireEvent.click(screen.getByRole("button", { name: "导入收藏快照" }));
    await waitFor(() => expect(onImportCsv).toHaveBeenCalledWith("cardId,name,normal,golden\nA,火球术,2,0"));
    fireEvent.change(screen.getByLabelText("开包记录 JSON"), { target: { value: '{"id":"pack-2","set":"标准包","openedAt":"2026-08-22T12:00:00.000Z","cards":[{"rarity":"rare"}]}' } });
    fireEvent.click(screen.getByRole("button", { name: "记录开包" }));
    await waitFor(() => expect(onRecordPack).toHaveBeenCalledWith(expect.objectContaining({ id: "pack-2" })));
    fireEvent.change(screen.getByLabelText("装饰品 JSON"), { target: { value: '{"cardBacks":[{"id":"back","name":"火焰"}]}' } });
    fireEvent.click(screen.getByRole("button", { name: "更新装饰品" }));
    await waitFor(() => expect(onUpdateCosmetics).toHaveBeenCalledWith({ cardBacks: [{ id: "back", name: "火焰" }] }));
  });
});
