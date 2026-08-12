import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";

describe("opponent overlay collapsed-state sync", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: undefined
    });
  });

  it("uses the initial main-process state and follows later main-process changes", async () => {
    let notifyCollapsedChange: ((collapsed: boolean) => void) | undefined;
    const unsubscribe = vi.fn();

    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: {
        discoverLogs: () => Promise.resolve([]),
        getState: () => new Promise<never>(() => undefined),
        getOpponentOverlayCollapsed: () => Promise.resolve(true),
        onOpponentOverlayCollapsedChange: (callback: (collapsed: boolean) => void) => {
          notifyCollapsedChange = callback;
          return unsubscribe;
        },
        onUpdate: () => () => undefined
      }
    });
    window.history.replaceState({}, "", "/?opponent-overlay=1&qa-opponent-demo=1");

    const { unmount } = render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "恢复对手记牌小窗" })).toBeInTheDocument();
    });

    act(() => notifyCollapsedChange?.(false));

    expect(screen.getByLabelText("对手记牌器置顶小窗")).toBeInTheDocument();

    act(() => notifyCollapsedChange?.(true));

    expect(screen.getByRole("button", { name: "恢复对手记牌小窗" })).toBeInTheDocument();

    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not let a late initial query overwrite a newer main-process event", async () => {
    let notifyCollapsedChange: ((collapsed: boolean) => void) | undefined;
    let resolveInitialState!: (collapsed: boolean) => void;

    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: {
        discoverLogs: () => Promise.resolve([]),
        getState: () => new Promise<never>(() => undefined),
        getOpponentOverlayCollapsed: () => new Promise<boolean>((resolve) => {
          resolveInitialState = resolve;
        }),
        onOpponentOverlayCollapsedChange: (callback: (collapsed: boolean) => void) => {
          notifyCollapsedChange = callback;
          return () => undefined;
        },
        onUpdate: () => () => undefined
      }
    });
    window.history.replaceState({}, "", "/?opponent-overlay=1&qa-opponent-demo=1");

    render(<App />);

    act(() => notifyCollapsedChange?.(true));
    expect(screen.getByRole("button", { name: "恢复对手记牌小窗" })).toBeInTheDocument();

    await act(async () => resolveInitialState(false));

    expect(screen.getByRole("button", { name: "恢复对手记牌小窗" })).toBeInTheDocument();
  });
});
