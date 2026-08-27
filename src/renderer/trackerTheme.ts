import type { TrackerSettings } from "../shared/types";

const overlayQueryKeys = [
  "overlay",
  "opponent-overlay",
  "board-attack-overlay",
  "friendly-attack-overlay",
  "opponent-attack-overlay",
  "friendly-health-overlay",
  "opponent-health-overlay",
  "secret-overlay",
  "smart-counter-overlay",
  "arena-choice-overlay",
  "ladder-deck-overlay",
  "arena-hero-ranking-overlay",
  "card-preview"
] as const;

export function isOverlayRenderer(search: string): boolean {
  const params = new URLSearchParams(search);
  return overlayQueryKeys.some((key) => params.get(key) === "1");
}

export function resolveTrackerTheme(
  settings: TrackerSettings,
  search: string,
  systemPrefersLight: boolean
): "light" | "dark" {
  if (isOverlayRenderer(search)) return settings.overlay.theme;
  if (settings.appearance.theme === "system") return systemPrefersLight ? "light" : "dark";
  return settings.appearance.theme;
}
