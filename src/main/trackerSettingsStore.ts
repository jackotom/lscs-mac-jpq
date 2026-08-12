import { promises as fs } from "node:fs";
import path from "node:path";
import {
  TRACKER_ACCENT_COLORS,
  type TrackerAppearanceSettings,
  type TrackerGeneralSettings,
  type TrackerModeSettings,
  type TrackerOtherSettings,
  type TrackerOverlaySettings,
  type TrackerSettings
} from "../shared/types.js";

export const DEFAULT_TRACKER_SETTINGS: TrackerSettings = {
  ladder: { friendlyDeckTracker: true, opponentDeckTracker: true },
  arena: { friendlyDeckTracker: true, opponentDeckTracker: true },
  general: {
    launchAtLogin: false,
    startMinimized: false,
    showGameStatusIcon: true,
    minimizeToMenuBar: true,
    focusOnOpen: true,
    gameDetection: "automatic",
    gameLanguage: "zh-CN",
    windowMatching: "smart"
  },
  overlay: {
    enabled: true,
    showOnlyInGame: true,
    theme: "light",
    arenaHeroWinRateRanking: true,
    showFriendlyAttack: false,
    showOpponentAttack: false,
    secretPrediction: true,
    position: "right",
    offsetX: 20,
    offsetY: 0,
    opacity: 85,
    hideInFullscreen: true
  },
  appearance: {
    theme: "dark",
    accentColor: "#3b82f6",
    fontSize: "medium",
    zoom: 100,
    animations: true,
    cardImageQuality: "high"
  },
  other: {
    autoUpdateCards: true,
    updateFrequency: "daily",
    matchRetentionDays: 90,
    notifyUpdates: true,
    notifyAnnouncements: true,
    verboseLogs: false
  }
};

export class TrackerSettingsStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(userDataDirectory: string) {
    this.filePath = path.join(userDataDirectory, "tracker-settings.json");
  }

  async read(): Promise<TrackerSettings> {
    let content: string;
    try {
      content = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) return cloneSettings(DEFAULT_TRACKER_SETTINGS);
      throw error;
    }

    try {
      const value = JSON.parse(content) as unknown;
      const settings = parseTrackerSettings(value);
      if (settings) {
        const normalized = normalizeGlobalTrackerSwitches(settings);
        if (!trackerSwitchesMatch(settings)) await this.write(normalized);
        return cloneSettings(normalized);
      }

      const migrated = migratePreviousTrackerSettings(value) ?? migrateLegacyTrackerSettings(value);
      if (migrated) {
        await this.write(migrated);
        return cloneSettings(migrated);
      }
      return cloneSettings(DEFAULT_TRACKER_SETTINGS);
    } catch (error) {
      if (error instanceof SyntaxError) return cloneSettings(DEFAULT_TRACKER_SETTINGS);
      throw error;
    }
  }

  async repairOnStartup(): Promise<
    | { readonly status: "unchanged" | "migrated"; readonly settings: TrackerSettings }
    | { readonly status: "repaired"; readonly settings: TrackerSettings; readonly backupPath: string }
  > {
    let content: string;
    try {
      content = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        return {
          status: "unchanged",
          settings: cloneSettings(DEFAULT_TRACKER_SETTINGS)
        };
      }
      throw error;
    }

    let value: unknown;
    try {
      value = JSON.parse(content) as unknown;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return this.backupAndReplaceInvalidSettings(content);
    }

    const current = parseTrackerSettings(value);
    if (current) {
      const normalized = normalizeGlobalTrackerSwitches(current);
      if (!trackerSwitchesMatch(current)) {
        await this.write(normalized);
        return { status: "migrated", settings: cloneSettings(normalized) };
      }
      return { status: "unchanged", settings: cloneSettings(normalized) };
    }

    const migrated = migratePreviousTrackerSettings(value) ?? migrateLegacyTrackerSettings(value);
    if (migrated) {
      await this.write(migrated);
      return { status: "migrated", settings: cloneSettings(migrated) };
    }

    return this.backupAndReplaceInvalidSettings(content);
  }

  async replace(value: unknown): Promise<TrackerSettings> {
    const settings = parseTrackerSettings(value);
    if (!settings) throw new Error("设置数据无效");
    const normalized = normalizeGlobalTrackerSwitches(settings);

    await this.write(normalized);
    return cloneSettings(normalized);
  }

  private write(settings: TrackerSettings): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      try {
        await fs.writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
        await fs.rename(temporaryPath, this.filePath);
      } catch (error) {
        throw new Error(`写入设置失败：${formatError(error)}`, { cause: error });
      } finally {
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      }
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  private async backupAndReplaceInvalidSettings(content: string) {
    const backupPath = `${this.filePath}.bak-${timestampForPath()}-${process.pid}`;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(backupPath, content, { encoding: "utf8", flag: "wx" });
    await this.write(DEFAULT_TRACKER_SETTINGS);
    return {
      status: "repaired" as const,
      settings: cloneSettings(DEFAULT_TRACKER_SETTINGS),
      backupPath
    };
  }
}

