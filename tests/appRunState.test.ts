import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AppRunState } from "../src/main/appRunState";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createStore() {
  const directory = await mkdtemp(path.join(tmpdir(), "hearthstone-run-state-"));
  temporaryDirectories.push(directory);
  return { directory, store: new AppRunState(directory, () => new Date("2026-08-12T08:00:00.000Z")) };
}

describe("AppRunState", () => {
  it("reports a previous running marker and replaces it with the current run", async () => {
    const { directory, store } = await createStore();
    const statePath = path.join(directory, "app-run-state.json");
    await writeFile(statePath, JSON.stringify({
      schemaVersion: 1,
      status: "running",
      version: "0.3.9",
      startedAt: "2026-08-11T06:00:00.000Z",
      phase: "monitoring"
    }));

    const previous = await store.begin("0.4.0");

    expect(previous).toEqual({
      wasUnclean: true,
      version: "0.3.9",
      startedAt: "2026-08-11T06:00:00.000Z",
      phase: "monitoring"
    });
    expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual({
      schemaVersion: 1,
      status: "running",
      version: "0.4.0",
      startedAt: "2026-08-12T08:00:00.000Z",
      phase: "starting"
    });
  });

  it("updates only the anonymous phase and records a clean exit", async () => {
    const { directory, store } = await createStore();
    await store.begin("0.4.0");

    await store.markPhase("monitoring");
    await store.markClean();

    const value = JSON.parse(await readFile(path.join(directory, "app-run-state.json"), "utf8"));
    expect(value).toEqual({
      schemaVersion: 1,
      status: "clean",
      version: "0.4.0",
      startedAt: "2026-08-12T08:00:00.000Z",
      phase: "stopped",
      endedAt: "2026-08-12T08:00:00.000Z"
    });
    expect(JSON.stringify(value)).not.toMatch(/deck|player|token|power\.log/i);
  });

  it("ignores malformed previous state without blocking startup", async () => {
    const { directory, store } = await createStore();
    await writeFile(path.join(directory, "app-run-state.json"), "{broken", "utf8");

    await expect(store.begin("0.4.0")).resolves.toEqual({ wasUnclean: false });
  });

  it("keeps the clean marker when startup phase writes overlap shutdown", async () => {
    const { directory, store } = await createStore();
    await store.begin("0.4.0");

    await Promise.all([
      store.markPhase("monitoring"),
      store.markClean(),
      store.markPhase("ready")
    ]);

    await expect(readFile(path.join(directory, "app-run-state.json"), "utf8").then(JSON.parse)).resolves.toMatchObject({
      status: "clean",
      phase: "stopped"
    });
  });
});
