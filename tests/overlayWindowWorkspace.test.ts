import { describe, expect, it, vi } from "vitest";
import {
  configureOverlayWorkspaceWindow,
  getOverlayWindowPlatformOptions,
  reassertOverlayWindowPresentation
} from "../src/main/overlayWindowWorkspace";

describe("overlay workspace windows", () => {
  it("uses a non-activating macOS panel so showing an overlay cannot pull the main window out of fullscreen", () => {
    expect(getOverlayWindowPlatformOptions("darwin")).toEqual({ type: "panel" });
    expect(getOverlayWindowPlatformOptions("win32")).toEqual({});
  });

  it("keeps the required process-type transition enabled for a foreground production app", () => {
    const setVisibleOnAllWorkspaces = vi.fn();
    const window = { setVisibleOnAllWorkspaces };

    expect(configureOverlayWorkspaceWindow(window, true, false)).toBe(true);
    expect(configureOverlayWorkspaceWindow(window, true, false)).toBe(false);
    expect(configureOverlayWorkspaceWindow(window, false, false)).toBe(true);

    expect(setVisibleOnAllWorkspaces).toHaveBeenCalledTimes(2);
    expect(setVisibleOnAllWorkspaces).toHaveBeenNthCalledWith(1, true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: false
    });
    expect(setVisibleOnAllWorkspaces).toHaveBeenNthCalledWith(2, true, {
      visibleOnFullScreen: false,
      skipTransformProcessType: false
    });
  });

  it("reapplies with transform skipping only after the app is already accessory", () => {
    const setVisibleOnAllWorkspaces = vi.fn();
    const window = { setVisibleOnAllWorkspaces };

    expect(configureOverlayWorkspaceWindow(window, true, false)).toBe(true);
    expect(configureOverlayWorkspaceWindow(window, true, true)).toBe(true);
    expect(configureOverlayWorkspaceWindow(window, true, true)).toBe(false);

    expect(setVisibleOnAllWorkspaces).toHaveBeenNthCalledWith(1, true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: false
    });
    expect(setVisibleOnAllWorkspaces).toHaveBeenNthCalledWith(2, true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true
    });
  });

  it("reasserts workspace and screen-saver level before an inactive presentation", () => {
    const setVisibleOnAllWorkspaces = vi.fn();
    const setAlwaysOnTop = vi.fn();
    const showInactive = vi.fn();
    const focus = vi.fn();
    const window = { setVisibleOnAllWorkspaces, setAlwaysOnTop, showInactive, focus };

    reassertOverlayWindowPresentation(window, true, false);

    expect(setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: false
    });
    expect(setAlwaysOnTop).toHaveBeenCalledWith(true, "screen-saver");
    expect(showInactive).toHaveBeenCalledOnce();
    expect(focus).not.toHaveBeenCalled();
    expect(setVisibleOnAllWorkspaces.mock.invocationCallOrder[0]).toBeLessThan(
      showInactive.mock.invocationCallOrder[0]
    );
    expect(setAlwaysOnTop.mock.invocationCallOrder[0]).toBeLessThan(
      showInactive.mock.invocationCallOrder[0]
    );
  });
});
