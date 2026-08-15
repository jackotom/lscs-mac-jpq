import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SingleAttackOverlay } from "../src/renderer/components/SingleAttackOverlay";

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "hearthstoneTracker", {
    configurable: true,
    value: undefined
  });
});

describe("single attack overlay dragging", () => {
  it("hands a complete screen-coordinate drag gesture to the main process", () => {
    const setAuxiliaryOverlayMouseInteractive = vi.fn(async () => undefined);
    const beginAuxiliaryOverlayDrag = vi.fn(async () => undefined);
    const moveAuxiliaryOverlayDrag = vi.fn(async () => undefined);
    const endAuxiliaryOverlayDrag = vi.fn(async () => undefined);
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: {
        setAuxiliaryOverlayMouseInteractive,
        beginAuxiliaryOverlayDrag,
        moveAuxiliaryOverlayDrag,
        endAuxiliaryOverlayDrag
      }
    });

    render(<SingleAttackOverlay side="friendly" value={7} />);
    const counter = screen.getByLabelText("我方场攻 7");
    const dispatchPointer = (
      type: "pointerdown" | "pointermove" | "pointerup",
      init: MouseEventInit & { readonly pointerId: number }
    ) => {
      const event = new MouseEvent(type, { bubbles: true, ...init });
      Object.defineProperty(event, "pointerId", { value: init.pointerId });
      fireEvent(counter, event);
    };

    fireEvent.pointerEnter(counter, { pointerId: 4, screenX: 110, screenY: 220 });
    dispatchPointer("pointerdown", { pointerId: 4, button: 0, screenX: 110, screenY: 220 });
    dispatchPointer("pointermove", { pointerId: 4, buttons: 1, screenX: 135, screenY: 245 });
    dispatchPointer("pointerup", { pointerId: 4, button: 0, screenX: 135, screenY: 245 });
    fireEvent.pointerLeave(counter, { pointerId: 4, screenX: 135, screenY: 245 });

    expect(setAuxiliaryOverlayMouseInteractive).toHaveBeenNthCalledWith(1, true);
    expect(beginAuxiliaryOverlayDrag).toHaveBeenCalledWith({ x: 110, y: 220 });
    expect(moveAuxiliaryOverlayDrag).toHaveBeenCalledWith({ x: 135, y: 245 });
    expect(endAuxiliaryOverlayDrag).toHaveBeenCalledWith({ x: 135, y: 245 });
    expect(setAuxiliaryOverlayMouseInteractive).toHaveBeenLastCalledWith(false);
  });
});
