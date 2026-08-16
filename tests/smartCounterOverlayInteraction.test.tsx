import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SmartCounterOverlay } from "../src/renderer/components/SmartCounterOverlay";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(window, "hearthstoneTracker", {
    configurable: true,
    value: undefined
  });
});

function dispatchPointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel" | "lostpointercapture",
  init: MouseEventInit & { readonly pointerId: number }
) {
  const event = new MouseEvent(type, { bubbles: true, ...init });
  Object.defineProperty(event, "pointerId", { value: init.pointerId });
  fireEvent(target, event);
}

function installDragApi() {
  const api = {
    setAuxiliaryOverlayMouseInteractive: vi.fn(async () => undefined),
    beginAuxiliaryOverlayDrag: vi.fn(async () => undefined),
    moveAuxiliaryOverlayDrag: vi.fn(async () => undefined),
    endAuxiliaryOverlayDrag: vi.fn(async () => undefined)
  };
  Object.defineProperty(window, "hearthstoneTracker", {
    configurable: true,
    value: api
  });
  return api;
}

describe("SmartCounterOverlay interaction", () => {
  it("keeps the transparent shell click-through and makes only each visible counter interactive", () => {
    const css = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/renderer/smartCounterOverlayStyles.css"),
      "utf8"
    );

    expect(css).toMatch(/\.smart-counter-overlay\s*\{[^}]*pointer-events:\s*none/su);
    expect(css).toMatch(/\.smart-counter-item\s*\{[^}]*pointer-events:\s*auto/su);
  });

  it("wakes on forwarded mousemove, ignores motion below 4px, then drags and releases immediately", () => {
    const api = installDragApi();
    render(<SmartCounterOverlay counters={[{
      id: "friendly-dragons",
      label: "已使用龙牌",
      value: 2,
      target: 5
    }]} />);
    const counter = screen.getByLabelText("已使用龙牌 2/5");

    fireEvent.mouseMove(counter, { screenX: 100, screenY: 200 });
    dispatchPointer(counter, "pointerdown", { pointerId: 4, button: 0, screenX: 100, screenY: 200 });
    dispatchPointer(counter, "pointermove", { pointerId: 4, buttons: 1, screenX: 102, screenY: 202 });
    dispatchPointer(counter, "pointermove", { pointerId: 4, buttons: 1, screenX: 120, screenY: 224 });
    dispatchPointer(counter, "pointerup", { pointerId: 4, button: 0, screenX: 120, screenY: 224 });

    expect(api.setAuxiliaryOverlayMouseInteractive).toHaveBeenNthCalledWith(1, true);
    expect(api.beginAuxiliaryOverlayDrag).toHaveBeenCalledWith({ x: 100, y: 200 });
    expect(api.moveAuxiliaryOverlayDrag).toHaveBeenCalledTimes(1);
    expect(api.moveAuxiliaryOverlayDrag).toHaveBeenLastCalledWith({ x: 120, y: 224 });
    expect(api.endAuxiliaryOverlayDrag).toHaveBeenCalledWith({ x: 120, y: 224 });
    expect(api.setAuxiliaryOverlayMouseInteractive).toHaveBeenLastCalledWith(false);
  });

  it("keeps counter drag state independent and treats a short press as stationary", () => {
    const api = installDragApi();
    render(<SmartCounterOverlay counters={[
      { id: "first", label: "第一个", value: 1 },
      { id: "second", label: "第二个", value: 2 }
    ]} />);
    const first = screen.getByLabelText("第一个 1");
    const second = screen.getByLabelText("第二个 2");

    dispatchPointer(first, "pointerdown", { pointerId: 1, button: 0, screenX: 10, screenY: 10 });
    dispatchPointer(first, "pointermove", { pointerId: 1, buttons: 1, screenX: 11, screenY: 12 });
    dispatchPointer(first, "pointerup", { pointerId: 1, button: 0, screenX: 11, screenY: 12 });
    dispatchPointer(second, "pointerdown", { pointerId: 2, button: 0, screenX: 30, screenY: 30 });
    dispatchPointer(second, "pointermove", { pointerId: 2, buttons: 1, screenX: 40, screenY: 45 });
    dispatchPointer(second, "pointerup", { pointerId: 2, button: 0, screenX: 40, screenY: 45 });

    expect(api.beginAuxiliaryOverlayDrag).toHaveBeenNthCalledWith(1, { x: 10, y: 10 });
    expect(api.beginAuxiliaryOverlayDrag).toHaveBeenNthCalledWith(2, { x: 30, y: 30 });
    expect(api.moveAuxiliaryOverlayDrag).toHaveBeenCalledTimes(1);
    expect(api.moveAuxiliaryOverlayDrag).toHaveBeenCalledWith({ x: 40, y: 45 });
    expect(api.endAuxiliaryOverlayDrag).toHaveBeenNthCalledWith(1, { x: 10, y: 10 });
    expect(api.endAuxiliaryOverlayDrag).toHaveBeenNthCalledWith(2, { x: 40, y: 45 });
  });

  it.each(["pointercancel", "lostpointercapture"] as const)(
    "ends on %s and restores pass-through",
    (finishType) => {
      const api = installDragApi();
      render(<SmartCounterOverlay counters={[{ id: "revived", label: "复活", value: 3 }]} />);
      const counter = screen.getByLabelText("复活 3");

      fireEvent.mouseMove(counter);
      dispatchPointer(counter, "pointerdown", { pointerId: 7, button: 0, screenX: 60, screenY: 70 });
      dispatchPointer(counter, "pointermove", { pointerId: 7, buttons: 1, screenX: 80, screenY: 95 });
      dispatchPointer(counter, finishType, { pointerId: 7, screenX: 80, screenY: 95 });

      expect(api.endAuxiliaryOverlayDrag).toHaveBeenCalledWith({ x: 80, y: 95 });
      expect(api.setAuxiliaryOverlayMouseInteractive).toHaveBeenLastCalledWith(false);
    }
  );

  it("retries restoring pass-through after a transient IPC failure", async () => {
    vi.useFakeTimers();
    const api = installDragApi();
    api.setAuxiliaryOverlayMouseInteractive
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("temporary IPC failure"))
      .mockResolvedValue(undefined);
    render(<SmartCounterOverlay counters={[{ id: "revived", label: "复活", value: 3 }]} />);
    const counter = screen.getByLabelText("复活 3");

    fireEvent.mouseMove(counter);
    await Promise.resolve();
    fireEvent.mouseLeave(counter);
    await Promise.resolve();
    await vi.runAllTimersAsync();

    expect(api.setAuxiliaryOverlayMouseInteractive).toHaveBeenNthCalledWith(1, true);
    expect(api.setAuxiliaryOverlayMouseInteractive).toHaveBeenNthCalledWith(2, false);
    expect(api.setAuxiliaryOverlayMouseInteractive).toHaveBeenNthCalledWith(3, false);
  });

  it("cancels a pending pass-through retry when the pointer re-enters", async () => {
    vi.useFakeTimers();
    const api = installDragApi();
    api.setAuxiliaryOverlayMouseInteractive
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("temporary IPC failure"))
      .mockResolvedValue(undefined);
    render(<SmartCounterOverlay counters={[{ id: "revived", label: "复活", value: 3 }]} />);
    const counter = screen.getByLabelText("复活 3");

    fireEvent.mouseMove(counter);
    await Promise.resolve();
    fireEvent.mouseLeave(counter);
    await Promise.resolve();
    await Promise.resolve();
    fireEvent.mouseMove(counter);
    await vi.runAllTimersAsync();

    expect(api.setAuxiliaryOverlayMouseInteractive).toHaveBeenCalledTimes(2);
    expect(api.setAuxiliaryOverlayMouseInteractive).toHaveBeenNthCalledWith(1, true);
    expect(api.setAuxiliaryOverlayMouseInteractive).toHaveBeenNthCalledWith(2, false);
  });

  it("keeps retrying pass-through until a later IPC request succeeds", async () => {
    vi.useFakeTimers();
    const api = installDragApi();
    api.setAuxiliaryOverlayMouseInteractive
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("failure 1"))
      .mockRejectedValueOnce(new Error("failure 2"))
      .mockRejectedValueOnce(new Error("failure 3"))
      .mockRejectedValueOnce(new Error("failure 4"))
      .mockResolvedValue(undefined);
    render(<SmartCounterOverlay counters={[{ id: "revived", label: "复活", value: 3 }]} />);
    const counter = screen.getByLabelText("复活 3");

    fireEvent.mouseMove(counter);
    await Promise.resolve();
    fireEvent.mouseLeave(counter);
    await Promise.resolve();
    await vi.runAllTimersAsync();

    expect(api.setAuxiliaryOverlayMouseInteractive).toHaveBeenCalledTimes(6);
    for (let call = 2; call <= 6; call += 1) {
      expect(api.setAuxiliaryOverlayMouseInteractive).toHaveBeenNthCalledWith(call, false);
    }
  });

  it("still retries when pointerleave and mouseleave request the same pass-through state", async () => {
    vi.useFakeTimers();
    const api = installDragApi();
    api.setAuxiliaryOverlayMouseInteractive
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("temporary IPC failure"))
      .mockResolvedValue(undefined);
    render(<SmartCounterOverlay counters={[{ id: "revived", label: "复活", value: 3 }]} />);
    const counter = screen.getByLabelText("复活 3");

    fireEvent.mouseMove(counter);
    await Promise.resolve();
    fireEvent.pointerLeave(counter);
    fireEvent.mouseLeave(counter);
    await Promise.resolve();
    await vi.runAllTimersAsync();

    expect(api.setAuxiliaryOverlayMouseInteractive).toHaveBeenCalledTimes(3);
    expect(api.setAuxiliaryOverlayMouseInteractive).toHaveBeenNthCalledWith(2, false);
    expect(api.setAuxiliaryOverlayMouseInteractive).toHaveBeenNthCalledWith(3, false);
  });

  it("does not start another retry after the overlay unmounts with an IPC request pending", async () => {
    vi.useFakeTimers();
    let rejectPassThrough: ((reason?: unknown) => void) | undefined;
    const api = installDragApi();
    api.setAuxiliaryOverlayMouseInteractive
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => new Promise<undefined>((_resolve, reject) => {
        rejectPassThrough = reject;
      }));
    const { unmount } = render(
      <SmartCounterOverlay counters={[{ id: "revived", label: "复活", value: 3 }]} />
    );
    const counter = screen.getByLabelText("复活 3");

    fireEvent.mouseMove(counter);
    await Promise.resolve();
    fireEvent.mouseLeave(counter);
    unmount();
    rejectPassThrough?.(new Error("renderer closed"));
    await Promise.resolve();
    await Promise.resolve();
    await vi.runAllTimersAsync();

    expect(api.setAuxiliaryOverlayMouseInteractive).toHaveBeenCalledTimes(2);
  });
});
