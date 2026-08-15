import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecretOverlay } from "../src/renderer/components/SecretOverlay";

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
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  init: MouseEventInit & { readonly pointerId: number }
) {
  const event = new MouseEvent(type, { bubbles: true, ...init });
  Object.defineProperty(event, "pointerId", { value: init.pointerId });
  fireEvent(target, event);
}

describe("SecretOverlay title controls", () => {
  it("fills the collapsed 44-by-44 window with one clickable drag target", () => {
    const css = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/renderer/secretOverlayStyles.css"),
      "utf8"
    );

    expect(css).toMatch(
      /\.secret-overlay-shell--collapsed\s+\.secret-overlay-badge\s*\{[^}]*width:\s*44px[^}]*height:\s*44px[^}]*min-height:\s*44px[^}]*border-radius:\s*0/su
    );
    expect(css).toMatch(
      /\.secret-overlay-badge-face\s*\{[^}]*width:\s*24px[^}]*height:\s*24px/su
    );
  });

  it("lets the title control cover the full visible header", () => {
    const css = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/renderer/secretOverlayStyles.css"),
      "utf8"
    );

    expect(css).toMatch(
      /\.secret-overlay-header\s*\{[^}]*padding:\s*0;/su
    );
    expect(css).toMatch(
      /\.secret-overlay-title-control\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*padding:\s*0 4px/su
    );
  });

  it("collapses when the visible title is clicked", () => {
    const onCollapsedChange = vi.fn();
    render(<SecretOverlay slots={[]} onCollapsedChange={onCollapsedChange} />);

    fireEvent.click(screen.getByRole("button", { name: "收起或拖动奥秘助手" }));

    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it("activates from a forwarded mouse move, accepts the next click, then restores pass-through", () => {
    const calls: string[] = [];
    const setAuxiliaryOverlayMouseInteractive = vi.fn(async (interactive: boolean) => {
      calls.push(`interactive:${interactive}`);
    });
    const onCollapsedChange = vi.fn((collapsed: boolean) => {
      calls.push(`collapse:${collapsed}`);
    });
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: { setAuxiliaryOverlayMouseInteractive }
    });

    render(<SecretOverlay slots={[]} onCollapsedChange={onCollapsedChange} />);
    const title = screen.getByRole("button", { name: "收起或拖动奥秘助手" });

    fireEvent.mouseMove(title, { screenX: 240, screenY: 120 });
    fireEvent.click(title);

    expect(calls).toEqual(["interactive:true", "collapse:true", "interactive:false"]);
  });

  it("retries activation after a transient forwarded-mouse IPC failure", async () => {
    const setAuxiliaryOverlayMouseInteractive = vi.fn()
      .mockRejectedValueOnce(new Error("temporary IPC failure"))
      .mockResolvedValue(undefined);
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: { setAuxiliaryOverlayMouseInteractive }
    });

    render(<SecretOverlay slots={[]} />);
    const title = screen.getByRole("button", { name: "收起或拖动奥秘助手" });

    fireEvent.mouseMove(title);
    await Promise.resolve();
    await Promise.resolve();
    fireEvent.mouseMove(title);

    expect(setAuxiliaryOverlayMouseInteractive).toHaveBeenNthCalledWith(1, true);
    expect(setAuxiliaryOverlayMouseInteractive).toHaveBeenNthCalledWith(2, true);
  });

  it("retries restoring pass-through when the first IPC request fails", async () => {
    vi.useFakeTimers();
    const setAuxiliaryOverlayMouseInteractive = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("temporary IPC failure"))
      .mockResolvedValue(undefined);
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: { setAuxiliaryOverlayMouseInteractive }
    });

    render(<SecretOverlay slots={[]} />);
    const title = screen.getByRole("button", { name: "收起或拖动奥秘助手" });

    fireEvent.mouseMove(title);
    await Promise.resolve();
    fireEvent.mouseLeave(title);
    await Promise.resolve();
    await vi.runAllTimersAsync();

    expect(setAuxiliaryOverlayMouseInteractive).toHaveBeenNthCalledWith(1, true);
    expect(setAuxiliaryOverlayMouseInteractive).toHaveBeenNthCalledWith(2, false);
    expect(setAuxiliaryOverlayMouseInteractive).toHaveBeenNthCalledWith(3, false);
  });

  it("hands a title drag to the desktop window without collapsing", () => {
    const setAuxiliaryOverlayMouseInteractive = vi.fn(async () => undefined);
    const beginAuxiliaryOverlayDrag = vi.fn(async () => undefined);
    const moveAuxiliaryOverlayDrag = vi.fn(async () => undefined);
    const endAuxiliaryOverlayDrag = vi.fn(async () => undefined);
    const onCollapsedChange = vi.fn();
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: {
        setAuxiliaryOverlayMouseInteractive,
        beginAuxiliaryOverlayDrag,
        moveAuxiliaryOverlayDrag,
        endAuxiliaryOverlayDrag
      }
    });

    render(<SecretOverlay slots={[]} onCollapsedChange={onCollapsedChange} />);
    const title = screen.getByRole("button", { name: "收起或拖动奥秘助手" });

    fireEvent.mouseMove(title, { screenX: 310, screenY: 140 });
    fireEvent.pointerEnter(title, { pointerId: 7, screenX: 310, screenY: 140 });
    dispatchPointer(title, "pointerdown", { pointerId: 7, button: 0, screenX: 310, screenY: 140 });
    dispatchPointer(title, "pointermove", { pointerId: 7, buttons: 1, screenX: 344, screenY: 176 });
    dispatchPointer(title, "pointerup", { pointerId: 7, button: 0, screenX: 344, screenY: 176 });
    fireEvent.click(title);
    fireEvent.pointerLeave(title, { pointerId: 7, screenX: 344, screenY: 176 });

    expect(setAuxiliaryOverlayMouseInteractive).toHaveBeenNthCalledWith(1, true);
    expect(beginAuxiliaryOverlayDrag).toHaveBeenCalledWith({ x: 310, y: 140 });
    expect(moveAuxiliaryOverlayDrag).toHaveBeenCalledWith({ x: 344, y: 176 });
    expect(endAuxiliaryOverlayDrag).toHaveBeenCalledWith({ x: 344, y: 176 });
    expect(onCollapsedChange).not.toHaveBeenCalled();
    expect(setAuxiliaryOverlayMouseInteractive).toHaveBeenLastCalledWith(false);
  });

  it("moves the collapsed window from the question badge without expanding it", () => {
    const setAuxiliaryOverlayMouseInteractive = vi.fn(async () => undefined);
    const beginAuxiliaryOverlayDrag = vi.fn(async () => undefined);
    const moveAuxiliaryOverlayDrag = vi.fn(async () => undefined);
    const endAuxiliaryOverlayDrag = vi.fn(async () => undefined);
    const onCollapsedChange = vi.fn();
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: {
        setAuxiliaryOverlayMouseInteractive,
        beginAuxiliaryOverlayDrag,
        moveAuxiliaryOverlayDrag,
        endAuxiliaryOverlayDrag
      }
    });

    render(<SecretOverlay slots={[]} isCollapsed onCollapsedChange={onCollapsedChange} />);
    const badge = screen.getByRole("button", { name: "展开奥秘助手" });

    fireEvent.mouseMove(badge, { screenX: 80, screenY: 95 });
    dispatchPointer(badge, "pointerdown", { pointerId: 9, button: 0, screenX: 80, screenY: 95 });
    dispatchPointer(badge, "pointermove", { pointerId: 9, buttons: 1, screenX: 112, screenY: 121 });
    dispatchPointer(badge, "pointerup", { pointerId: 9, button: 0, screenX: 112, screenY: 121 });
    fireEvent.click(badge);

    expect(beginAuxiliaryOverlayDrag).toHaveBeenCalledWith({ x: 80, y: 95 });
    expect(moveAuxiliaryOverlayDrag).toHaveBeenCalledWith({ x: 112, y: 121 });
    expect(endAuxiliaryOverlayDrag).toHaveBeenCalledWith({ x: 112, y: 121 });
    expect(onCollapsedChange).not.toHaveBeenCalled();
    expect(setAuxiliaryOverlayMouseInteractive).toHaveBeenLastCalledWith(false);
  });

  it("keeps a short title press as a collapse click below the drag threshold", () => {
    const setAuxiliaryOverlayMouseInteractive = vi.fn(async () => undefined);
    const beginAuxiliaryOverlayDrag = vi.fn(async () => undefined);
    const moveAuxiliaryOverlayDrag = vi.fn(async () => undefined);
    const endAuxiliaryOverlayDrag = vi.fn(async () => undefined);
    const onCollapsedChange = vi.fn();
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: {
        setAuxiliaryOverlayMouseInteractive,
        beginAuxiliaryOverlayDrag,
        moveAuxiliaryOverlayDrag,
        endAuxiliaryOverlayDrag
      }
    });

    render(<SecretOverlay slots={[]} onCollapsedChange={onCollapsedChange} />);
    const title = screen.getByRole("button", { name: "收起或拖动奥秘助手" });

    fireEvent.mouseMove(title, { screenX: 200, screenY: 100 });
    dispatchPointer(title, "pointerdown", { pointerId: 3, button: 0, screenX: 200, screenY: 100 });
    dispatchPointer(title, "pointermove", { pointerId: 3, buttons: 1, screenX: 202, screenY: 102 });
    dispatchPointer(title, "pointerup", { pointerId: 3, button: 0, screenX: 202, screenY: 102 });
    fireEvent.click(title);
    fireEvent.pointerLeave(title, { pointerId: 3, screenX: 202, screenY: 102 });

    expect(moveAuxiliaryOverlayDrag).not.toHaveBeenCalled();
    expect(endAuxiliaryOverlayDrag).toHaveBeenCalledWith({ x: 200, y: 100 });
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    expect(setAuxiliaryOverlayMouseInteractive).toHaveBeenLastCalledWith(false);
  });

  it("ends a cancelled drag and restores mouse pass-through", () => {
    const setAuxiliaryOverlayMouseInteractive = vi.fn(async () => undefined);
    const beginAuxiliaryOverlayDrag = vi.fn(async () => undefined);
    const moveAuxiliaryOverlayDrag = vi.fn(async () => undefined);
    const endAuxiliaryOverlayDrag = vi.fn(async () => undefined);
    const onCollapsedChange = vi.fn();
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: {
        setAuxiliaryOverlayMouseInteractive,
        beginAuxiliaryOverlayDrag,
        moveAuxiliaryOverlayDrag,
        endAuxiliaryOverlayDrag
      }
    });

    render(<SecretOverlay slots={[]} onCollapsedChange={onCollapsedChange} />);
    const title = screen.getByRole("button", { name: "收起或拖动奥秘助手" });

    fireEvent.mouseMove(title, { screenX: 50, screenY: 60 });
    dispatchPointer(title, "pointerdown", { pointerId: 5, button: 0, screenX: 50, screenY: 60 });
    dispatchPointer(title, "pointermove", { pointerId: 5, buttons: 1, screenX: 70, screenY: 75 });
    dispatchPointer(title, "pointercancel", { pointerId: 5, screenX: 70, screenY: 75 });

    expect(endAuxiliaryOverlayDrag).toHaveBeenCalledWith({ x: 70, y: 75 });
    expect(onCollapsedChange).not.toHaveBeenCalled();
    expect(setAuxiliaryOverlayMouseInteractive).toHaveBeenLastCalledWith(false);
  });
});
