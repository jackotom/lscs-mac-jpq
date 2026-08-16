import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AuxiliaryOverlayWindowStateStore,
  getSmartCounterIdFromOverlayKind,
  getSmartCounterOverlayKind,
  getSecretOverlayVisibleBounds,
  moveAuxiliaryOverlayBounds,
  parseAuxiliaryOverlayWindowState
} from "../src/main/auxiliaryOverlayWindowState";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("AuxiliaryOverlayWindowStateStore", () => {
  it("keeps the secret left-top anchor through collapse, expand, and restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "auxiliary-overlay-secret-toggle-"));
    tempDirs.push(root);
    const workArea = { x: 0, y: 0, width: 1440, height: 900 };
    const expandedBounds = { x: 384, y: 72, width: 144, height: 82 };
    const store = new AuxiliaryOverlayWindowStateStore(root);
    await store.saveBounds("secret", expandedBounds, workArea);

    const collapsedBounds = await store.setSecretCollapsed(true, {
      currentBounds: expandedBounds,
      expandedBounds,
      workArea
    });
    expect(collapsedBounds).toEqual({ x: 384, y: 72, width: 44, height: 44 });

    const afterCollapseRestart = new AuxiliaryOverlayWindowStateStore(root);
    await expect(afterCollapseRestart.getSecretCollapsed()).resolves.toBe(true);
    await expect(afterCollapseRestart.resolveBounds(
      "secret",
      getSecretOverlayVisibleBounds(expandedBounds, true),
      workArea
    )).resolves.toEqual(collapsedBounds);

    const restoredExpandedBounds = await afterCollapseRestart.setSecretCollapsed(false, {
      currentBounds: collapsedBounds,
      expandedBounds,
      workArea
    });
    expect(restoredExpandedBounds).toEqual(expandedBounds);

    const afterExpandRestart = new AuxiliaryOverlayWindowStateStore(root);
    await expect(afterExpandRestart.getSecretCollapsed()).resolves.toBe(false);
    await expect(afterExpandRestart.resolveBounds("secret", expandedBounds, workArea))
      .resolves.toEqual(expandedBounds);
  });

  it("keeps a collapsed secret drag position when expanding and restarting", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "auxiliary-overlay-secret-drag-"));
    tempDirs.push(root);
    const workArea = { x: 0, y: 0, width: 1440, height: 900 };
    const expandedBounds = { x: 384, y: 72, width: 144, height: 82 };
    const collapsedBounds = getSecretOverlayVisibleBounds(expandedBounds, true);
    const draggedBounds = moveAuxiliaryOverlayBounds(
      collapsedBounds,
      { x: 400, y: 90 },
      { x: 600, y: 290 },
      workArea
    );
    const store = new AuxiliaryOverlayWindowStateStore(root);
    await store.setSecretCollapsed(true);
    await store.saveBounds("secret", draggedBounds, workArea);

    const expandedAfterDrag = await store.setSecretCollapsed(false, {
      currentBounds: draggedBounds,
      expandedBounds,
      workArea
    });
    expect(expandedAfterDrag).toEqual({ ...expandedBounds, x: draggedBounds.x, y: draggedBounds.y });

    const restarted = new AuxiliaryOverlayWindowStateStore(root);
    await expect(restarted.getSecretCollapsed()).resolves.toBe(false);
    await expect(restarted.resolveBounds("secret", expandedBounds, workArea))
      .resolves.toEqual(expandedAfterDrag);
  });

  it("restores each movable overlay at the same relative point on the current Hearthstone display", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "auxiliary-overlay-state-"));
    tempDirs.push(root);
    const store = new AuxiliaryOverlayWindowStateStore(root);
    const originalWorkArea = { x: 100, y: 50, width: 1000, height: 500 };

    await store.saveBounds(
      "friendly-attack",
      { x: 578, y: 278, width: 44, height: 44 },
      originalWorkArea
    );
    await store.saveBounds(
      "opponent-attack",
      { x: 1056, y: 506, width: 44, height: 44 },
      originalWorkArea
    );
    await store.saveBounds(
      "secret",
      { x: 578, y: 278, width: 44, height: 44 },
      originalWorkArea
    );
    await store.setSecretCollapsed(true);

    const restored = new AuxiliaryOverlayWindowStateStore(root);
    const currentWorkArea = { x: 2000, y: 100, width: 2000, height: 1000 };
    await expect(restored.resolveBounds(
      "friendly-attack",
      { x: 2100, y: 200, width: 44, height: 44 },
      currentWorkArea
    )).resolves.toEqual({ x: 2978, y: 578, width: 44, height: 44 });
    await expect(restored.resolveBounds(
      "opponent-attack",
      { x: 2100, y: 200, width: 44, height: 44 },
      currentWorkArea
    )).resolves.toEqual({ x: 3948, y: 1048, width: 44, height: 44 });
    await expect(restored.resolveBounds(
      "secret",
      { x: 2100, y: 200, width: 44, height: 44 },
      currentWorkArea
    )).resolves.toEqual({ x: 2978, y: 578, width: 44, height: 44 });
    await expect(restored.getSecretCollapsed()).resolves.toBe(true);
  });

  it("saves and restores every smart counter independently across restart and display changes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "auxiliary-overlay-smart-counters-"));
    tempDirs.push(root);
    const originalWorkArea = { x: 0, y: 0, width: 1000, height: 500 };
    const first = getSmartCounterOverlayKind("friendly-dragons-played");
    const second = getSmartCounterOverlayKind("friendly-spells-played");
    const store = new AuxiliaryOverlayWindowStateStore(root);

    await store.saveBounds(first, { x: 8, y: 8, width: 160, height: 48 }, originalWorkArea);
    await store.saveBounds(second, { x: 832, y: 444, width: 160, height: 48 }, originalWorkArea);

    const restarted = new AuxiliaryOverlayWindowStateStore(root);
    const currentWorkArea = { x: 2000, y: 100, width: 2000, height: 1000 };
    await expect(restarted.resolveBounds(
      first,
      { x: 2100, y: 200, width: 160, height: 48 },
      currentWorkArea
    )).resolves.toEqual({ x: 2008, y: 108, width: 160, height: 48 });
    await expect(restarted.resolveBounds(
      second,
      { x: 2100, y: 200, width: 160, height: 48 },
      currentWorkArea
    )).resolves.toEqual({ x: 3832, y: 1044, width: 160, height: 48 });
  });

  it("keeps valid legacy and smart positions while ignoring malformed smart targets", () => {
    expect(parseAuxiliaryOverlayWindowState({
      positions: {
        "friendly-attack": { xRatio: 0.1, yRatio: 0.2 },
        "smart-counter:friendly-dragons-played": { xRatio: 0.3, yRatio: 0.4 },
        "smart-counter:../secret": { xRatio: 0.9, yRatio: 0.9 }
      },
      secretCollapsed: false
    })).toEqual({
      positions: {
        "friendly-attack": { xRatio: 0.1, yRatio: 0.2 },
        "smart-counter:friendly-dragons-played": { xRatio: 0.3, yRatio: 0.4 }
      },
      secretCollapsed: false
    });
  });

  it("keeps future slug-style counter ids stable without lowercasing or collisions", () => {
    const kind = getSmartCounterOverlayKind("Future_RULE-2");

    expect(kind).toBe("smart-counter:Future_RULE-2");
    expect(getSmartCounterIdFromOverlayKind(kind)).toBe("Future_RULE-2");
  });

  it("shrinks a collapsed secret window to its 44px entry without moving its anchor", () => {
    expect(getSecretOverlayVisibleBounds(
      { x: 384, y: 72, width: 144, height: 190 },
      true
    )).toEqual({ x: 384, y: 72, width: 44, height: 44 });
  });

  it("moves from the drag origin and keeps the complete button inside the work area", () => {
    const workArea = { x: 100, y: 50, width: 800, height: 500 };

    expect(moveAuxiliaryOverlayBounds(
      { x: 300, y: 200, width: 44, height: 44 },
      { x: 320, y: 220 },
      { x: 500, y: 400 },
      workArea
    )).toEqual({ x: 480, y: 380, width: 44, height: 44 });
    expect(moveAuxiliaryOverlayBounds(
      { x: 300, y: 200, width: 44, height: 44 },
      { x: 320, y: 220 },
      { x: 5000, y: 5000 },
      workArea
    )).toEqual({ x: 848, y: 498, width: 44, height: 44 });
  });

  it("keeps the last valid in-memory state when persistence fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "auxiliary-overlay-state-failure-"));
    tempDirs.push(root);
    const blockedDirectory = path.join(root, "not-a-directory");
    await writeFile(blockedDirectory, "blocked", "utf8");
    const store = new AuxiliaryOverlayWindowStateStore(blockedDirectory);

    await expect(store.getSecretCollapsed()).resolves.toBe(false);
    await expect(store.setSecretCollapsed(true)).rejects.toThrow();
    await expect(store.getSecretCollapsed()).resolves.toBe(false);
  });
});
