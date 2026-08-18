import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CardTrackingGroups } from "../src/renderer/components/CardTrackingGroups";
import type { OverlayCardTrackingView, OverlayHistoryItem } from "../src/renderer/types";

afterEach(() => {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
});

function historyItem(
  id: string,
  overrides: Partial<OverlayHistoryItem> = {}
): OverlayHistoryItem {
  return {
    id,
    sequence: 1,
    displayName: `卡牌 ${id}`,
    hidden: false,
    confidence: "confirmed",
    details: {
      dbfId: 1001,
      name: `卡牌 ${id}`,
      cropImageUrl: `https://example.test/${id}-crop.jpg`,
      isSpell: false,
      relatedCards: []
    },
    ...overrides
  };
}

function tracking({
  used = [],
  burned = []
}: {
  used?: readonly OverlayHistoryItem[];
  burned?: readonly OverlayHistoryItem[];
}): OverlayCardTrackingView {
  const zone = (key: keyof OverlayCardTrackingView["current"]) => ({
    key,
    status: "known" as const,
    knownCount: 0,
    totalCount: 0,
    countLabel: "0",
    cards: []
  });
  return {
    status: "ready",
    gameKey: "history-artwork",
    side: "opponent",
    current: {
      deck: zone("deck"),
      hand: zone("hand"),
      play: zone("play"),
      secret: zone("secret"),
      graveyard: zone("graveyard"),
      removed: zone("removed")
    },
    burned: {
      key: "burned",
      totalCount: burned.length,
      countLabel: String(burned.length),
      truncated: false,
      items: burned
    },
    used: {
      key: "used",
      totalCount: used.length,
      countLabel: String(used.length),
      truncated: false,
      items: used
    },
    secretSlots: []
  };
}

function artwork(row: Element): HTMLImageElement | null {
  return row.querySelector<HTMLImageElement>(".overlay-card-art-image");
}

describe("opponent used-history artwork", () => {
  it("retries direct crop, direct image, then card-id artwork in order", () => {
    const item = historyItem("fallback", {
      cardId: "TEST_001",
      details: {
        dbfId: 1001,
        cardId: "TEST_001",
        name: "备用图源卡",
        cropImageUrl: "https://example.test/direct-crop.jpg",
        imageUrl: "https://example.test/direct-image.png",
        isSpell: false,
        relatedCards: []
      }
    });
    render(<CardTrackingGroups view={tracking({ used: [item] })} opponent />);
    const row = screen.getByText("卡牌 fallback").closest(".overlay-history-card-row")!;

    expect(artwork(row)?.src).toBe("https://example.test/direct-crop.jpg");
    fireEvent.error(artwork(row)!);
    expect(artwork(row)?.src).toBe("https://example.test/direct-image.png");
    fireEvent.error(artwork(row)!);
    expect(artwork(row)?.src).toContain("/v1/tiles/TEST_001.jpg");
  });

  it("removes exhausted artwork but keeps the card name", () => {
    const item = historyItem("exhausted", {
      details: {
        dbfId: 1002,
        name: "全部失败卡",
        cropImageUrl: "https://example.test/only-source.jpg",
        isSpell: false,
        relatedCards: []
      }
    });
    render(<CardTrackingGroups view={tracking({ used: [item] })} opponent />);
    const row = screen.getByText("卡牌 exhausted").closest(".overlay-history-card-row")!;

    fireEvent.error(artwork(row)!);
    expect(artwork(row)).toBeNull();
    expect(screen.getByText("卡牌 exhausted")).toBeVisible();
  });

  it("retries A from its first source after the same item changes A to B to A", () => {
    const a = historyItem("same", {
      details: {
        dbfId: 1003,
        name: "A",
        cropImageUrl: "https://example.test/a.jpg",
        isSpell: false,
        relatedCards: []
      }
    });
    const b = historyItem("same", {
      details: {
        dbfId: 1004,
        name: "B",
        cropImageUrl: "https://example.test/b.jpg",
        isSpell: false,
        relatedCards: []
      }
    });
    const preview = render(<CardTrackingGroups view={tracking({ used: [a] })} opponent />);
    const currentRow = () => screen.getByText("卡牌 same").closest(".overlay-history-card-row")!;

    fireEvent.error(artwork(currentRow())!);
    expect(artwork(currentRow())).toBeNull();
    preview.rerender(<CardTrackingGroups view={tracking({ used: [b] })} opponent />);
    expect(artwork(currentRow())?.src).toBe("https://example.test/b.jpg");
    preview.rerender(<CardTrackingGroups view={tracking({ used: [a] })} opponent />);
    expect(artwork(currentRow())?.src).toBe("https://example.test/a.jpg");
  });

  it("keeps repeated-card image failures isolated by history row", () => {
    const repeated = historyItem("repeat");
    const preview = render(<CardTrackingGroups view={tracking({
      used: [repeated, { ...repeated, id: "repeat-copy", sequence: 2 }]
    })} opponent />);
    const rows = preview.container.querySelectorAll(".overlay-history-card-row");

    fireEvent.error(artwork(rows[0]!)!);
    expect(artwork(rows[0]!)).toBeNull();
    expect(artwork(rows[1]!)?.src).toBe("https://example.test/repeat-crop.jpg");
  });

  it("renders 25+ revealed rows lazily inside the single history scroll owner", () => {
    const used = Array.from({ length: 26 }, (_value, index) =>
      historyItem(`long-${index}`, { sequence: index + 1 })
    );
    const preview = render(<CardTrackingGroups view={tracking({ used })} opponent />);
    const rows = preview.container.querySelectorAll(".overlay-history-card-row");
    const images = preview.container.querySelectorAll(".overlay-history-card-row .overlay-card-art-image");

    expect(rows).toHaveLength(26);
    expect(images).toHaveLength(26);
    expect([...images].every((image) => image.getAttribute("loading") === "lazy")).toBe(true);
    expect(preview.container.querySelectorAll('[data-scroll-owner="card-tracking-main"]')).toHaveLength(1);
  });

  it("does not render artwork for hidden records", () => {
    const hidden = historyItem("hidden", {
      displayName: undefined,
      hidden: true
    });
    const preview = render(<CardTrackingGroups view={tracking({ used: [hidden] })} opponent />);

    expect(screen.getByText("未公开记录")).toBeVisible();
    expect(preview.container.querySelector(".overlay-history-card-row .overlay-card-art-image")).toBeNull();
  });

  it("does not render artwork for friendly used history or either burned history", () => {
    const item = historyItem("scoped");
    const friendly = render(<CardTrackingGroups view={tracking({ used: [item] })} />);
    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    expect(friendly.container.querySelector(".overlay-history-card-row .overlay-card-art-image")).toBeNull();
    friendly.unmount();

    const friendlyBurned = render(<CardTrackingGroups view={tracking({ burned: [item] })} />);
    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    expect(friendlyBurned.container.querySelector(".overlay-history-card-row .overlay-card-art-image")).toBeNull();
    friendlyBurned.unmount();

    const opponentBurned = render(<CardTrackingGroups view={tracking({ burned: [item] })} opponent />);
    expect(opponentBurned.container.querySelector(".overlay-history-card-row .overlay-card-art-image")).toBeNull();
  });
});
