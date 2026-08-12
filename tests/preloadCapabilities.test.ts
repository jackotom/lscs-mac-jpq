import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

function loadPreloadApi() {
  const exposeInMainWorld = vi.fn();
  const invoke = vi.fn(async () => undefined);
  const source = readFileSync(path.resolve(import.meta.dirname, "../src/main/preload.cts"), "utf8");
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 }
  }).outputText;
  const electron = {
    contextBridge: { exposeInMainWorld },
    ipcRenderer: {
      invoke,
      on: vi.fn(),
      removeListener: vi.fn()
    }
  };
  const localRequire = (specifier: string) => {
    if (specifier === "electron") return electron;
    throw new Error(`Unexpected preload dependency: ${specifier}`);
  };
  const module = { exports: {} };

  Function("require", "module", "exports", compiled)(localRequire, module, module.exports);

  return {
    api: exposeInMainWorld.mock.calls[0]?.[1] as {
      closeFriendlyOverlay?: () => Promise<void>;
      toggleOverlay?: () => Promise<boolean>;
      getState?: () => Promise<unknown>;
      start?: () => Promise<unknown>;
      setTrackerSettings?: () => Promise<unknown>;
    },
    invoke
  };
}

describe("preload capabilities", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/?overlay=1");
  });

  it("gives the friendly overlay a close-only window lifecycle capability", async () => {
    const { api, invoke } = loadPreloadApi();

    expect(api.closeFriendlyOverlay).toBeTypeOf("function");
    expect(api.toggleOverlay).toBeUndefined();

    await api.closeFriendlyOverlay?.();
    expect(invoke).toHaveBeenCalledWith("tracker:close-friendly-overlay");
  });

  it("does not expose the removed opponent-secret coupling", () => {
    window.history.replaceState({}, "", "/?opponent-overlay=1");
    const { api } = loadPreloadApi();

    expect(api).not.toHaveProperty("onOpponentSecretPredictionChange");
  });

  it.each([
    "friendly-attack-overlay",
    "opponent-attack-overlay",
    "secret-overlay",
    "smart-counter-overlay"
  ])("gives %s read-only state capabilities", (route) => {
    window.history.replaceState({}, "", `/?${route}=1`);
    const { api } = loadPreloadApi();

    expect(api.getState).toBeTypeOf("function");
    expect(api.start).toBeUndefined();
    expect(api.setTrackerSettings).toBeUndefined();
    expect(api.toggleOverlay).toBeUndefined();
  });
});
