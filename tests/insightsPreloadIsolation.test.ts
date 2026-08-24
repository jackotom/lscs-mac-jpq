import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

type InsightsApi = {
  getArenaInsights?: () => Promise<unknown>;
  recordArenaRewards?: (runId: string, rewards: unknown[]) => Promise<unknown>;
  importArenaRuns?: (runs: unknown[]) => Promise<unknown>;
  exportArenaRuns?: () => Promise<unknown>;
  getCollectionInsights?: () => Promise<unknown>;
  importCollectionSnapshot?: (snapshot: unknown) => Promise<unknown>;
  importCollectionCsv?: (csvText: string) => Promise<unknown>;
  recordPackOpening?: (pack: unknown) => Promise<unknown>;
  updateCosmetics?: (cosmetics: unknown) => Promise<unknown>;
};

function loadPreloadApi(search = ""): { api: InsightsApi; invoke: ReturnType<typeof vi.fn> } {
  const exposeInMainWorld = vi.fn();
  const invoke = vi.fn(async () => undefined);
  const source = readFileSync(path.resolve(import.meta.dirname, "../src/main/preload.cts"), "utf8");
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 }
  }).outputText;
  const electron = {
    contextBridge: { exposeInMainWorld },
    ipcRenderer: { invoke, on: vi.fn(), removeListener: vi.fn() }
  };
  const localRequire = (specifier: string) => {
    if (specifier === "electron") return electron;
    throw new Error(`Unexpected preload dependency: ${specifier}`);
  };
  const module = { exports: {} };
  window.history.replaceState({}, "", `/?${search}`);
  Function("require", "module", "exports", compiled)(localRequire, module, module.exports);
  return { api: exposeInMainWorld.mock.calls[0]?.[1] as InsightsApi, invoke };
}

describe("insight preload isolation", () => {
  it("exposes fixed archive and collection operations only to the main workbench", async () => {
    const { api, invoke } = loadPreloadApi();

    expect(api.getArenaInsights).toBeTypeOf("function");
    expect(api.recordArenaRewards).toBeTypeOf("function");
    expect(api.importArenaRuns).toBeTypeOf("function");
    expect(api.exportArenaRuns).toBeTypeOf("function");
    expect(api.getCollectionInsights).toBeTypeOf("function");
    expect(api.importCollectionSnapshot).toBeTypeOf("function");
    expect(api.importCollectionCsv).toBeTypeOf("function");
    expect(api.recordPackOpening).toBeTypeOf("function");
    expect(api.updateCosmetics).toBeTypeOf("function");

    await api.getArenaInsights?.();
    await api.recordArenaRewards?.("run-1", []);
    await api.importArenaRuns?.([]);
    await api.exportArenaRuns?.();
    await api.getCollectionInsights?.();
    await api.importCollectionSnapshot?.({});
    await api.importCollectionCsv?.("type,id");
    await api.recordPackOpening?.({});
    await api.updateCosmetics?.({});

    expect(invoke).toHaveBeenCalledWith("tracker:get-arena-insights");
    expect(invoke).toHaveBeenCalledWith("tracker:record-arena-rewards", "run-1", []);
    expect(invoke).toHaveBeenCalledWith("tracker:import-arena-runs", []);
    expect(invoke).toHaveBeenCalledWith("tracker:export-arena-runs");
    expect(invoke).toHaveBeenCalledWith("tracker:get-collection-insights");
    expect(invoke).toHaveBeenCalledWith("tracker:import-collection-snapshot", {});
    expect(invoke).toHaveBeenCalledWith("tracker:import-collection-csv", "type,id");
    expect(invoke).toHaveBeenCalledWith("tracker:record-pack-opening", {});
    expect(invoke).toHaveBeenCalledWith("tracker:update-cosmetics", {});

    const overlay = loadPreloadApi("overlay=1").api;
    expect(overlay.getArenaInsights).toBeUndefined();
    expect(overlay.recordArenaRewards).toBeUndefined();
    expect(overlay.exportArenaRuns).toBeUndefined();
    expect(overlay.getCollectionInsights).toBeUndefined();
    expect(overlay.importCollectionSnapshot).toBeUndefined();
    expect(overlay.importCollectionCsv).toBeUndefined();
  });
});
