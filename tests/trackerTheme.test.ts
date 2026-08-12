import { describe, expect, it } from "vitest";
import { DEFAULT_TRACKER_SETTINGS } from "../src/main/trackerSettingsStore";
import { isOverlayRenderer, resolveTrackerTheme } from "../src/renderer/trackerTheme";

describe("tracker renderer themes", () => {
  it("uses the main appearance only for the main window", () => {
    const settings = {
      ...DEFAULT_TRACKER_SETTINGS,
      appearance: { ...DEFAULT_TRACKER_SETTINGS.appearance, theme: "dark" as const },
      overlay: { ...DEFAULT_TRACKER_SETTINGS.overlay, theme: "light" as const }
    };
    expect(resolveTrackerTheme(settings, "", false)).toBe("dark");
    expect(resolveTrackerTheme(settings, "?overlay=1", false)).toBe("light");
  });

  it.each([
    "?overlay=1",
    "?opponent-overlay=1",
    "?board-attack-overlay=1",
    "?arena-choice-overlay=1",
    "?ladder-deck-overlay=1",
    "?arena-hero-ranking-overlay=1",
    "?card-preview=1"
  ])("recognizes %s as an overlay window", (search) => {
    expect(isOverlayRenderer(search)).toBe(true);
  });

  it("still follows the operating system for the main window only", () => {
    const settings = {
      ...DEFAULT_TRACKER_SETTINGS,
      appearance: { ...DEFAULT_TRACKER_SETTINGS.appearance, theme: "system" as const },
      overlay: { ...DEFAULT_TRACKER_SETTINGS.overlay, theme: "dark" as const }
    };
    expect(resolveTrackerTheme(settings, "", true)).toBe("light");
    expect(resolveTrackerTheme(settings, "", false)).toBe("dark");
    expect(resolveTrackerTheme(settings, "?card-preview=1", true)).toBe("dark");
  });
});
