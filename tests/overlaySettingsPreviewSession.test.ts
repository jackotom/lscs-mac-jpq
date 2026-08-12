import { describe, expect, it } from "vitest";
import {
  didOverlayPreviewControlsChange,
  OverlaySettingsPreviewSession,
  shouldAllowOverlayDuringSettingsPreview
} from "../src/main/overlaySettingsPreviewSession";
import { DEFAULT_TRACKER_SETTINGS } from "../src/main/trackerSettingsStore";

describe("overlay settings live preview", () => {
  it("keeps preview visible through repeated slider changes and expires after the last change", () => {
    const preview = new OverlaySettingsPreviewSession(2_000);

    preview.extend(100);
    expect(preview.isActive(2_099)).toBe(true);

    preview.extend(1_500);
    expect(preview.isActive(3_499)).toBe(true);
    expect(preview.isActive(3_501)).toBe(false);
  });

  it("does not activate before the user adjusts a preview control", () => {
    const preview = new OverlaySettingsPreviewSession(2_000);
    expect(preview.isActive(100)).toBe(false);
  });

  it("activates only for position or opacity preview controls", () => {
    const previous = DEFAULT_TRACKER_SETTINGS.overlay;
    expect(didOverlayPreviewControlsChange(previous, { ...previous, offsetX: 56 })).toBe(true);
    expect(didOverlayPreviewControlsChange(previous, { ...previous, offsetY: 28 })).toBe(true);
    expect(didOverlayPreviewControlsChange(previous, { ...previous, opacity: 85 })).toBe(false);
    expect(didOverlayPreviewControlsChange(previous, { ...previous, opacity: 70 })).toBe(true);
    expect(didOverlayPreviewControlsChange(previous, { ...previous, secretPrediction: false })).toBe(false);
  });

  it("allows the tracker app only while the settings preview is active", () => {
    expect(shouldAllowOverlayDuringSettingsPreview({
      showOnlyInGame: true,
      hearthstoneFrontmost: false,
      trackerFrontmost: true,
      previewActive: false,
      previewWindowWasVisible: true
    })).toBe(false);

    expect(shouldAllowOverlayDuringSettingsPreview({
      showOnlyInGame: true,
      hearthstoneFrontmost: false,
      trackerFrontmost: true,
      previewActive: true,
      previewWindowWasVisible: true
    })).toBe(true);

    expect(shouldAllowOverlayDuringSettingsPreview({
      showOnlyInGame: true,
      hearthstoneFrontmost: false,
      trackerFrontmost: true,
      previewActive: true,
      previewWindowWasVisible: false
    })).toBe(false);

    expect(shouldAllowOverlayDuringSettingsPreview({
      showOnlyInGame: true,
      hearthstoneFrontmost: true,
      trackerFrontmost: false,
      previewActive: false,
      previewWindowWasVisible: false
    })).toBe(true);
  });

  it("shows overlays outside the game when game-only mode is disabled, even while the main window is focused", () => {
    expect(shouldAllowOverlayDuringSettingsPreview({
      showOnlyInGame: false,
      hearthstoneFrontmost: false,
      trackerFrontmost: false,
      previewActive: false,
      previewWindowWasVisible: false,
      mainWindowFocused: true
    })).toBe(true);

    expect(shouldAllowOverlayDuringSettingsPreview({
      showOnlyInGame: true,
      hearthstoneFrontmost: false,
      trackerFrontmost: true,
      previewActive: true,
      previewWindowWasVisible: true,
      mainWindowFocused: true
    })).toBe(true);
  });
});
