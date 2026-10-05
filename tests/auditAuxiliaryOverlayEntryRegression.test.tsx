import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AuxiliaryOverlayEntry from "../src/renderer/AuxiliaryOverlayEntry";
import { createPublicTrackerState } from "./fixtures/publicTrackerState";

afterEach(() => {
  window.history.replaceState({}, "", "/");
  delete window.hearthstoneTracker;
});

describe("auxiliary overlay entry", () => {
  it("audit regression: fails closed for board attack until a live game is confirmed", async () => {
    const inactive = createPublicTrackerState({ gameActive: false, boardAttack: { friendly: 7, opponent: 5 } });
    const active = createPublicTrackerState({ gameActive: true, boardAttack: { friendly: 7, opponent: 5 } });
    let publish!: (state: typeof active) => void;
    window.history.replaceState({}, "", "/?board-attack-overlay=1");
    window.hearthstoneTracker = {
      getState: vi.fn(async () => inactive),
      onUpdate: vi.fn((callback: (state: typeof active) => void) => {
        publish = callback;
        return () => undefined;
      })
    } as unknown as typeof window.hearthstoneTracker;

    render(<AuxiliaryOverlayEntry />);

    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByLabelText("场攻悬浮窗")).not.toBeInTheDocument();

    act(() => publish(active));
    expect(await screen.findByLabelText("场攻悬浮窗")).toBeInTheDocument();
    expect(screen.getByLabelText("我方场攻 7")).toBeInTheDocument();
  });
});
