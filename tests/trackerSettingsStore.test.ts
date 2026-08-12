import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TRACKER_SETTINGS,
  TrackerSettingsStore
} from "../src/main/trackerSettingsStore";

const temporaryDirectories: string[] = [];

const expectedDefaults = {
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
    smartCardCounters: true,
    hiddenSmartCounterIds: [],
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
} as const;

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createUserDataDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "hearthstone-tracker-settings-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("TrackerSettingsStore", () => {
  it("returns enabled defaults when no settings file exists", async () => {
    const store = new TrackerSettingsStore(await createUserDataDirectory());

    expect(DEFAULT_TRACKER_SETTINGS).toEqual(expectedDefaults);
    await expect(store.read()).resolves.toEqual(expectedDefaults);
  });

  it.each([
    ["corrupt JSON", "{not-json"],
    ["invalid shape", JSON.stringify({ ladder: { friendlyDeckTracker: "yes" } })]
  ])("falls back to defaults for %s", async (_label, content) => {
    const userDataDirectory = await createUserDataDirectory();
    await writeFile(path.join(userDataDirectory, "tracker-settings.json"), content, "utf8");

    await expect(new TrackerSettingsStore(userDataDirectory).read()).resolves.toEqual(DEFAULT_TRACKER_SETTINGS);
  });

  it.each([
    ["corrupt JSON", "{not-json"],
    ["invalid shape", JSON.stringify({ ladder: { friendlyDeckTracker: "yes" } })]
  ])("backs up and repairs %s during startup health checking", async (_label, content) => {
    const userDataDirectory = await createUserDataDirectory();
    const filePath = path.join(userDataDirectory, "tracker-settings.json");
    await writeFile(filePath, content, "utf8");

    const result = await new TrackerSettingsStore(userDataDirectory).repairOnStartup();

    expect(result.status).toBe("repaired");
    if (result.status !== "repaired") throw new Error("expected repaired result");
    expect(result.backupPath).toMatch(/tracker-settings\.json\.bak-/);
    await expect(readFile(result.backupPath!, "utf8")).resolves.toBe(content);
    await expect(readFile(filePath, "utf8").then(JSON.parse)).resolves.toEqual(DEFAULT_TRACKER_SETTINGS);
    expect(result.settings).toEqual(DEFAULT_TRACKER_SETTINGS);
  });

  it("normalizes legacy mode-specific switches into global settings", async () => {
    const userDataDirectory = await createUserDataDirectory();
    const store = new TrackerSettingsStore(userDataDirectory);
    const settings = {
      ...expectedDefaults,
      ladder: { friendlyDeckTracker: false, opponentDeckTracker: true },
      arena: { friendlyDeckTracker: true, opponentDeckTracker: false }
    } as const;
    const normalized = {
      ...settings,
      arena: { ...settings.ladder }
    };

    await expect(store.replace(settings)).resolves.toEqual(normalized);
    await expect(store.read()).resolves.toEqual(normalized);
    await expect(JSON.parse(await readFile(path.join(userDataDirectory, "tracker-settings.json"), "utf8"))).toEqual(normalized);
  });

  it("normalizes conflicting saved switches on startup and persists the result", async () => {
    const userDataDirectory = await createUserDataDirectory();
    const filePath = path.join(userDataDirectory, "tracker-settings.json");
    const saved = {
      ...expectedDefaults,
      ladder: { friendlyDeckTracker: true, opponentDeckTracker: false },
      arena: { friendlyDeckTracker: false, opponentDeckTracker: true }
    } as const;
    const normalized = { ...saved, arena: { ...saved.ladder } };
    await writeFile(filePath, JSON.stringify(saved), "utf8");

    await expect(new TrackerSettingsStore(userDataDirectory).read()).resolves.toEqual(normalized);
    await expect(readFile(filePath, "utf8").then(JSON.parse)).resolves.toEqual(normalized);
  });

  it("migrates a valid legacy file and persists the completed settings", async () => {
    const userDataDirectory = await createUserDataDirectory();
    const filePath = path.join(userDataDirectory, "tracker-settings.json");
    const legacy = {
      ladder: { friendlyDeckTracker: false, opponentDeckTracker: true },
      arena: { friendlyDeckTracker: true, opponentDeckTracker: false }
    };
    await writeFile(filePath, JSON.stringify(legacy), "utf8");

    const migrated = {
      ...expectedDefaults,
      ladder: legacy.ladder,
      arena: legacy.ladder
    };
    await expect(new TrackerSettingsStore(userDataDirectory).read()).resolves.toEqual(migrated);
    await expect(readFile(filePath, "utf8").then(JSON.parse)).resolves.toEqual(migrated);
  });

  it("adds the hero ranking switch to settings saved by the previous version", async () => {
    const userDataDirectory = await createUserDataDirectory();
    const filePath = path.join(userDataDirectory, "tracker-settings.json");
    const { arenaHeroWinRateRanking: _missing, ...oldOverlay } = expectedDefaults.overlay;
    await writeFile(filePath, JSON.stringify({ ...expectedDefaults, overlay: oldOverlay }), "utf8");

    await expect(new TrackerSettingsStore(userDataDirectory).read()).resolves.toEqual(expectedDefaults);
  });

  it("adds the game-only overlay switch to settings saved by the previous version", async () => {
    const userDataDirectory = await createUserDataDirectory();
    const filePath = path.join(userDataDirectory, "tracker-settings.json");
    const { showOnlyInGame: _missing, ...oldOverlay } = expectedDefaults.overlay;
    await writeFile(filePath, JSON.stringify({ ...expectedDefaults, overlay: oldOverlay }), "utf8");

    await expect(new TrackerSettingsStore(userDataDirectory).read()).resolves.toEqual(expectedDefaults);
    await expect(readFile(filePath, "utf8").then(JSON.parse)).resolves.toEqual(expectedDefaults);
  });

  it("adds the overlay appearance to settings saved by the previous version", async () => {
    const userDataDirectory = await createUserDataDirectory();
    const filePath = path.join(userDataDirectory, "tracker-settings.json");
    const { theme: _missing, ...oldOverlay } = expectedDefaults.overlay;
    const legacy = {
      ...expectedDefaults,
      overlay: oldOverlay,
      appearance: { ...expectedDefaults.appearance, theme: "light" as const }
    };
    await writeFile(filePath, JSON.stringify(legacy), "utf8");

    const migrated = { ...legacy, overlay: expectedDefaults.overlay };
    await expect(new TrackerSettingsStore(userDataDirectory).read()).resolves.toEqual(migrated);
    await expect(readFile(filePath, "utf8").then(JSON.parse)).resolves.toEqual(migrated);
  });

  it("adds the focus-on-open switch to settings saved by the previous version", async () => {
    const userDataDirectory = await createUserDataDirectory();
    const filePath = path.join(userDataDirectory, "tracker-settings.json");
    const { focusOnOpen: _missing, ...oldGeneral } = expectedDefaults.general;
    await writeFile(filePath, JSON.stringify({ ...expectedDefaults, general: oldGeneral }), "utf8");

    await expect(new TrackerSettingsStore(userDataDirectory).read()).resolves.toEqual(expectedDefaults);
    await expect(readFile(filePath, "utf8").then(JSON.parse)).resolves.toEqual(expectedDefaults);
  });

  it("migrates the temporary always-on-top setting without losing other preferences", async () => {
    const userDataDirectory = await createUserDataDirectory();
    const filePath = path.join(userDataDirectory, "tracker-settings.json");
    const { focusOnOpen: _missing, ...general } = expectedDefaults.general;
    const transitional = {
      ...expectedDefaults,
      general: {
        ...general,
        alwaysOnTop: true,
        gameDetection: "manual" as const,
        gameLanguage: "en-US" as const
      },
      appearance: { ...expectedDefaults.appearance, zoom: 110 }
    };
    await writeFile(filePath, JSON.stringify(transitional), "utf8");

    const migrated = {
      ...transitional,
      general: {
        ...general,
        focusOnOpen: true,
        gameDetection: "manual" as const,
        gameLanguage: "en-US" as const
      }
    };
    await expect(new TrackerSettingsStore(userDataDirectory).read()).resolves.toEqual(migrated);
    await expect(readFile(filePath, "utf8").then(JSON.parse)).resolves.toEqual(migrated);
  });

  it("rejects invalid replacements without overwriting valid settings", async () => {
    const userDataDirectory = await createUserDataDirectory();
    const store = new TrackerSettingsStore(userDataDirectory);
    await store.replace(DEFAULT_TRACKER_SETTINGS);

    await expect(store.replace({ ladder: {}, arena: {} })).rejects.toThrow(/设置数据无效/);
    await expect(store.read()).resolves.toEqual(DEFAULT_TRACKER_SETTINGS);
  });

  it("fulfills 40 concurrent replacements and persists the last request", async () => {
    const userDataDirectory = await createUserDataDirectory();
    const store = new TrackerSettingsStore(userDataDirectory);
    const replacements = Array.from({ length: 40 }, (_, index) => ({
      ...expectedDefaults,
      appearance: { ...expectedDefaults.appearance, zoom: 81 + index }
    }));

    const results = await Promise.allSettled(replacements.map((settings) => store.replace(settings)));

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    await expect(store.read()).resolves.toEqual(replacements.at(-1));
    await expect(readFile(path.join(userDataDirectory, "tracker-settings.json"), "utf8").then(JSON.parse))
      .resolves.toEqual(replacements.at(-1));
  });

  it.each([
    ["general enum", { ...expectedDefaults, general: { ...expectedDefaults.general, gameDetection: "guess" } }],
    ["focus on open", { ...expectedDefaults, general: { ...expectedDefaults.general, focusOnOpen: "yes" } }],
    ["overlay offset", { ...expectedDefaults, overlay: { ...expectedDefaults.overlay, offsetX: 201 } }],
    ["overlay opacity", { ...expectedDefaults, overlay: { ...expectedDefaults.overlay, opacity: 29 } }],
    ["overlay theme", { ...expectedDefaults, overlay: { ...expectedDefaults.overlay, theme: "system" } }],
    ["accent color", { ...expectedDefaults, appearance: { ...expectedDefaults.appearance, accentColor: "#ffffff" } }],
    ["zoom", { ...expectedDefaults, appearance: { ...expectedDefaults.appearance, zoom: 121 } }],
    ["retention", { ...expectedDefaults, other: { ...expectedDefaults.other, matchRetentionDays: 60 } }],
    ["unknown field", { ...expectedDefaults, futureSetting: true }]
  ])("rejects an invalid %s replacement", async (_label, settings) => {
    const store = new TrackerSettingsStore(await createUserDataDirectory());

    await expect(store.replace(settings)).rejects.toThrow(/设置数据无效/);
  });
});
