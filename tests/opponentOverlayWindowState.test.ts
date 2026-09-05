import { describe, expect, it } from "vitest";
import { OpponentOverlayWindowState } from "../src/main/opponentOverlayWindowState";

describe("opponent overlay window state", () => {
  it("collapses without losing the expanded bounds and restores them", () => {
    const state = new OpponentOverlayWindowState({ x: 20, y: 30, width: 250, height: 170 });

    expect(state.collapse()).toEqual({ x: 20, y: 30, width: 52, height: 38 });
    expect(state.expand()).toEqual({ x: 20, y: 30, width: 250, height: 170 });
  });

  it("keeps secret updates folded", () => {
    const state = new OpponentOverlayWindowState({ x: 20, y: 30, width: 250, height: 170 });
    state.collapse();

    expect(state.isCollapsed()).toBe(true);
    expect(state.currentBounds()).toEqual({ x: 20, y: 30, width: 52, height: 38 });
  });

  it("restores a folded window while keeping its expanded bounds", () => {
    const folded = new OpponentOverlayWindowState({ x: 20, y: 30, width: 250, height: 170 });
    folded.collapse();
    const state = OpponentOverlayWindowState.fromPersisted(folded.toPersisted());

    expect(state.isCollapsed()).toBe(true);
    expect(state.currentBounds()).toEqual({ x: 20, y: 30, width: 52, height: 38 });
    expect(state.expand()).toEqual({ x: 20, y: 30, width: 250, height: 170 });
  });

  it("treats the legacy bounds-only file as expanded", () => {
    const state = OpponentOverlayWindowState.fromPersisted({ x: 20, y: 30, width: 250, height: 170 });

    expect(state.isCollapsed()).toBe(false);
    expect(state.currentBounds()).toEqual({ x: 20, y: 30, width: 250, height: 170 });
  });
});
