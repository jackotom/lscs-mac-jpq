import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

function source(relativePath: string): string {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function functionSource(contents: string, name: string, nextName: string): string {
  const start = contents.indexOf(`function ${name}`);
  const end = contents.indexOf(`function ${nextName}`, start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return contents.slice(start, end);
}

describe("app permission integration", () => {
  it("checks screen recording access before either automatic desktop capture path", () => {
    const main = source("src/main/main.ts");
    const capture = functionSource(main, "captureHearthstoneDisplay", "isAnyInteractiveOverlayFocused");
    const display = functionSource(main, "resolveHearthstoneDisplay", "getMovableAuxiliaryOverlayWindow");

    expect(capture.indexOf("isScreenCaptureGranted()")).toBeGreaterThanOrEqual(0);
    expect(capture.indexOf("isScreenCaptureGranted()")).toBeLessThan(capture.indexOf("desktopCapturer.getSources"));
    expect(display.indexOf("isScreenCaptureGranted()")).toBeGreaterThanOrEqual(0);
    expect(display.indexOf("isScreenCaptureGranted()")).toBeLessThan(display.indexOf("desktopCapturer.getSources"));
    expect(capture).not.toContain("shell.openExternal");
  });

  it("limits permission IPC to the main window and a fixed permission id", () => {
    const main = source("src/main/main.ts");

    expect(main).toContain('secureHandle("tracker:get-permissions"');
    expect(main).toContain('secureHandle("tracker:request-permission"');
    expect(main).toContain("event.sender !== mainWindow.webContents");
    expect(main).toContain('permissionId !== "screen-recording"');
  });

  it("exposes permission actions only through the main preload capability", () => {
    const preload = source("src/main/preload.cts");
    const settingsStart = preload.indexOf("const settingsApi =");
    const settingsEnd = preload.indexOf("const arenaHeroRankingApi", settingsStart);
    const mainStart = preload.indexOf("const mainApi =");
    const mainEnd = preload.indexOf("const capability =", mainStart);
    const settingsApi = preload.slice(settingsStart, settingsEnd);
    const mainApi = preload.slice(mainStart, mainEnd);

    expect(settingsApi).not.toContain("tracker:get-permissions");
    expect(settingsApi).not.toContain("tracker:request-permission");
    expect(mainApi).toContain("getAppPermissions:");
    expect(mainApi).toContain("requestAppPermission:");
    expect(mainApi).toContain('ipcRenderer.invoke("tracker:get-permissions")');
    expect(mainApi).toContain('ipcRenderer.invoke("tracker:request-permission"');
  });
});
