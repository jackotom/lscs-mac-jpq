import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardHoverPreview } from "../src/renderer/components/CardHoverPreview";
import type { CardDetails } from "../src/shared/cardDatabase";

const cardDetails: CardDetails = {
  dbfId: 315,
  name: "火球术",
  manaCost: 4,
  cardType: "法术",
  cardTypeId: 5,
  text: "造成 6 点伤害。",
  isSpell: true,
  relatedCards: []
};

describe("CardHoverPreview", () => {
  afterEach(() => {
    vi.useRealTimers();
    window.history.pushState({}, "", "/");
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: undefined
    });
  });

  it("uses the external preview window in overlay mode", () => {
    vi.useFakeTimers();
    const showCardPreview = vi.fn(() => Promise.resolve());
    const hideCardPreview = vi.fn(() => Promise.resolve());
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: {
        showCardPreview,
        hideCardPreview
      }
    });
    window.history.pushState({}, "", "/?overlay=1");

    render(
      <CardHoverPreview details={cardDetails}>
        <button type="button">火球术</button>
      </CardHoverPreview>
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "火球术" }));

    expect(showCardPreview).toHaveBeenCalledWith({
      details: cardDetails,
      anchorRect: expect.objectContaining({
        left: expect.any(Number),
        top: expect.any(Number),
        right: expect.any(Number),
        width: expect.any(Number),
        height: expect.any(Number)
      })
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByRole("button", { name: "火球术" }));

    expect(hideCardPreview).not.toHaveBeenCalled();
    vi.advanceTimersByTime(130);
    expect(hideCardPreview).toHaveBeenCalled();
  });

  it("reports hover and focus independently", () => {
    const onHoverChange = vi.fn();
    const onFocusChange = vi.fn();
    render(
      <CardHoverPreview
        details={cardDetails}
        onHoverChange={onHoverChange}
        onFocusChange={onFocusChange}
      >
        <span>火球术</span>
      </CardHoverPreview>
    );

    const target = screen.getByText("火球术").closest(".card-hover-target") as HTMLElement;
    fireEvent.mouseEnter(target);
    fireEvent.focus(target);
    fireEvent.mouseLeave(target);

    expect(onHoverChange.mock.calls).toEqual([[true], [false]]);
    expect(onFocusChange.mock.calls).toEqual([[true]]);

    fireEvent.blur(target);
    expect(onFocusChange.mock.calls).toEqual([[true], [false]]);
  });

  it("toggles controlled selection with click, Enter, and Space", () => {
    const onSelectedChange = vi.fn();
    const preview = render(
      <CardHoverPreview
        details={cardDetails}
        selected={false}
        onSelectedChange={onSelectedChange}
      >
        <span>火球术</span>
      </CardHoverPreview>
    );

    let target = screen.getByText("火球术").closest(".card-hover-target") as HTMLElement;
    expect(target).toHaveAttribute("data-card-selected", "false");
    fireEvent.click(target);
    expect(onSelectedChange).toHaveBeenLastCalledWith(true);

    preview.rerender(
      <CardHoverPreview
        details={cardDetails}
        selected
        onSelectedChange={onSelectedChange}
      >
        <span>火球术</span>
      </CardHoverPreview>
    );
    target = screen.getByText("火球术").closest(".card-hover-target") as HTMLElement;
    expect(target).toHaveAttribute("data-card-selected", "true");

    fireEvent.keyDown(target, { key: "Enter" });
    expect(onSelectedChange).toHaveBeenLastCalledWith(false);
    fireEvent.keyDown(target, { key: " " });
    expect(onSelectedChange).toHaveBeenLastCalledWith(false);
  });

  it.each(["window blur", "document hidden"])(
    "ends hover and focus on %s without clearing selection",
    (reason) => {
      const onHoverChange = vi.fn();
      const onFocusChange = vi.fn();
      const onSelectedChange = vi.fn();
      Object.defineProperty(window, "hearthstoneTracker", {
        configurable: true,
        value: {
          showCardPreview: vi.fn(() => Promise.resolve()),
          hideCardPreview: vi.fn(() => Promise.resolve())
        }
      });
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      window.history.pushState({}, "", "/?overlay=1");
      render(
        <CardHoverPreview
          details={cardDetails}
          selected
          onHoverChange={onHoverChange}
          onFocusChange={onFocusChange}
          onSelectedChange={onSelectedChange}
        >
          <span>火球术</span>
        </CardHoverPreview>
      );

      const target = screen.getByText("火球术").closest(".card-hover-target") as HTMLElement;
      fireEvent.mouseEnter(target);
      fireEvent.focus(target);
      if (reason === "window blur") {
        window.dispatchEvent(new Event("blur"));
      } else {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      }

      expect(onHoverChange).toHaveBeenLastCalledWith(false);
      expect(onFocusChange).toHaveBeenLastCalledWith(false);
      expect(onSelectedChange).not.toHaveBeenCalled();
      expect(target).toHaveAttribute("data-card-selected", "true");
    }
  );

  it("ends transient activity for every row when another row owns the preview", () => {
    const firstFocusChange = vi.fn();
    const secondHoverChange = vi.fn();
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: {
        showCardPreview: vi.fn(() => Promise.resolve()),
        hideCardPreview: vi.fn(() => Promise.resolve())
      }
    });
    window.history.pushState({}, "", "/?overlay=1");
    render(
      <>
        <CardHoverPreview details={cardDetails} onFocusChange={firstFocusChange}>
          <span>火球术</span>
        </CardHoverPreview>
        <CardHoverPreview
          details={{ ...cardDetails, dbfId: 316, name: "炎爆术" }}
          onHoverChange={secondHoverChange}
        >
          <span>炎爆术</span>
        </CardHoverPreview>
      </>
    );

    fireEvent.focus(screen.getByText("火球术").closest(".card-hover-target") as HTMLElement);
    fireEvent.mouseEnter(screen.getByText("炎爆术").closest(".card-hover-target") as HTMLElement);
    window.dispatchEvent(new Event("blur"));

    expect(firstFocusChange).toHaveBeenLastCalledWith(false);
    expect(secondHoverChange).toHaveBeenLastCalledWith(false);
  });

  it("clears a stale external preview when the hover state is gone", () => {
    vi.useFakeTimers();
    const showCardPreview = vi.fn(() => Promise.resolve());
    const hideCardPreview = vi.fn(() => Promise.resolve());
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: {
        showCardPreview,
        hideCardPreview
      }
    });
    window.history.pushState({}, "", "/?overlay=1");

    render(
      <CardHoverPreview details={cardDetails}>
        <button type="button">火球术</button>
      </CardHoverPreview>
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "火球术" }));
    vi.advanceTimersByTime(650);

    expect(hideCardPreview).toHaveBeenCalled();
  });

  it("opens the external preview when card details arrive under an already hovered row", () => {
    const showCardPreview = vi.fn(() => Promise.resolve());
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: {
        showCardPreview,
        hideCardPreview: vi.fn(() => Promise.resolve())
      }
    });
    window.history.pushState({}, "", "/?overlay=1");

    const { rerender } = render(
      <CardHoverPreview details={undefined}>
        <button type="button">火球术</button>
      </CardHoverPreview>
    );
    const target = screen.getByRole("button", { name: "火球术" }).closest(".card-hover-target") as HTMLElement;
    vi.spyOn(target, "matches").mockImplementation((selector) => selector === ":hover");

    fireEvent.mouseEnter(target, { clientX: 10, clientY: 10 });
    expect(showCardPreview).not.toHaveBeenCalled();

    rerender(
      <CardHoverPreview details={cardDetails}>
        <button type="button">火球术</button>
      </CardHoverPreview>
    );

    expect(showCardPreview).toHaveBeenCalledWith({
      details: cardDetails,
      anchorRect: expect.any(Object)
    });
  });

  it("keeps the external preview visible when the pointer is still inside the anchor bounds", () => {
    vi.useFakeTimers();
    const showCardPreview = vi.fn(() => Promise.resolve());
    const hideCardPreview = vi.fn(() => Promise.resolve());
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: {
        showCardPreview,
        hideCardPreview
      }
    });
    window.history.pushState({}, "", "/?overlay=1");

    render(
      <CardHoverPreview details={cardDetails}>
        <button type="button">火球术</button>
      </CardHoverPreview>
    );

    const button = screen.getByRole("button", { name: "火球术" });
    const target = button.closest(".card-hover-target") as HTMLElement;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 20,
      right: 210,
      bottom: 60,
      width: 200,
      height: 40,
      x: 10,
      y: 20,
      toJSON: () => ({})
    } as DOMRect);
    vi.spyOn(target, "matches").mockReturnValue(false);

    fireEvent.mouseEnter(button, { clientX: 80, clientY: 40 });
    vi.advanceTimersByTime(550);

    expect(hideCardPreview).not.toHaveBeenCalled();
    expect(showCardPreview).toHaveBeenCalledTimes(2);
  });

  it("hides the external preview on window blur and requires a new hover to show again", () => {
    vi.useFakeTimers();
    const showCardPreview = vi.fn(() => Promise.resolve());
    const hideCardPreview = vi.fn(() => Promise.resolve());
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: {
        showCardPreview,
        hideCardPreview
      }
    });
    window.history.pushState({}, "", "/?overlay=1");

    render(
      <CardHoverPreview details={cardDetails}>
        <button type="button">火球术</button>
      </CardHoverPreview>
    );

    const button = screen.getByRole("button", { name: "火球术" });
    const target = button.closest(".card-hover-target") as HTMLElement;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 20,
      right: 210,
      bottom: 60,
      width: 200,
      height: 40,
      x: 10,
      y: 20,
      toJSON: () => ({})
    } as DOMRect);
    vi.spyOn(target, "matches").mockReturnValue(true);

    fireEvent.mouseEnter(button, { clientX: 80, clientY: 40 });
    window.dispatchEvent(new Event("blur"));
    act(() => vi.advanceTimersByTime(1_000));

    expect(hideCardPreview).toHaveBeenCalledTimes(1);
    expect(showCardPreview).toHaveBeenCalledTimes(1);

    fireEvent.mouseEnter(button, { clientX: 80, clientY: 40 });
    expect(showCardPreview).toHaveBeenCalledTimes(2);
  });

  it("hides the external preview when the document becomes hidden", () => {
    vi.useFakeTimers();
    const showCardPreview = vi.fn(() => Promise.resolve());
    const hideCardPreview = vi.fn(() => Promise.resolve());
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: {
        showCardPreview,
        hideCardPreview
      }
    });
    window.history.pushState({}, "", "/?overlay=1");

    render(
      <CardHoverPreview details={cardDetails}>
        <button type="button">火球术</button>
      </CardHoverPreview>
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "火球术" }));
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true
    });
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(1_000);

    expect(hideCardPreview).toHaveBeenCalledTimes(1);
    expect(showCardPreview).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false
    });
  });

  it("pins the active external preview with Option+Q until Option+Q is pressed again", () => {
    vi.useFakeTimers();
    const showCardPreview = vi.fn(() => Promise.resolve());
    const hideCardPreview = vi.fn(() => Promise.resolve());
    let notifyPinnedChange: ((pinned: boolean) => void) | undefined;
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: {
        showCardPreview,
        hideCardPreview,
        onCardPreviewPinnedChange: (callback: (pinned: boolean) => void) => {
          notifyPinnedChange = callback;
          return () => undefined;
        }
      }
    });
    window.history.pushState({}, "", "/?overlay=1");

    render(
      <CardHoverPreview details={cardDetails}>
        <button type="button">火球术</button>
      </CardHoverPreview>
    );

    const button = screen.getByRole("button", { name: "火球术" });
    const target = button.closest(".card-hover-target") as HTMLElement;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 20,
      right: 210,
      bottom: 60,
      width: 200,
      height: 40,
      x: 10,
      y: 20,
      toJSON: () => ({})
    } as DOMRect);
    vi.spyOn(target, "matches").mockReturnValue(false);

    fireEvent.mouseEnter(button, { clientX: 80, clientY: 40 });
    act(() => notifyPinnedChange?.(true));

    expect(target).toHaveAttribute("data-preview-pinned", "true");
    expect(target).toHaveAttribute("aria-keyshortcuts", "Alt+Q");

    fireEvent.mouseLeave(button, { clientX: 260, clientY: 40 });
    vi.advanceTimersByTime(1_000);
    expect(hideCardPreview).not.toHaveBeenCalled();

    act(() => notifyPinnedChange?.(false));
    fireEvent.mouseLeave(button, { clientX: 260, clientY: 40 });
    act(() => vi.advanceTimersByTime(130));
    expect(hideCardPreview).toHaveBeenCalledTimes(1);
    expect(target).toHaveAttribute("data-preview-pinned", "false");
  });

  it("accepts pinned state from the main process", () => {
    const showCardPreview = vi.fn(() => Promise.resolve());
    let notifyPinnedChange: ((pinned: boolean) => void) | undefined;
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: {
        showCardPreview,
        hideCardPreview: vi.fn(() => Promise.resolve()),
        onCardPreviewPinnedChange: (callback: (pinned: boolean) => void) => {
          notifyPinnedChange = callback;
          return () => undefined;
        }
      }
    });
    window.history.pushState({}, "", "/?overlay=1");

    render(
      <CardHoverPreview details={cardDetails}>
        <button type="button">火球术</button>
      </CardHoverPreview>
    );

    const button = screen.getByRole("button", { name: "火球术" });
    const target = button.closest(".card-hover-target") as HTMLElement;
    fireEvent.mouseEnter(button);
    act(() => notifyPinnedChange?.(true));

    expect(target).toHaveAttribute("data-preview-pinned", "true");
  });

  it("clears a pinned external preview when the window loses focus", () => {
    vi.useFakeTimers();
    const showCardPreview = vi.fn(() => Promise.resolve());
    const hideCardPreview = vi.fn(() => Promise.resolve());
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: {
        showCardPreview,
        hideCardPreview
      }
    });
    window.history.pushState({}, "", "/?overlay=1");

    render(
      <CardHoverPreview details={cardDetails}>
        <button type="button">火球术</button>
      </CardHoverPreview>
    );

    const button = screen.getByRole("button", { name: "火球术" });
    const target = button.closest(".card-hover-target") as HTMLElement;
    fireEvent.mouseEnter(button);
    fireEvent.keyDown(window, { key: "Q", altKey: true });
    fireEvent.blur(window);

    expect(hideCardPreview).toHaveBeenCalledTimes(1);
    expect(target).toHaveAttribute("data-preview-pinned", "false");
  });

  it("cancels the delayed external hide when the pointer returns to the anchor", () => {
    vi.useFakeTimers();
    const showCardPreview = vi.fn(() => Promise.resolve());
    const hideCardPreview = vi.fn(() => Promise.resolve());
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: {
        showCardPreview,
        hideCardPreview
      }
    });
    window.history.pushState({}, "", "/?overlay=1");

    render(
      <CardHoverPreview details={cardDetails}>
        <button type="button">火球术</button>
      </CardHoverPreview>
    );

    const button = screen.getByRole("button", { name: "火球术" });
    const target = button.closest(".card-hover-target") as HTMLElement;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 20,
      right: 210,
      bottom: 60,
      width: 200,
      height: 40,
      x: 10,
      y: 20,
      toJSON: () => ({})
    } as DOMRect);
    vi.spyOn(target, "matches").mockReturnValue(false);

    fireEvent.mouseEnter(button, { clientX: 80, clientY: 40 });
    fireEvent.mouseLeave(button, { clientX: 260, clientY: 40 });
    fireEvent.mouseEnter(button, { clientX: 80, clientY: 40 });
    vi.advanceTimersByTime(130);

    expect(hideCardPreview).not.toHaveBeenCalled();
  });

  it("hides after mouseleave even when Electron reports stale coordinates inside the anchor", () => {
    vi.useFakeTimers();
    const showCardPreview = vi.fn(() => Promise.resolve());
    const hideCardPreview = vi.fn(() => Promise.resolve());
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: {
        showCardPreview,
        hideCardPreview
      }
    });
    window.history.pushState({}, "", "/?overlay=1");

    render(
      <CardHoverPreview details={cardDetails}>
        <button type="button">火球术</button>
      </CardHoverPreview>
    );

    const button = screen.getByRole("button", { name: "火球术" });
    const target = button.closest(".card-hover-target") as HTMLElement;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 20,
      right: 210,
      bottom: 60,
      width: 200,
      height: 40,
      x: 10,
      y: 20,
      toJSON: () => ({})
    } as DOMRect);
    vi.spyOn(target, "matches").mockReturnValue(false);

    fireEvent.mouseEnter(button, { clientX: 80, clientY: 40 });
    fireEvent.mouseLeave(button, { clientX: 80, clientY: 40 });
    vi.advanceTimersByTime(130);

    expect(hideCardPreview).toHaveBeenCalledTimes(1);
  });

  it("does not let an inactive preview target hide the active external preview", () => {
    vi.useFakeTimers();
    const showCardPreview = vi.fn(() => Promise.resolve());
    const hideCardPreview = vi.fn(() => Promise.resolve());
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: {
        showCardPreview,
        hideCardPreview
      }
    });
    window.history.pushState({}, "", "/?overlay=1");

    render(
      <>
        <CardHoverPreview details={cardDetails}>
          <button type="button">火球术</button>
        </CardHoverPreview>
        <CardHoverPreview details={{ ...cardDetails, dbfId: 621, name: "炎爆术" }}>
          <button type="button">炎爆术</button>
        </CardHoverPreview>
      </>
    );

    const activeButton = screen.getByRole("button", { name: "火球术" });
    const activeTarget = activeButton.closest(".card-hover-target") as HTMLElement;
    vi.spyOn(activeTarget, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 20,
      right: 210,
      bottom: 60,
      width: 200,
      height: 40,
      x: 10,
      y: 20,
      toJSON: () => ({})
    } as DOMRect);
    vi.spyOn(activeTarget, "matches").mockReturnValue(false);

    fireEvent.mouseEnter(activeButton, { clientX: 80, clientY: 40 });
    window.dispatchEvent(new MouseEvent("mouseleave", { clientX: 80, clientY: 40 }));
    vi.advanceTimersByTime(130);

    expect(hideCardPreview).not.toHaveBeenCalled();
  });

  it("shows the Galactic Projection Orb spell history and its empty state in the local preview", () => {
    const projectionOrbDetails: CardDetails = {
      dbfId: 103354,
      cardId: "TOY_378",
      name: "星空投影球",
      manaCost: 10,
      cardType: "法术",
      isSpell: true,
      relatedCards: [],
      playedSpellsThisGame: [
        { dbfId: 1, cardId: "CORE_CS2_024", name: "寒冰箭", manaCost: 2 },
        { dbfId: 1, cardId: "CORE_CS2_024", name: "寒冰箭", manaCost: 2 },
        { dbfId: 2, cardId: "CORE_CATA_009", name: "死神之躯", manaCost: 8 }
      ]
    };
    const { rerender } = render(
      <CardHoverPreview details={projectionOrbDetails}>
        <button type="button">星空投影球</button>
      </CardHoverPreview>
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "星空投影球" }));

    const populatedTooltip = screen.getByRole("tooltip");
    expect(populatedTooltip).toHaveTextContent("本局已施放 3 个法术");
    expect(populatedTooltip).not.toHaveTextContent("生成/关联法术（0）");
    expect(within(populatedTooltip).getAllByText(/^(?:寒冰箭|死神之躯)$/).map((item) => item.textContent)).toEqual([
      "寒冰箭",
      "寒冰箭",
      "死神之躯"
    ]);

    rerender(
      <CardHoverPreview details={{ ...projectionOrbDetails, playedSpellsThisGame: [] }}>
        <button type="button">星空投影球</button>
      </CardHoverPreview>
    );

    expect(screen.getByRole("tooltip")).toHaveTextContent("本局还没有施放过法术");
  });

  it("shows the exact demon that Moment of Glory will resurrect", () => {
    const momentOfGloryDetails: CardDetails = {
      dbfId: 106652,
      cardId: "TOY_886",
      name: "决胜时刻",
      manaCost: 2,
      cardType: "法术",
      text: "复活上一个死亡的你的恶魔。",
      isSpell: true,
      relatedCards: [],
      gameContextSections: [
        {
          key: "dead-minions",
          title: "将复活",
          emptyText: "暂未确认将复活的恶魔",
          cards: [
            {
              dbfId: 125917,
              cardId: "JAIL_399",
              name: "小鬼马仔",
              manaCost: 3,
              cardType: "随从"
            }
          ]
        }
      ]
    };

    render(
      <CardHoverPreview details={momentOfGloryDetails}>
        <button type="button">决胜时刻</button>
      </CardHoverPreview>
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "决胜时刻" }));

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("将复活（1）");
    expect(within(tooltip).getByText("小鬼马仔")).toBeInTheDocument();
  });

  it("keeps the in-page tooltip outside overlay mode", () => {
    render(
      <CardHoverPreview details={cardDetails}>
        <button type="button">火球术</button>
      </CardHoverPreview>
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "火球术" }));

    expect(screen.getByRole("tooltip")).toHaveTextContent("造成 6 点伤害。");
  });

  it("pins only the active in-page preview with real keyboard events and cleans it on unmount", () => {
    const { rerender } = render(
      <>
        <CardHoverPreview details={cardDetails}>
          <button type="button">火球术</button>
        </CardHoverPreview>
        <CardHoverPreview details={{ ...cardDetails, dbfId: 621, name: "炎爆术" }}>
          <button type="button">炎爆术</button>
        </CardHoverPreview>
      </>
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "炎爆术" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("炎爆术");

    fireEvent.keyDown(window, { key: "q", altKey: true });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("炎爆术");
    expect(dialog).toHaveTextContent("已固定 · ⌥Q 取消");
    expect(dialog).toHaveAttribute("data-preview-pinned", "true");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByRole("button", { name: "炎爆术" }));
    fireEvent.keyDown(window, { key: "Q", altKey: true });
    expect(screen.getByRole("dialog")).toHaveTextContent("炎爆术");

    rerender(
      <CardHoverPreview details={cardDetails}>
        <button type="button">火球术</button>
      </CardHoverPreview>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
