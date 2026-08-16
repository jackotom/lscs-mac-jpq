import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SingleAttackOverlay } from "../src/renderer/components/SingleAttackOverlay";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(window, "hearthstoneTracker", {
    configurable: true,
    value: undefined
  });
});

describe("single attack overlay dragging", () => {
  it("wakes from a forwarded mouse move, moves only after 4px, and restores pass-through on pointerup", () => {
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

    fireEvent.mouseMove(counter, { screenX: 110, screenY: 220 });
    dispatchPointer("pointerdown", { pointerId: 4, button: 0, screenX: 110, screenY: 220 });
    dispatchPointer("pointermove", { pointerId: 4, buttons: 1, screenX: 112, screenY: 222 });
    dispatchPointer("pointermove", { pointerId: 4, buttons: 1, screenX: 135, screenY: 245 });
    dispatchPointer("pointerup", { pointerId: 4, button: 0, screenX: 135, screenY: 245 });

    expect(setAuxiliaryOverlayMouseInteractive).toHaveBeenNthCalledWith(1, true);
    expect(beginAuxiliaryOverlayDrag).toHaveBeenCalledWith({ x: 110, y: 220 });
    expect(moveAuxiliaryOverlayDrag).toHaveBeenCalledTimes(1);
    expect(moveAuxiliaryOverlayDrag).toHaveBeenLastCalledWith({ x: 135, y: 245 });
    expect(endAuxiliaryOverlayDrag).toHaveBeenCalledWith({ x: 135, y: 245 });
    expect(setAuxiliaryOverlayMouseInteractive).toHaveBeenLastCalledWith(false);
  });

  it("keeps a sub-threshold short press stationary and releases at its origin", () => {
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

    render(<SingleAttackOverlay side="opponent" value={3} />);
    const counter = screen.getByLabelText("对手场攻 3");
    const dispatchPointer = (
      type: "pointerdown" | "pointermove" | "pointerup",
      init: MouseEventInit & { readonly pointerId: number }
    ) => {
      const event = new MouseEvent(type, { bubbles: true, ...init });
      Object.defineProperty(event, "pointerId", { value: init.pointerId });
      fireEvent(counter, event);
    };

    fireEvent.mouseMove(counter);
    dispatchPointer("pointerdown", { pointerId: 8, button: 0, screenX: 50, screenY: 80 });
    dispatchPointer("pointermove", { pointerId: 8, buttons: 1, screenX: 52, screenY: 82 });
    dispatchPointer("pointerup", { pointerId: 8, button: 0, screenX: 52, screenY: 82 });

    expect(moveAuxiliaryOverlayDrag).not.toHaveBeenCalled();
    expect(endAuxiliaryOverlayDrag).toHaveBeenCalledWith({ x: 50, y: 80 });
    expect(setAuxiliaryOverlayMouseInteractive).toHaveBeenLastCalledWith(false);
  });

  it.each(["pointercancel", "lostpointercapture"] as const)(
    "ends on %s and immediately restores pass-through",
    (finishType) => {
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

      render(<SingleAttackOverlay side="friendly" value={5} />);
      const counter = screen.getByLabelText("我方场攻 5");
      const dispatchPointer = (
        type: "pointerdown" | "pointermove" | "pointercancel" | "lostpointercapture",
        init: MouseEventInit & { readonly pointerId: number }
      ) => {
        const event = new MouseEvent(type, { bubbles: true, ...init });
        Object.defineProperty(event, "pointerId", { value: init.pointerId });
        fireEvent(counter, event);
      };

      fireEvent.mouseMove(counter);
      dispatchPointer("pointerdown", { pointerId: 2, button: 0, screenX: 10, screenY: 20 });
      dispatchPointer("pointermove", { pointerId: 2, buttons: 1, screenX: 30, screenY: 40 });
      dispatchPointer(finishType, { pointerId: 2, screenX: 30, screenY: 40 });

      expect(endAuxiliaryOverlayDrag).toHaveBeenCalledWith({ x: 30, y: 40 });
      expect(setAuxiliaryOverlayMouseInteractive).toHaveBeenLastCalledWith(false);
    }
  );

  it("retries restoring pass-through after a transient IPC failure", async () => {
    vi.useFakeTimers();
    const setAuxiliaryOverlayMouseInteractive = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("temporary IPC failure"))
      .mockResolvedValue(undefined);
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: { setAuxiliaryOverlayMouseInteractive }
    });

    render(<SingleAttackOverlay side="friendly" value={1} />);
    const counter = screen.getByLabelText("我方场攻 1");

    fireEvent.mouseMove(counter);
    await Promise.resolve();
    fireEvent.mouseLeave(counter);
    await Promise.resolve();
    await vi.runAllTimersAsync();

    expect(setAuxiliaryOverlayMouseInteractive).toHaveBeenNthCalledWith(1, true);
    expect(setAuxiliaryOverlayMouseInteractive).toHaveBeenNthCalledWith(2, false);
    expect(setAuxiliaryOverlayMouseInteractive).toHaveBeenNthCalledWith(3, false);
  });
});