export function parseTrackerSettings(value: unknown): TrackerSettings | undefined {
  if (!hasExactKeys(value, ["ladder", "arena", "general", "overlay", "appearance", "other"]) ||
      !isModeSettings(value.ladder) || !isModeSettings(value.arena) ||
      !isGeneralSettings(value.general) || !isOverlaySettings(value.overlay) ||
      !isAppearanceSettings(value.appearance) || !isOtherSettings(value.other)) {
    return undefined;
  }
  return {
    ladder: { ...value.ladder },
    arena: { ...value.arena },
    general: { ...value.general },
    overlay: { ...value.overlay },
    appearance: { ...value.appearance },
    other: { ...value.other }
  };
}

function migratePreviousTrackerSettings(value: unknown): TrackerSettings | undefined {
  if (!hasExactKeys(value, ["ladder", "arena", "general", "overlay", "appearance", "other"])) {
    return undefined;
  }

  const migratedGeneral = migratePreviousGeneralSettings(value.general);
  const migratedOverlay = migratePreviousOverlaySettings(value.overlay, value.appearance);
  if (!migratedGeneral && !migratedOverlay) return undefined;

  const settings = parseTrackerSettings({
    ...value,
    general: migratedGeneral ?? value.general,
    overlay: migratedOverlay ?? value.overlay
  });
  return settings ? normalizeGlobalTrackerSwitches(settings) : undefined;
}

function migrateLegacyTrackerSettings(value: unknown): TrackerSettings | undefined {
  if (!hasExactKeys(value, ["ladder", "arena"]) || !isModeSettings(value.ladder) || !isModeSettings(value.arena)) {
    return undefined;
  }
  return {
    ...cloneSettings(DEFAULT_TRACKER_SETTINGS),
    ladder: { ...value.ladder },
    arena: { ...value.ladder }
  };
}

function normalizeGlobalTrackerSwitches(settings: TrackerSettings): TrackerSettings {
  return {
    ...settings,
    ladder: { ...settings.ladder },
    arena: { ...settings.ladder }
  };
}

function trackerSwitchesMatch(settings: TrackerSettings): boolean {
  return settings.ladder.friendlyDeckTracker === settings.arena.friendlyDeckTracker &&
    settings.ladder.opponentDeckTracker === settings.arena.opponentDeckTracker;
}

function isModeSettings(value: unknown): value is TrackerModeSettings {
  return hasExactKeys(value, ["friendlyDeckTracker", "opponentDeckTracker"]) &&
    typeof value.friendlyDeckTracker === "boolean" &&
    typeof value.opponentDeckTracker === "boolean";
}

function isGeneralSettings(value: unknown): value is TrackerGeneralSettings {
  return hasExactKeys(value, [
    "launchAtLogin", "startMinimized", "showGameStatusIcon", "minimizeToMenuBar",
    "focusOnOpen", "gameDetection", "gameLanguage", "windowMatching"
  ]) &&
    [value.launchAtLogin, value.startMinimized, value.showGameStatusIcon, value.minimizeToMenuBar, value.focusOnOpen]
      .every((item) => typeof item === "boolean") &&
    isOneOf(value.gameDetection, ["automatic", "manual"]) &&
    isOneOf(value.gameLanguage, ["zh-CN", "zh-TW", "en-US"]) &&
    isOneOf(value.windowMatching, ["smart", "title", "process"]);
}

function migratePreviousGeneralSettings(value: unknown): TrackerGeneralSettings | undefined {
  if (isPreviousGeneralSettings(value)) {
    return { ...value, focusOnOpen: true };
  }
  if (!isTransitionalAlwaysOnTopGeneralSettings(value)) return undefined;
  return {
    launchAtLogin: value.launchAtLogin,
    startMinimized: value.startMinimized,
    showGameStatusIcon: value.showGameStatusIcon,
    minimizeToMenuBar: value.minimizeToMenuBar,
    focusOnOpen: true,
    gameDetection: value.gameDetection,
    gameLanguage: value.gameLanguage,
    windowMatching: value.windowMatching
  };
}

