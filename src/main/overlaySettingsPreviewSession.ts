import type { TrackerOverlaySettings } from "../shared/types.js";

const previewControlKeys = ["position", "offsetX", "offsetY", "opacity"] as const;

export class OverlaySettingsPreviewSession {
  private activeUntil = 0;

  constructor(private readonly graceMs: number) {}

  extend(now = Date.now()) {
    this.activeUntil = Math.max(this.activeUntil, now + this.graceMs);
  }

  isActive(now = Date.now()) {
    return now < this.activeUntil;
  }
}

export function didOverlayPreviewControlsChange(
  previous: TrackerOverlaySettings,
  next: TrackerOverlaySettings
) {
  return previewControlKeys.some((key) => previous[key] !== next[key]);
}

export function shouldAllowOverlayDuringSettingsPreview(options: {
  showOnlyInGame: boolean;
  hearthstoneFrontmost: boolean;
  trackerFrontmost: boolean;
  previewActive: boolean;
  previewWindowWasVisible: boolean;
  mainWindowFocused?: boolean;
}) {
  const previewAllowed = options.previewActive &&
    options.previewWindowWasVisible &&
    options.trackerFrontmost;
  if (!options.showOnlyInGame) return true;
  if (options.mainWindowFocused) return previewAllowed;
  if (options.hearthstoneFrontmost) return true;
  return previewAllowed;
}
