import { describe, expect, it, vi } from "vitest";
import {
  configureOverlayWorkspaceWindow,
  getOverlayWindowPlatformOptions
} from "../src/main/overlayWindowWorkspace";

describe("overlay workspace windows", () => {
  it("uses a non-activating macOS panel so showing an overlay cannot pull the main window out of fullscreen", () => {
    expect(getOverlayWindowPlatformOptions("darwin")).toEqual({ type: "panel" });
    expect(getOverlayWindowPlatformOptions("win32")).toEqual({});
  });

  it("avoids the macOS process-type transition and reapplies only when fullscreen visibility changes", () => {
    const setVisibleOnAllWorkspaces = vi.fn();
    const window = { setVisibleOnAllWorkspaces };

    expect(configureOverlayWorkspaceWindow(window, true)).toBe(true);
    expect(configureOverlayWorkspaceWindow(window, true)).toBe(false);
    expect(configureOverlayWorkspaceWindow(window, false)).toBe(true);

    expect(setVisibleOnAllWorkspaces).toHaveBeenCalledTimes(2);
    expect(setVisibleOnAllWorkspaces).toHaveBeenNthCalledWith(1, true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true
    });
    expect(setVisibleOnAllWorkspaces).toHaveBeenNthCalledWith(2, true, {
      visibleOnFullScreen: false,
      skipTransformProcessType: true
    });
  });
});
