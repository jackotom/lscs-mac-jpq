import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MasLogAccessStore } from "../src/main/masLogAccess.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("MasLogAccessStore", () => {
  it("restores a selected folder and starts its security-scoped bookmark", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mas-log-access-"));
    directories.push(directory);
    const filePath = path.join(directory, "selection.json");
    const environment: NodeJS.ProcessEnv = {};
    const stops: string[] = [];
    const host = {
      startAccessingSecurityScopedResource(bookmark: string) {
        stops.push(bookmark);
        return () => undefined;
      }
    };
    const store = new MasLogAccessStore({ filePath, host, isMas: true, environment });

    await store.save({ path: "/Users/test/OldLogs", bookmark: "old-bookmark" });
    await store.save({ path: "/Users/test/Logs", bookmark: "bookmark-data" });
    await writeFile(filePath, "{broken", "utf8");
    const restored = await new MasLogAccessStore({ filePath, host, isMas: true, environment }).restore();

    expect(restored).toBe("/Users/test/OldLogs");
    expect(environment.HEARTHSTONE_LOG_DIR).toBe("/Users/test/OldLogs");
    expect(stops).toEqual(["old-bookmark", "bookmark-data", "old-bookmark"]);
  });

  it("audit regression retains prior access when persisting a replacement selection fails", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mas-log-access-"));
    const movedDirectory = `${directory}-moved`;
    directories.push(directory, movedDirectory);
    const filePath = path.join(directory, "selection.json");
    const environment: NodeJS.ProcessEnv = {};
    const stopped: string[] = [];
    const host = {
      startAccessingSecurityScopedResource(bookmark: string) {
        return () => { stopped.push(bookmark); };
      }
    };
    const store = new MasLogAccessStore({ filePath, host, isMas: true, environment });
    await store.save({ path: "/Users/test/OldLogs", bookmark: "old-bookmark" });
    await rename(directory, movedDirectory);
    await writeFile(directory, "blocked", "utf8");

    await expect(store.save({ path: "/Users/test/NewLogs", bookmark: "new-bookmark" })).rejects.toThrow();
    expect(stopped).toEqual(["new-bookmark"]);
    expect(environment.HEARTHSTONE_LOG_DIR).toBe("/Users/test/OldLogs");
    expect(await readFile(path.join(movedDirectory, "selection.json"), "utf8")).toContain("old-bookmark");

    store.dispose();
    expect(stopped).toEqual(["new-bookmark", "old-bookmark"]);
  });

  it("audit regression serializes concurrent saves so persistence, environment, and active scope agree", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mas-log-access-"));
    directories.push(directory);
    const filePath = path.join(directory, "selection.json");
    const environment: NodeJS.ProcessEnv = {};
    const active = new Set<string>();
    const host = {
      startAccessingSecurityScopedResource(bookmark: string) {
        active.add(bookmark);
        return () => { active.delete(bookmark); };
      }
    };
    const store = new MasLogAccessStore({ filePath, host, isMas: true, environment });

    await Promise.all([
      store.save({ path: "/Users/test/FirstLogs", bookmark: "first-bookmark" }),
      store.save({ path: "/Users/test/SecondLogs", bookmark: "second-bookmark" })
    ]);

    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({ path: "/Users/test/SecondLogs", bookmark: "second-bookmark" });
    expect(environment.HEARTHSTONE_LOG_DIR).toBe("/Users/test/SecondLogs");
    expect(active).toEqual(new Set(["second-bookmark"]));
  });

  it("audit regression releases every scope when dispose races a pending save", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mas-log-access-"));
    directories.push(directory);
    const filePath = path.join(directory, "selection.json");
    const active = new Set<string>();
    let releasePersist: (() => void) | undefined;
    let persistStarted: (() => void) | undefined;
    const pendingPersist = new Promise<void>((resolve) => { releasePersist = resolve; });
    const saveStarted = new Promise<void>((resolve) => { persistStarted = resolve; });
    const host = {
      startAccessingSecurityScopedResource(bookmark: string) {
        active.add(bookmark);
        return () => { active.delete(bookmark); };
      }
    };
    const store = new MasLogAccessStore({
      filePath,
      host,
      isMas: true,
      persistSelection: async (_filePath, selection) => {
        if (selection.bookmark === "pending-bookmark") {
          persistStarted?.();
          await pendingPersist;
        }
      }
    });
    await store.save({ path: "/Users/test/OldLogs", bookmark: "old-bookmark" });
    const pendingSave = store.save({ path: "/Users/test/PendingLogs", bookmark: "pending-bookmark" });
    await saveStarted;

    store.dispose();
    releasePersist?.();
    await pendingSave;

    expect(active).toEqual(new Set());
  });
});
