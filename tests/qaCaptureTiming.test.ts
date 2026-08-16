import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hideQaDockAfterLaunch,
  requestQaQuit,
  shouldApplyTrackerSettingsEffectsDuringQaCapture,
  shouldSkipLaunchAtLoginUpdateDuringQaCapture,
  shouldUseQaAccessoryActivationPolicy,
  waitForQaRendererSettled
} from "../src/main/qaCaptureTiming";

describe("QA capture timing", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("continues after a bounded delay when renderer frames are throttled", async () => {
    vi.useFakeTimers();
    const wait = waitForQaRendererSettled(() => new Promise(() => undefined), 500);

    await vi.advanceTimersByTimeAsync(500);

    await expect(wait).resolves.toBeUndefined();
  });

  it("continues immediately after the renderer paints two frames", async () => {
    const executeJavaScript = vi.fn(async (_script: string) => undefined);

    await waitForQaRendererSettled(executeJavaScript, 10_000);

    expect(executeJavaScript).toHaveBeenCalledOnce();
    expect(executeJavaScript.mock.calls[0]?.[0]).toContain("requestAnimationFrame");
  });

  it("requests a normal quit and keeps the QA startup chain stopped", async () => {
    const quit = vi.fn();
    let settled = false;

    void requestQaQuit(quit).finally(() => { settled = true; });
    await Promise.resolve();

    expect(quit).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
  });

  it("uses accessory activation only for isolated macOS QA launches", () => {
    const isolatedQa = {
      QA_ALLOW_MULTIPLE_INSTANCES: "1",
      QA_USER_DATA_DIR: "/tmp/hearthstone-qa"
    };

    expect(shouldUseQaAccessoryActivationPolicy(isolatedQa, "darwin")).toBe(true);
    expect(shouldUseQaAccessoryActivationPolicy(isolatedQa, "linux")).toBe(false);
    expect(shouldUseQaAccessoryActivationPolicy({ QA_USER_DATA_DIR: "/tmp/hearthstone-qa" }, "darwin")).toBe(false);
    expect(shouldUseQaAccessoryActivationPolicy({ QA_ALLOW_MULTIPLE_INSTANCES: "1" }, "darwin")).toBe(false);
  });

  it("can exercise startup settings effects in the packaged smart-counter capture", () => {
    const automatedCapture = {
      QA_EXIT_AFTER_SCREENSHOT: "1",
      QA_SCREENSHOT_PATH: "/tmp/smart-counter.png",
      QA_INSPECT_PATH: "/tmp/smart-counter.json"
    };

    expect(shouldApplyTrackerSettingsEffectsDuringQaCapture({})).toBe(true);
    expect(shouldApplyTrackerSettingsEffectsDuringQaCapture(automatedCapture)).toBe(false);
    expect(shouldApplyTrackerSettingsEffectsDuringQaCapture({
      ...automatedCapture,
      QA_APPLY_TRACKER_SETTINGS_EFFECTS: "1"
    })).toBe(true);
    expect(shouldSkipLaunchAtLoginUpdateDuringQaCapture(automatedCapture)).toBe(false);
    expect(shouldSkipLaunchAtLoginUpdateDuringQaCapture({
      ...automatedCapture,
      QA_APPLY_TRACKER_SETTINGS_EFFECTS: "1"
    })).toBe(true);
  });

  it("hides a visible QA Dock icon immediately", async () => {
    let visible = true;
    const dock = {
      isVisible: vi.fn(() => visible),
      hide: vi.fn(() => { visible = false; })
    };
    const wait = vi.fn(async () => undefined);

    await hideQaDockAfterLaunch(dock, wait);

    expect(dock.hide).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });

  it("retries hiding a stubborn QA Dock icon after the macOS grace period", async () => {
    const dock = { isVisible: vi.fn(() => true), hide: vi.fn() };
    const wait = vi.fn(async () => undefined);

    await hideQaDockAfterLaunch(dock, wait);

    expect(dock.hide).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(1_100);
  });

  it("does not wait when the QA Dock icon is already hidden", async () => {
    const dock = { isVisible: vi.fn(() => false), hide: vi.fn() };
    const wait = vi.fn(async () => undefined);

    await hideQaDockAfterLaunch(dock, wait);

    expect(wait).not.toHaveBeenCalled();
    expect(dock.hide).not.toHaveBeenCalled();
  });
});