function isPreviousGeneralSettings(value: unknown): value is Omit<TrackerGeneralSettings, "focusOnOpen"> {
  return hasExactKeys(value, [
    "launchAtLogin", "startMinimized", "showGameStatusIcon", "minimizeToMenuBar",
    "gameDetection", "gameLanguage", "windowMatching"
  ]) &&
    [value.launchAtLogin, value.startMinimized, value.showGameStatusIcon, value.minimizeToMenuBar]
      .every((item) => typeof item === "boolean") &&
    isOneOf(value.gameDetection, ["automatic", "manual"]) &&
    isOneOf(value.gameLanguage, ["zh-CN", "zh-TW", "en-US"]) &&
    isOneOf(value.windowMatching, ["smart", "title", "process"]);
}

function isTransitionalAlwaysOnTopGeneralSettings(
  value: unknown
): value is Omit<TrackerGeneralSettings, "focusOnOpen"> & { readonly alwaysOnTop: boolean } {
  return hasExactKeys(value, [
    "launchAtLogin", "startMinimized", "showGameStatusIcon", "minimizeToMenuBar",
    "alwaysOnTop", "gameDetection", "gameLanguage", "windowMatching"
  ]) &&
    [value.launchAtLogin, value.startMinimized, value.showGameStatusIcon, value.minimizeToMenuBar, value.alwaysOnTop]
      .every((item) => typeof item === "boolean") &&
    isOneOf(value.gameDetection, ["automatic", "manual"]) &&
    isOneOf(value.gameLanguage, ["zh-CN", "zh-TW", "en-US"]) &&
    isOneOf(value.windowMatching, ["smart", "title", "process"]);
}

function migratePreviousOverlaySettings(
  value: unknown,
  appearance: unknown
): TrackerOverlaySettings | undefined {
  if (!isRecord(value) || (
    "theme" in value &&
    "showOnlyInGame" in value &&
    "arenaHeroWinRateRanking" in value
  )) return undefined;

  const candidate = {
    theme: migratedOverlayTheme(appearance),
    showOnlyInGame: true,
    arenaHeroWinRateRanking: true,
    ...value
  };
  return isOverlaySettings(candidate) ? candidate : undefined;
}

function migratedOverlayTheme(value: unknown): TrackerOverlaySettings["theme"] {
  return isAppearanceSettings(value) && value.theme === "dark" ? "dark" : "light";
}

function isOverlaySettings(value: unknown): value is TrackerOverlaySettings {
  return hasExactKeys(value, [
    "enabled", "showOnlyInGame", "theme", "arenaHeroWinRateRanking", "showFriendlyAttack", "showOpponentAttack", "secretPrediction", "position",
    "offsetX", "offsetY", "opacity", "hideInFullscreen"
  ]) &&
    [value.enabled, value.showOnlyInGame, value.arenaHeroWinRateRanking, value.showFriendlyAttack, value.showOpponentAttack, value.secretPrediction, value.hideInFullscreen]
      .every((item) => typeof item === "boolean") &&
    isOneOf(value.theme, ["light", "dark"]) &&
    isOneOf(value.position, ["left", "right"]) &&
    isNumberInRange(value.offsetX, -200, 200) &&
    isNumberInRange(value.offsetY, -200, 200) &&
    isNumberInRange(value.opacity, 30, 100);
}

function isAppearanceSettings(value: unknown): value is TrackerAppearanceSettings {
  return hasExactKeys(value, ["theme", "accentColor", "fontSize", "zoom", "animations", "cardImageQuality"]) &&
    isOneOf(value.theme, ["dark", "light", "system"]) &&
    isOneOf(value.accentColor, TRACKER_ACCENT_COLORS) &&
    isOneOf(value.fontSize, ["small", "medium", "large"]) &&
    isNumberInRange(value.zoom, 80, 120) &&
    typeof value.animations === "boolean" &&
    isOneOf(value.cardImageQuality, ["low", "high"]);
}

function isOtherSettings(value: unknown): value is TrackerOtherSettings {
  return hasExactKeys(value, [
    "autoUpdateCards", "updateFrequency", "matchRetentionDays", "notifyUpdates",
    "notifyAnnouncements", "verboseLogs"
  ]) &&
    [value.autoUpdateCards, value.notifyUpdates, value.notifyAnnouncements, value.verboseLogs]
      .every((item) => typeof item === "boolean") &&
    isOneOf(value.updateFrequency, ["daily", "weekly", "manual"]) &&
    isOneOf(value.matchRetentionDays, [30, 90, 180]);
}

function cloneSettings(settings: TrackerSettings): TrackerSettings {
  return structuredClone(settings);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys<const T extends readonly string[]>(value: unknown, keys: T): value is Record<T[number], unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function isOneOf<const T>(value: unknown, values: readonly T[]): value is T {
  return values.includes(value as T);
}

function isNumberInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function timestampForPath() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "");
}
