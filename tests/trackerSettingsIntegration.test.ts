import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const source = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

describe("tracker settings IPC", () => {
  it("registers trusted read, replacement, and open-settings actions", () => {
    const main = source("src/main/main.ts");

    expect(main).toContain('secureHandle("tracker:get-settings"');
    expect(main).toContain('secureHandle("tracker:replace-settings"');
    expect(main).toContain('secureHandle("tracker:open-settings"');
    expect(main).toContain('mainWindow.webContents.send("tracker:open-settings")');
    expect(main).toContain('secureHandle("tracker:restore-default-settings"');
    expect(main).toContain('secureHandle("tracker:open-log-folder"');
    expect(main).toContain('secureHandle("tracker:refresh-card-database"');
  });

  it("exposes settings only through the main and overlay preload capabilities", () => {
    const preload = source("src/main/preload.cts");

    expect(preload).toContain('ipcRenderer.invoke("tracker:get-settings")');
    expect(preload).toContain('ipcRenderer.invoke("tracker:replace-settings"');
    expect(preload).toContain('ipcRenderer.invoke("tracker:open-settings")');
    expect(preload).toContain('ipcRenderer.invoke("tracker:restore-default-settings")');
    expect(preload).toContain('ipcRenderer.invoke("tracker:open-log-folder")');
    expect(preload).toContain('ipcRenderer.invoke("tracker:refresh-card-database")');
    expect(preload).toContain('ipcRenderer.on("tracker:settings:update"');
    expect(preload).toContain("openSettings: mainApi.openSettings");
    expect(preload).toContain('ipcRenderer.on("tracker:open-settings"');
    expect(preload.match(/getTrackerSettings:/g)).toHaveLength(1);
    expect(preload.match(/setTrackerSettings:/g)).toHaveLength(1);
  });

  it("applies persisted settings to real Electron behavior", () => {
    const main = source("src/main/main.ts");

    expect(main).toContain("applyLaunchAtLoginSetting");
    expect(source("src/main/launchAtLogin.ts")).toContain("host.getLoginItemSettings()");
    expect(main).toContain("nativeImage.createFromNamedImage");
    expect(main).toContain("new Tray(");
    expect(main).toContain('label: "打开主界面"');
    expect(main).toContain('label: "打开设置"');
    expect(main).toContain('label: "退出"');
    expect(main).toContain("window.setOpacity");
    expect(main).toContain("configureOverlayWorkspaceWindow(window, !trackerSettings.overlay.hideInFullscreen)");
    expect(main).toContain("getAnchoredOverlayWindowBounds");
    expect(main).toContain("applyConfiguredOverlayPositions");
    expect(main.match(/applyConfiguredOverlayPositions\(\);/g)).toHaveLength(1);
    expect(main).toContain('isDeckTrackerEnabled("opponentDeckTracker") && trackerSettings.overlay.secretPrediction');
    expect(main).toContain("trackerSettings.overlay.showFriendlyAttack || trackerSettings.overlay.showOpponentAttack");
    expect(main).toContain('mainWindow.webContents.send("tracker:settings:update", trackerSettings)');
    expect(main).toContain("return isDeckTrackerEnabled(setting)");
    expect(main).toContain('if (!isDeckTrackerEnabled("opponentDeckTracker")) return;');
    expect(main).toContain("trackerSettings.general.minimizeToMenuBar");
    expect(main).toContain("trackerSettings.general.startMinimized");
    expect(main).not.toContain("mainWindow.setAlwaysOnTop");
    expect(main).not.toContain("trackerSettings.general.alwaysOnTop");
    expect(main).toMatch(
      /const focusWhenReady = options\.focusWhenReady \?\? trackerSettings\.general\.focusOnOpen/
    );
    expect(main).toContain("presentMainWindow(window, focusWhenReady");
    expect(main).not.toContain("createWindow({ showWhenReady: true, focusWhenReady: true })");
    expect(main).toMatch(
      /presentMainWindow\(\s*mainWindow,\s*trackerSettings\.general\.focusOnOpen/
    );
    expect(main).toContain(
      "const launchAtLoginChanged = candidate.general.launchAtLogin !== previous.general.launchAtLogin"
    );
    expect(main).toContain("if (launchAtLoginChanged) {");
    expect(main.indexOf("applyLaunchAtLoginSetting(app, candidate.general.launchAtLogin)"))
      .toBeLessThan(main.indexOf("trackerSettingsStore.replace(value)"));
  });

  it("rolls back the system login item when settings persistence fails", () => {
    const main = source("src/main/main.ts");
    const replaceSection = main.slice(
      main.indexOf('secureHandle("tracker:replace-settings"'),
      main.indexOf('secureHandle("tracker:restore-default-settings"')
    );

    expect(replaceSection).toMatch(
      /trackerSettingsStore\.replace\(value\)[\s\S]*?catch \(error\)[\s\S]*?applyLaunchAtLoginSetting\(app, previous\.general\.launchAtLogin\)/
    );
    expect(replaceSection).toContain('reportDiagnosticError("恢复开机启动设置失败"');
  });
});
