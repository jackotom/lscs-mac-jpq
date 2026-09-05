import { describe, expect, it, vi } from "vitest";
import { OpponentOverlayWindowController } from "../src/main/opponentOverlayWindowController";
import { OpponentOverlayWindowState } from "../src/main/opponentOverlayWindowState";

describe("opponent overlay window controller", () => {
  it("collapses, preserves the expanded bounds, then publishes the new state", async () => {
    const calls: string[] = [];
    const state = new OpponentOverlayWindowState({ x: 20, y: 30, width: 250, height: 170 });
    const webContents = {
      send: vi.fn((_channel: string, collapsed: boolean) => {
        calls.push(`send:${collapsed}:${state.isCollapsed()}`);
      })
    };
    const window = {
      webContents,
      isDestroyed: () => false,
      getBounds: () => ({ x: 40, y: 50, width: 260, height: 180 }),
      setResizable: (value: boolean) => calls.push(`resizable:${value}`),
      setMinimumSize: (width: number, height: number) => calls.push(`minimum:${width}x${height}`),
      setBounds: (bounds: { width: number; height: number }) => calls.push(`bounds:${bounds.width}x${bounds.height}`),
      showInactive: () => calls.push("showInactive"),
      show: vi.fn(),
      focus: vi.fn()
    };
    const saveExpandedBounds = vi.fn(async () => {
      calls.push("save");
    });
    const controller = new OpponentOverlayWindowController({
      getWindow: () => window,
      getState: () => state,
      saveExpandedBounds
    });

    await expect(controller.collapse()).resolves.toBe(true);

    expect(saveExpandedBounds).toHaveBeenCalledWith({ x: 40, y: 50, width: 260, height: 180 });
    expect(calls).toEqual([
      "save",
      "resizable:false",
      "minimum:52x38",
      "bounds:52x38",
      "send:true:true",
      "showInactive"
    ]);
  });

  it("restores from the main-window entry and publishes before focusing", async () => {
    const calls: string[] = [];
    const state = new OpponentOverlayWindowState({ x: 40, y: 50, width: 260, height: 180 });
    state.collapse();
    const webContents = {
      send: vi.fn((_channel: string, collapsed: boolean) => {
        calls.push(`send:${collapsed}:${state.isCollapsed()}`);
      })
    };
    const window = {
      webContents,
      isDestroyed: () => false,
      getBounds: () => ({ x: 40, y: 50, width: 52, height: 38 }),
      setResizable: (value: boolean) => calls.push(`resizable:${value}`),
      setMinimumSize: (width: number, height: number) => calls.push(`minimum:${width}x${height}`),
      setBounds: (bounds: { width: number; height: number }) => calls.push(`bounds:${bounds.width}x${bounds.height}`),
      showInactive: () => calls.push("showInactive"),
      show: () => calls.push("show"),
      focus: () => calls.push("focus")
    };
    const controller = new OpponentOverlayWindowController({
      getWindow: () => window,
      getState: () => state,
      saveExpandedBounds: vi.fn(async () => undefined)
    });

    await expect(controller.expand(true)).resolves.toBe(false);

    expect(calls).toEqual([
      "bounds:260x180",
      "minimum:100x150",
      "resizable:true",
      "send:false:false",
      "show",
      "focus"
    ]);
    expect(controller.isOpponentOverlaySender(webContents)).toBe(true);
    expect(controller.isOpponentOverlaySender({})).toBe(false);
  });

  it("applies folded bounds when a restored state is already collapsed", async () => {
    const state = OpponentOverlayWindowState.fromPersisted({
      x: 40, y: 50, width: 260, height: 180, collapsed: true
    });
    const window = {
      webContents: { send: vi.fn() },
      isDestroyed: () => false,
      getBounds: () => ({ x: 40, y: 50, width: 260, height: 180 }),
      setResizable: vi.fn(),
      setMinimumSize: vi.fn(),
      setBounds: vi.fn(),
      showInactive: vi.fn(),
      show: vi.fn(),
      focus: vi.fn()
    };
    const controller = new OpponentOverlayWindowController({
      getWindow: () => window,
      getState: () => state,
      saveExpandedBounds: vi.fn(async () => undefined)
    });

    await expect(controller.collapse()).resolves.toBe(true);

    expect(window.setMinimumSize).toHaveBeenCalledWith(52, 38);
    expect(window.setBounds).toHaveBeenCalledWith({ x: 40, y: 50, width: 52, height: 38 }, false);
  });

  it("keeps the newest expand intent when an earlier collapse is still saving", async () => {
    let finishCollapseSave: (() => void) | undefined;
    const collapseSave = new Promise<void>((resolve) => {
      finishCollapseSave = resolve;
    });
    const state = new OpponentOverlayWindowState({ x: 40, y: 50, width: 260, height: 180 });
    const window = {
      webContents: { send: vi.fn() },
      isDestroyed: () => false,
      getBounds: () => ({ x: 40, y: 50, width: 260, height: 180 }),
      setResizable: vi.fn(),
      setMinimumSize: vi.fn(),
      setBounds: vi.fn(),
      showInactive: vi.fn(),
      show: vi.fn(),
      focus: vi.fn()
    };
    const saveExpandedBounds = vi.fn()
      .mockImplementationOnce(async () => collapseSave)
      .mockResolvedValue(undefined);
    const controller = new OpponentOverlayWindowController({
      getWindow: () => window,
      getState: () => state,
      saveExpandedBounds
    });

    const collapsing = controller.collapse();
    const expanding = controller.expand(false);
    finishCollapseSave?.();
    await Promise.all([collapsing, expanding]);

    expect(state.isCollapsed()).toBe(false);
    expect(window.setBounds).toHaveBeenLastCalledWith({ x: 40, y: 50, width: 260, height: 180 }, false);
    expect(window.setResizable).toHaveBeenLastCalledWith(true);
  });

  it("shows a collapsed entry without expanding it when data changes", () => {
    const state = new OpponentOverlayWindowState({ x: 40, y: 50, width: 260, height: 180 });
    state.collapse();
    const window = {
      webContents: { send: vi.fn() },
      isDestroyed: () => false,
      getBounds: vi.fn(() => ({ x: 40, y: 50, width: 52, height: 38 })),
      setResizable: vi.fn(),
      setMinimumSize: vi.fn(),
      setBounds: vi.fn(),
      showInactive: vi.fn(),
      show: vi.fn(),
      focus: vi.fn()
    };
    const controller = new OpponentOverlayWindowController({
      getWindow: () => window,
      getState: () => state,
      saveExpandedBounds: vi.fn(async () => undefined)
    });

    expect(controller.showInactive()).toBe(true);

    expect(state.isCollapsed()).toBe(true);
    expect(window.setBounds).not.toHaveBeenCalled();
    expect(window.showInactive).toHaveBeenCalledOnce();
    expect(window.show).not.toHaveBeenCalled();
    expect(window.focus).not.toHaveBeenCalled();
  });
});
