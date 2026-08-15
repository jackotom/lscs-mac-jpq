import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";

describe("secret overlay collapsed-state sync", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: undefined
    });
  });

  it("restores the saved collapsed state and persists the next badge click", async () => {
    const setSecretOverlayCollapsed = vi.fn(async (collapsed: boolean) => collapsed);
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: {
        getState: () => new Promise<never>(() => undefined),
        onUpdate: () => () => undefined,
        getSecretOverlayCollapsed: vi.fn(async () => true),
        setSecretOverlayCollapsed
      }
    });
    window.history.replaceState({}, "", "/?secret-overlay=1&qa-secret-dense=1");

    render(<App />);

    const restoreButton = await screen.findByRole("button", { name: "展开奥秘助手" });
    expect(screen.queryByLabelText("对手奥秘预测悬浮窗")).not.toBeInTheDocument();

    fireEvent.click(restoreButton);

    expect(setSecretOverlayCollapsed).toHaveBeenCalledWith(false);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "收起奥秘助手" })).toBeInTheDocument();
    });
  });

  it("restores the visible state when the main process cannot save the change", async () => {
    const setSecretOverlayCollapsed = vi.fn(async () => {
      throw new Error("save failed");
    });
    Object.defineProperty(window, "hearthstoneTracker", {
      configurable: true,
      value: {
        getState: () => new Promise<never>(() => undefined),
        onUpdate: () => () => undefined,
        getSecretOverlayCollapsed: vi.fn(async () => false),
        setSecretOverlayCollapsed
      }
    });
    window.history.replaceState({}, "", "/?secret-overlay=1&qa-secret-dense=1");

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "收起奥秘助手" }));

    expect(setSecretOverlayCollapsed).toHaveBeenCalledWith(true);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "收起奥秘助手" })).toBeInTheDocument();
    });
  });
});
